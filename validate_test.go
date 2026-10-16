package main

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestRunValidate(t *testing.T) {
	invalidPath := filepath.Join(t.TempDir(), "invalid-sessions.json")
	if err := os.WriteFile(invalidPath, []byte(`{"schemaVersion":1,"sessions":[]}`), 0o644); err != nil {
		t.Fatal(err)
	}
	malformedPath := filepath.Join(t.TempDir(), "malformed.json")
	if err := os.WriteFile(malformedPath, []byte(`{`), 0o644); err != nil {
		t.Fatal(err)
	}
	validPath := filepath.Join("testdata", "minimal-sessions.json")
	missingPath := filepath.Join(t.TempDir(), "missing.json")

	tests := []struct {
		name       string
		arguments  []string
		wantError  string
		wantOutput string
	}{
		{
			name:       "valid sessions",
			arguments:  []string{validPath},
			wantOutput: "Valid sessions file: " + validPath + "\n",
		},
		{
			name:      "invalid sessions",
			arguments: []string{invalidPath},
			wantError: "sessions: must contain at least one session",
		},
		{
			name:      "malformed JSON",
			arguments: []string{malformedPath},
			wantError: "decode",
		},
		{
			name:      "missing file",
			arguments: []string{missingPath},
			wantError: "open",
		},
		{
			name:      "no arguments",
			wantError: "usage: fitools validate FILE",
		},
		{
			name:      "extra arguments",
			arguments: []string{validPath, validPath},
			wantError: "expected exactly one sessions file",
		},
		{
			name:      "input flag is not supported",
			arguments: []string{"--input", validPath},
			wantError: "flag provided but not defined",
		},
		{
			name:       "help",
			arguments:  []string{"--help"},
			wantOutput: "Usage: fitools validate FILE\n",
		},
		{
			name:       "short help",
			arguments:  []string{"-h"},
			wantOutput: "Usage: fitools validate FILE\n",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			var stdout bytes.Buffer
			arguments := append([]string{"validate"}, test.arguments...)
			err := run(context.Background(), arguments, &stdout, time.Now)
			if test.wantError != "" {
				if err == nil || !strings.Contains(err.Error(), test.wantError) {
					t.Fatalf("error = %v, want containing %q", err, test.wantError)
				}
				if strings.Contains(stdout.String(), "Valid sessions file:") {
					t.Error("printed success despite validation failure")
				}
				return
			}
			if err != nil {
				t.Fatalf("run validate: %v", err)
			}
			if stdout.String() != test.wantOutput {
				t.Errorf("output = %q, want %q", stdout.String(), test.wantOutput)
			}
		})
	}
}
