package main

import (
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

func TestReadSessionFileValidatesSupportedFields(t *testing.T) {
	const valid = `{"schemaVersion":2,"sessions":[{"id":"session-1","dutyStart":"2026-05-03T10:00:00Z","dutyEnd":"2026-05-03T12:00:00Z","student":"Alex","activities":[{"id":"activity-1","type":"dual","minutes":60}]}]}`
	tests := []struct {
		name      string
		old       string
		new       string
		wantError string
	}{
		{"old schema", `"schemaVersion":2`, `"schemaVersion":1`, "schemaVersion: got 1, want 2"},
		{"future schema", `"schemaVersion":2`, `"schemaVersion":3`, "schemaVersion: got 3, want 2"},
		{"no sessions", `[{"id":"session-1","dutyStart":"2026-05-03T10:00:00Z","dutyEnd":"2026-05-03T12:00:00Z","student":"Alex","activities":[{"id":"activity-1","type":"dual","minutes":60}]}]`, `[]`, "sessions: must contain at least one session"},
		{"missing session ID", `"id":"session-1",`, ``, "sessions[0].id"},
		{"dutyStart date is null", `"dutyStart":"2026-05-03T10:00:00Z"`, `"dutyStart":null`, "sessions[0].dutyStart: missing or zero"},
		{"missing dutyStart date", `"dutyStart":"2026-05-03T10:00:00Z",`, ``, "sessions[0].dutyStart: missing or zero"},
		{"dutyEnd date is null", `"dutyEnd":"2026-05-03T12:00:00Z"`, `"dutyEnd":null`, "sessions[0].dutyEnd: missing or zero"},
		{"missing dutyEnd date", `"dutyEnd":"2026-05-03T12:00:00Z",`, ``, "sessions[0].dutyEnd: missing or zero"},
		{"invalid dutyStart date", `2026-05-03T10:00:00Z`, `2026-02-30T10:00:00Z`, "2026-02-30T10:00:00Z"},
		{"invalid dutyEnd date", `2026-05-03T12:00:00Z`, `2026-02-30T12:00:00Z`, "2026-02-30T12:00:00Z"},
		{"dutyEnd before dutyStart", `2026-05-03T12:00:00Z`, `2026-05-03T09:00:00Z`, "sessions[0].dutyEnd: must be after dutyStart"},
		{"dutyEnd equals dutyStart", `2026-05-03T12:00:00Z`, `2026-05-03T10:00:00Z`, "sessions[0].dutyEnd: must be after dutyStart"},
		{"missing subject", `"student":"Alex",`, ``, "sessions[0]: student or description is required"},
		{"missing activities", `,"activities":[{"id":"activity-1","type":"dual","minutes":60}]`, ``, "sessions[0].activities: must contain at least one activity"},
		{"empty activities", `[{"id":"activity-1","type":"dual","minutes":60}]`, `[]`, "sessions[0].activities: must contain at least one activity"},
		{"null activities", `[{"id":"activity-1","type":"dual","minutes":60}]`, `null`, "sessions[0].activities: must contain at least one activity"},
		{"missing activity ID", `"id":"activity-1",`, ``, "sessions[0].activities[0].id"},
		{"blank activity ID", `"id":"activity-1"`, `"id":" "`, "sessions[0].activities[0].id"},
		{"missing type", `"type":"dual",`, ``, "sessions[0].activities[0].type"},
		{"null type", `"type":"dual"`, `"type":null`, "sessions[0].activities[0].type"},
		{"unknown type", `"type":"dual"`, `"type":"exam"`, "sessions[0].activities[0].type"},
		{"missing duration", `,"minutes":60`, ``, "sessions[0].activities[0].minutes"},
		{"null duration", `"minutes":60`, `"minutes":null`, "sessions[0].activities[0].minutes"},
		{"zero duration", `"minutes":60`, `"minutes":0`, "sessions[0].activities[0].minutes"},
		{"negative duration", `"minutes":60`, `"minutes":-1`, "sessions[0].activities[0].minutes"},
		{"fractional duration", `"minutes":60`, `"minutes":1.5`, "cannot unmarshal number 1.5"},
		{"legacy preparation field", `"student":"Alex"`, `"student":"Alex","preparationMinutes":30`, `unknown field "preparationMinutes"`},
		{"legacy flights field", `"student":"Alex"`, `"student":"Alex","flights":[]`, `unknown field "flights"`},
		{"legacy block duration", `"minutes":60`, `"blockMinutes":60`, `unknown field "blockMinutes"`},
		{"unknown session field", `"student":"Alex"`, `"student":"Alex","unknown":true`, `unknown field "unknown"`},
		{"unknown activity field", `"minutes":60`, `"minutes":60,"unknown":true`, `unknown field "unknown"`},
		{"trailing content", valid, valid + `trailing content`, "trailing content"},
		{"second JSON value", valid, valid + `{}`, "unexpected second value"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if strings.Count(valid, test.old) != 1 {
				t.Fatal("test replacement must match exactly once")
			}
			contents := strings.Replace(valid, test.old, test.new, 1)
			path := filepath.Join(t.TempDir(), "sessions.json")
			if err := os.WriteFile(path, []byte(contents), 0o644); err != nil {
				t.Fatalf("write session file: %v", err)
			}
			_, err := readSessionFile(path)
			if err == nil || !strings.Contains(err.Error(), test.wantError) {
				t.Fatalf("error = %v, want containing %q", err, test.wantError)
			}
		})
	}
}

func TestReadSessionFileAcceptsActivityTypes(t *testing.T) {
	for _, activityType := range []ActivityType{ActivityPreparation, ActivityDual, ActivitySoloSupervision} {
		t.Run(string(activityType), func(t *testing.T) {
			contents := `{
				"schemaVersion": 2,
				"sessions": [{
					"id": "session-1",
					"dutyStart": "2026-05-03T10:00:00Z",
					"dutyEnd": "2026-05-03T12:00:00Z",
					"student": "Robin",
					"activities": [{"id": "activity-1", "type": "` + string(activityType) + `", "minutes": 60}]
				}]
			}`
			path := filepath.Join(t.TempDir(), "sessions.json")
			if err := os.WriteFile(path, []byte(contents), 0o644); err != nil {
				t.Fatalf("write session file: %v", err)
			}
			input, err := readSessionFile(path)
			if err != nil {
				t.Fatalf("read session: %v", err)
			}
			if len(input.Sessions) != 1 {
				t.Fatalf("session count = %d, want 1", len(input.Sessions))
			}
			want := []Activity{{ID: "activity-1", Type: activityType, Minutes: 60}}
			if !slices.Equal(input.Sessions[0].Activities, want) {
				t.Errorf("activities = %+v, want %+v", input.Sessions[0].Activities, want)
			}
		})
	}
}

func TestReadConfigValidatesRates(t *testing.T) {
	contents, err := os.ReadFile(filepath.Join("testdata", "minimal-config.json"))
	if err != nil {
		t.Fatalf("read valid config fixture: %v", err)
	}
	contents = []byte(strings.Replace(string(contents), `"blockCentsPerHour": 3000`, `"blockCentsPerHour": 0`, 1))

	path := filepath.Join(t.TempDir(), "config.json")
	if err := os.WriteFile(path, contents, 0o644); err != nil {
		t.Fatalf("write config: %v", err)
	}

	_, err = readConfig(path)
	if err == nil {
		t.Fatal("read config unexpectedly succeeded")
	}
	if !strings.Contains(err.Error(), "rates[0].blockCentsPerHour") {
		t.Fatalf("error %q does not identify the invalid rate", err)
	}
}
