package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"
)

func TestReadSessionFileRejectsDuplicateSessionIDs(t *testing.T) {
	input, err := readSessionFile(filepath.Join("testdata", "minimal-sessions.json"))
	if err != nil {
		t.Fatal(err)
	}
	first := input.Sessions[0]
	middle := first
	middle.ID = "another-session"
	duplicate := first
	duplicate.Student = "Another student"
	input.Sessions = []Session{first, middle, duplicate}
	contents, err := json.Marshal(input)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "sessions.json")
	if err := os.WriteFile(path, contents, 0o600); err != nil {
		t.Fatal(err)
	}
	_, err = readSessionFile(path)
	want := `sessions[2].id: duplicate "` + first.ID + `" (first used at sessions[0].id)`
	if err == nil || !strings.Contains(err.Error(), want) {
		t.Fatalf("error = %v, want containing %q", err, want)
	}
}

func TestReadSessionFileRejectsInvalidInput(t *testing.T) {
	const valid = `{"schemaVersion":3,"sessions":[{"id":"session-1","dutyStart":"2026-05-03T10:00:00Z","dutyEnd":"2026-05-03T12:00:00Z","student":"Alex","activities":[{"id":"activity-1","type":"dual","minutes":60}]}]}`
	tests := []struct {
		name        string
		find        string
		replaceWith string
		wantError   string
	}{
		{"old schema", `"schemaVersion":3`, `"schemaVersion":1`, "schemaVersion: got 1, want 3"},
		{"previous schema", `"schemaVersion":3`, `"schemaVersion":2`, "schemaVersion: got 2, want 3"},
		{"future schema", `"schemaVersion":3`, `"schemaVersion":4`, "schemaVersion: got 4, want 3"},
		{"missing session ID", `"id":"session-1",`, ``, "sessions[0].id"},
		{"dot session ID", `"id":"session-1"`, `"id":"."`, `sessions[0].id: must not be "."`},
		{"dot-dot session ID", `"id":"session-1"`, `"id":".."`, `sessions[0].id: must not be ".."`},
		{"dutyStart date is null", `"dutyStart":"2026-05-03T10:00:00Z"`, `"dutyStart":null`, "sessions[0].dutyStart: missing or zero"},
		{"missing dutyStart date", `"dutyStart":"2026-05-03T10:00:00Z",`, ``, "sessions[0].dutyStart: missing or zero"},
		{"dutyEnd date is null", `"dutyEnd":"2026-05-03T12:00:00Z"`, `"dutyEnd":null`, "sessions[0].dutyEnd: missing or zero"},
		{"missing dutyEnd date", `"dutyEnd":"2026-05-03T12:00:00Z",`, ``, "sessions[0].dutyEnd: missing or zero"},
		{"invalid dutyStart date", `2026-05-03T10:00:00Z`, `2026-02-30T10:00:00Z`, "2026-02-30T10:00:00Z"},
		{"invalid dutyEnd date", `2026-05-03T12:00:00Z`, `2026-02-30T12:00:00Z`, "2026-02-30T12:00:00Z"},
		{"dutyEnd before dutyStart", `2026-05-03T12:00:00Z`, `2026-05-03T09:00:00Z`, "sessions[0].dutyEnd: must be after dutyStart"},
		{"dutyEnd equals dutyStart", `2026-05-03T12:00:00Z`, `2026-05-03T10:00:00Z`, "sessions[0].dutyEnd: must be after dutyStart"},
		{"missing subject", `"student":"Alex",`, ``, "sessions[0].student: required for training and preparation-only sessions"},
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
		{"fractional duration", `"minutes":60`, `"minutes":1.5`, "minutes"},
		{"legacy preparation field", `"student":"Alex"`, `"student":"Alex","preparationMinutes":30`, `unknown field "preparationMinutes"`},
		{"legacy flights field", `"student":"Alex"`, `"student":"Alex","flights":[]`, `unknown field "flights"`},
		{"removed description", `"student":"Alex"`, `"student":"Alex","description":"Rundflug"`, `unknown field "description"`},
		{"legacy block duration", `"minutes":60`, `"blockMinutes":60`, `unknown field "blockMinutes"`},
		{"unknown session field", `"student":"Alex"`, `"student":"Alex","unknown":true`, `unknown field "unknown"`},
		{"unknown activity field", `"minutes":60`, `"minutes":60,"unknown":true`, `unknown field "unknown"`},
		{"trailing content", valid, valid + `trailing content`, "trailing content"},
		{"second JSON value", valid, valid + `{}`, "unexpected second value"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if strings.Count(valid, test.find) != 1 {
				t.Fatal("test replacement must match exactly once")
			}
			contents := strings.Replace(valid, test.find, test.replaceWith, 1)
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
	for _, activityType := range []ActivityType{ActivityPreparation, ActivityDual, ActivitySoloSupervision, ActivityRundflug, ActivitySchnupperflug} {
		t.Run(string(activityType), func(t *testing.T) {
			contents := `{
				"schemaVersion": 3,
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

func TestSessionStudentRequirements(t *testing.T) {
	for _, test := range []struct {
		name         string
		types        []ActivityType
		student      string
		wantRequired bool
	}{
		{"preparation only", []ActivityType{ActivityPreparation}, "", true},
		{"dual", []ActivityType{ActivityDual}, "", true},
		{"solo supervision", []ActivityType{ActivitySoloSupervision}, "", true},
		{"blank student", []ActivityType{ActivityDual}, " \t ", true},
		{"rundflug", []ActivityType{ActivityRundflug}, "", false},
		{"schnupperflug", []ActivityType{ActivitySchnupperflug}, "", false},
		{"special flights with preparation", []ActivityType{ActivityPreparation, ActivityRundflug, ActivitySchnupperflug}, "", false},
		{"dual with special flight", []ActivityType{ActivityRundflug, ActivityDual}, "", true},
		{"solo with special flight", []ActivityType{ActivitySchnupperflug, ActivitySoloSupervision}, "", true},
		{"named mixed session", []ActivityType{ActivityPreparation, ActivityDual, ActivitySoloSupervision, ActivityRundflug, ActivitySchnupperflug}, "Alex", false},
	} {
		t.Run(test.name, func(t *testing.T) {
			session := Session{
				ID: "session", Student: test.student,
				DutyStart: mustTimestamp(t, "2026-05-03T10:00:00Z"),
				DutyEnd:   mustTimestamp(t, "2026-05-03T12:00:00Z"),
			}
			for _, activityType := range test.types {
				session.Activities = append(session.Activities, Activity{ID: string(activityType), Type: activityType, Minutes: 30})
			}
			err := validateSessionFile(SessionFile{SchemaVersion: 3, Sessions: []Session{session}})
			if test.wantRequired {
				if err == nil || !strings.Contains(err.Error(), "sessions[0].student: required") {
					t.Fatalf("error = %v, want a required student", err)
				}
			} else if err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestReadConfigValidatesRateAndTimeZone(t *testing.T) {
	fixture, err := os.ReadFile(filepath.Join("testdata", "minimal-config.json"))
	if err != nil {
		t.Fatalf("read valid config fixture: %v", err)
	}
	for _, test := range []struct{ name, find, replaceWith, wantError string }{
		{"zero block rate", `"blockCentsPerHour": 3000`, `"blockCentsPerHour": 0`, "rate.blockCentsPerHour: must be positive"},
		{"missing rate", `,
  "rate": {
    "preparationCentsPerHour": 2500,
    "blockCentsPerHour": 3000
  }`, ``, "rate.preparationCentsPerHour: must be positive"},
		{"rate history", `"rate"`, `"rates"`, `unknown field "rates"`},
		{"missing timezone", `"timeZone": "Europe/Berlin",`, ``, "timeZone: required"},
		{"computer timezone", `"Europe/Berlin"`, `"Local"`, "timeZone: required"},
		{"invalid timezone", `"Europe/Berlin"`, `"Not/AZone"`, `timeZone "Not/AZone"`},
	} {
		t.Run(test.name, func(t *testing.T) {
			if strings.Count(string(fixture), test.find) != 1 {
				t.Fatal("test replacement must match exactly once")
			}
			path := filepath.Join(t.TempDir(), "config.json")
			contents := strings.Replace(string(fixture), test.find, test.replaceWith, 1)
			if err := os.WriteFile(path, []byte(contents), 0o644); err != nil {
				t.Fatalf("write config: %v", err)
			}
			_, err := readConfig(path)
			if err == nil || !strings.Contains(err.Error(), test.wantError) {
				t.Fatalf("error = %v, want containing %q", err, test.wantError)
			}
		})
	}
}

func TestConfigParsesDatesAndMonthsInTimeZone(t *testing.T) {
	config, err := readConfig(filepath.Join("testdata", "minimal-config.json"))
	if err != nil {
		t.Fatal(err)
	}
	month, err := config.parseMonth("2026-06")
	if err != nil || month.Format(time.RFC3339) != "2026-06-01T00:00:00+02:00" {
		t.Errorf("month = %v, %v; want midnight in Europe/Berlin", month, err)
	}
	date, err := config.parseDate("2026-06-09")
	if err != nil || date.Format(time.RFC3339) != "2026-06-09T00:00:00+02:00" {
		t.Errorf("date = %v, %v; want midnight in Europe/Berlin", date, err)
	}
	// 23:30 UTC is already the next day in Berlin.
	today, err := config.issueDate("", func() time.Time { return mustTimestamp(t, "2026-05-31T23:30:00Z") })
	if err != nil || today.Format(time.RFC3339) != "2026-06-01T00:00:00+02:00" {
		t.Errorf("default issue date = %v, %v; want 2026-06-01 in Europe/Berlin", today, err)
	}
	for _, value := range []string{"2026-5", "2026-13", "", "../2026-05", "2026-05-01"} {
		if _, err := config.parseMonth(value); err == nil {
			t.Errorf("month %q unexpectedly accepted", value)
		}
	}
	for _, value := range []string{"2026-02-30", "2026-6-09", "", "2026-06"} {
		if _, err := config.parseDate(value); err == nil {
			t.Errorf("date %q unexpectedly accepted", value)
		}
	}
}
