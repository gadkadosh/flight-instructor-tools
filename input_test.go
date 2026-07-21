package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestReadSessionFileValidatesSupportedFields(t *testing.T) {
	tests := []struct {
		name      string
		contents  string
		wantError string
	}{
		{
			name:      "unsupported schema",
			contents:  `{"schemaVersion":2,"sessions":[{}]}`,
			wantError: "schemaVersion",
		},
		{
			name:      "invalid date",
			contents:  `{"schemaVersion":1,"sessions":[{"id":"session-1","date":"2026-02-30","student":"Alex","preparationMinutes":30,"flights":[]}]}`,
			wantError: "sessions[0].date",
		},
		{
			name:      "zero preparation duration",
			contents:  `{"schemaVersion":1,"sessions":[{"id":"session-1","date":"2026-05-03","student":"Alex","preparationMinutes":0,"flights":[]}]}`,
			wantError: "sessions[0].preparationMinutes",
		},
		{
			name:      "missing block duration",
			contents:  `{"schemaVersion":1,"sessions":[{"id":"session-1","date":"2026-05-03","student":"Alex","flights":[{"id":"flight-1"}]}]}`,
			wantError: "sessions[0].flights[0].blockMinutes",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "sessions.json")
			if err := os.WriteFile(path, []byte(test.contents), 0o644); err != nil {
				t.Fatalf("write session file: %v", err)
			}

			_, err := readSessionFile(path)
			if err == nil {
				t.Fatal("read session file unexpectedly succeeded")
			}
			if !strings.Contains(err.Error(), test.wantError) {
				t.Fatalf("error %q does not contain %q", err, test.wantError)
			}
		})
	}
}

func TestReadSessionFileAcceptsPreparationOnlySession(t *testing.T) {
	contents := `{
		"schemaVersion": 1,
		"sessions": [{
			"id": "session-1",
			"date": "2026-05-01",
			"student": "Robin",
			"preparationMinutes": 60,
			"flights": []
		}]
	}`

	path := filepath.Join(t.TempDir(), "sessions.json")
	if err := os.WriteFile(path, []byte(contents), 0o644); err != nil {
		t.Fatalf("write session file: %v", err)
	}

	input, err := readSessionFile(path)
	if err != nil {
		t.Fatalf("read preparation-only session: %v", err)
	}

	if got, want := len(input.Sessions), 1; got != want {
		t.Fatalf("session count = %d, want %d", got, want)
	}
	session := input.Sessions[0]
	if got, want := len(session.Flights), 0; got != want {
		t.Errorf("flight count = %d, want %d", got, want)
	}
	if session.PreparationMinutes == nil {
		t.Fatal("preparationMinutes is nil")
	}
	if got, want := *session.PreparationMinutes, 60; got != want {
		t.Errorf("preparationMinutes = %d, want %d", got, want)
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
