package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"testing/fstest"
	"time"
)

func sessionWriter(t *testing.T) (http.Handler, string) {
	t.Helper()
	directory := t.TempDir()
	path := filepath.Join(directory, "sessions.json")
	fixture, err := os.ReadFile("testdata/minimal-sessions.json")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, fixture, 0o600); err != nil {
		t.Fatal(err)
	}
	config := filepath.Join(directory, "config.json")
	if err := os.WriteFile(config, []byte(`{"timeZone":"Europe/Berlin"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	return webHandler(fstest.MapFS{}, sessionSource{inputPath: path, configPath: config}), path
}

func validSessionEntry() sessionEntry {
	return sessionEntry{
		ID: "new-session", DutyStart: "2026-05-03T23:00", DutyEnd: "2026-05-04T01:00",
		Student: " New Student ",
		Activities: []Activity{
			{ID: "prep", Type: ActivityPreparation, Minutes: 30},
			{ID: "dual-1", Type: ActivityDual, Minutes: 45},
			{ID: "dual-2", Type: ActivityDual, Minutes: 15},
			{ID: "solo", Type: ActivitySoloSupervision, Minutes: 20},
		},
	}
}

func postSession(t *testing.T, handler http.Handler, entry sessionEntry) *httptest.ResponseRecorder {
	t.Helper()
	body, err := json.Marshal(entry)
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "http://127.0.0.1/api/sessions", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", "http://127.0.0.1")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

func TestCreateSessionPersistsAndRetries(t *testing.T) {
	handler, path := sessionWriter(t)
	original, err := readSessionFile(path)
	if err != nil {
		t.Fatal(err)
	}
	entry := validSessionEntry()
	for _, wantStatus := range []int{http.StatusCreated, http.StatusOK} {
		response := postSession(t, handler, entry)
		if response.Code != wantStatus {
			t.Fatalf("status = %d, body = %s", response.Code, response.Body)
		}
		var view sessionView
		if err := json.Unmarshal(response.Body.Bytes(), &view); err != nil {
			t.Fatal(err)
		}
		if len(view.Sessions) != len(original.Sessions)+1 || view.TimeZone != "Europe/Berlin" {
			t.Fatalf("unexpected view: %+v", view)
		}
		persisted, err := readSessionFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if len(persisted.Sessions) != len(view.Sessions) || persisted.Sessions[0].ID != original.Sessions[0].ID {
			t.Fatal("save lost existing sessions or duplicated a retry")
		}
		saved := persisted.Sessions[len(persisted.Sessions)-1]
		if saved.Student != "New Student" || len(saved.Activities) != 4 ||
			saved.DutyStart.UTC().Format(time.RFC3339) != "2026-05-03T21:00:00Z" ||
			saved.DutyEnd.Sub(saved.DutyStart) != 2*time.Hour {
			t.Fatalf("wrong persisted session: %+v", saved)
		}
	}
	info, err := os.Stat(path)
	if err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("file permissions changed: %v, %v", info, err)
	}
	entry.Student = "Different student"
	if response := postSession(t, handler, entry); response.Code != http.StatusConflict {
		t.Fatalf("conflicting retry: %d %s", response.Code, response.Body)
	}
}

func TestCreateSessionRejectsInvalidRecordsWithoutChangingFile(t *testing.T) {
	for _, test := range []struct {
		name string
		edit func(*sessionEntry)
	}{
		{"missing student", func(e *sessionEntry) { e.Student = " " }},
		{"missing ID", func(e *sessionEntry) { e.ID = "" }},
		{"no activities", func(e *sessionEntry) { e.Activities = nil }},
		{"zero duration", func(e *sessionEntry) { e.Activities[0].Minutes = 0 }},
		{"unknown activity type", func(e *sessionEntry) { e.Activities[0].Type = "unknown" }},
		{"backwards duty", func(e *sessionEntry) { e.DutyEnd = "2026-05-03T22:00" }},
		{"invalid date", func(e *sessionEntry) { e.DutyStart = "2026-02-30T12:00" }},
		{"nonexistent clock time", func(e *sessionEntry) { e.DutyStart = "2026-03-29T02:30" }},
		{"ambiguous clock time", func(e *sessionEntry) { e.DutyStart = "2026-10-25T02:30" }},
	} {
		t.Run(test.name, func(t *testing.T) {
			handler, path := sessionWriter(t)
			before, _ := os.ReadFile(path)
			entry := validSessionEntry()
			test.edit(&entry)
			response := postSession(t, handler, entry)
			if response.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, body = %s", response.Code, response.Body)
			}
			after, _ := os.ReadFile(path)
			if !bytes.Equal(before, after) {
				t.Fatal("invalid save modified the file")
			}
		})
	}
}

func TestCreateSessionPersistsUnnamedSpecialFlights(t *testing.T) {
	handler, path := sessionWriter(t)
	entry := validSessionEntry()
	entry.Student = ""
	entry.Activities = []Activity{
		{ID: "prep", Type: ActivityPreparation, Minutes: 15},
		{ID: "rundflug", Type: ActivityRundflug, Minutes: 45},
		{ID: "schnupperflug", Type: ActivitySchnupperflug, Minutes: 30},
	}
	for _, status := range []int{http.StatusCreated, http.StatusOK} {
		response := postSession(t, handler, entry)
		if response.Code != status {
			t.Fatalf("status = %d, body = %s", response.Code, response.Body)
		}
	}
	persisted, err := readSessionFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(persisted.Sessions) != 2 {
		t.Fatalf("wrong session count after retry: %d", len(persisted.Sessions))
	}
	saved := persisted.Sessions[1]
	if saved.Student != "" || len(saved.Activities) != 3 || saved.Activities[1].Type != ActivityRundflug ||
		saved.Activities[2].Type != ActivitySchnupperflug {
		t.Fatalf("wrong persisted special flights: %+v", saved)
	}
}

func TestCreateSessionRejectsUnsafeAndMalformedRequests(t *testing.T) {
	for _, test := range []struct {
		name, origin, contentType, body string
		status                          int
	}{
		{"foreign origin", "https://evil.example", "application/json", `{}`, 403},
		{"null origin", "null", "application/json", `{}`, 403},
		{"other local origin", "http://localhost:9999", "application/json", `{}`, 403},
		{"simple form submission", "", "text/plain", `{}`, 415},
		{"invalid JSON", "", "application/json", `{`, 400},
		{"removed description", "", "application/json", `{"description":"Rundflug"}`, 400},
		{"unknown fields", "", "application/json", `{"unexpected":true}`, 400},
		{"trailing JSON", "", "application/json", `{} {}`, 400},
		{"oversized body", "", "application/json", `{"id":"` + strings.Repeat("x", 1<<20) + `"}`, 400},
	} {
		t.Run(test.name, func(t *testing.T) {
			handler, path := sessionWriter(t)
			before, _ := os.ReadFile(path)
			request := httptest.NewRequest(http.MethodPost, "http://127.0.0.1/api/sessions", strings.NewReader(test.body))
			request.Header.Set("Origin", test.origin)
			request.Header.Set("Content-Type", test.contentType)
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != test.status {
				t.Fatalf("status = %d, body = %s", response.Code, response.Body)
			}
			after, _ := os.ReadFile(path)
			if !bytes.Equal(before, after) {
				t.Fatal("rejected request modified the file")
			}
		})
	}
}

func TestConcurrentSessionSaves(t *testing.T) {
	handler, path := sessionWriter(t)
	var group sync.WaitGroup
	for index := range 10 {
		group.Go(func() {
			entry := validSessionEntry()
			entry.ID = fmt.Sprintf("session-%d", index)
			if response := postSession(t, handler, entry); response.Code != http.StatusCreated {
				t.Errorf("status = %d, body = %s", response.Code, response.Body)
			}
		})
	}
	group.Wait()
	persisted, err := readSessionFile(path)
	if err != nil || len(persisted.Sessions) != 11 {
		t.Fatalf("lost concurrent save: %+v, %v", persisted, err)
	}
}
