package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"testing"
)

func putSession(t *testing.T, handler http.Handler, id string, entry sessionEntry, tag string) *httptest.ResponseRecorder {
	t.Helper()
	body, err := json.Marshal(entry)
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPut, "http://127.0.0.1/api/sessions/"+url.PathEscape(id), bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", "http://127.0.0.1")
	if tag != "" {
		request.Header.Set("If-Match", tag)
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

// The fixture session as the form sends it: duty in Berlin wall-clock time (UTC+2).
func fixtureEntry(t *testing.T, path string) sessionEntry {
	t.Helper()
	file, err := readSessionFile(path)
	if err != nil {
		t.Fatal(err)
	}
	session := file.Sessions[0]
	if session.DutyStart.Format("15:04Z07:00") != "10:00Z" {
		t.Fatalf("fixture changed: %v", session.DutyStart)
	}
	return sessionEntry{
		ID: session.ID, DutyStart: "2026-05-03T12:00", DutyEnd: "2026-05-03T15:00",
		Student: session.Student, Activities: session.Activities,
	}
}

func TestUpdateSessionReplacesInPlaceAndRetries(t *testing.T) {
	handler, path := sessionWriter(t)
	added := validSessionEntry()
	if response := postSession(t, handler, added); response.Code != http.StatusCreated {
		t.Fatalf("create: %d %s", response.Code, response.Body)
	}
	entry := fixtureEntry(t, path)
	tag := getSessionTag(t, handler, entry.ID)
	entry.Student = " Corrected Name "
	entry.Activities[1].Landings = 7
	for range 2 {
		response := putSession(t, handler, entry.ID, entry, tag)
		if response.Code != http.StatusOK {
			t.Fatalf("update: %d %s", response.Code, response.Body)
		}
		persisted, err := readSessionFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if len(persisted.Sessions) != 2 || persisted.Sessions[1].ID != added.ID {
			t.Fatalf("update moved or lost sessions: %+v", persisted.Sessions)
		}
		saved := persisted.Sessions[0]
		if saved.ID != entry.ID || saved.Student != "Corrected Name" || saved.Activities[1].Landings != 7 ||
			saved.DutyStart.UTC().Format("15:04") != "10:00" {
			t.Fatalf("wrong saved session: %+v", saved)
		}
		if sessionTagFromResponse(t, response, entry.ID) == tag {
			t.Fatal("the saved session kept its old tag")
		}
	}
	// The same outdated tag with different content would overwrite the saved correction.
	entry.Activities[1].Landings = 8
	before, _ := os.ReadFile(path)
	response := putSession(t, handler, entry.ID, entry, tag)
	if response.Code != http.StatusPreconditionFailed || !bytes.Contains(response.Body.Bytes(), []byte("reload")) {
		t.Fatalf("stale update: %d %s", response.Code, response.Body)
	}
	if after, _ := os.ReadFile(path); !bytes.Equal(before, after) {
		t.Fatal("stale update modified the file")
	}
}

func TestUpdateSessionWithoutChangesLeavesFileIdentical(t *testing.T) {
	handler, path := sessionWriter(t)
	before, _ := os.ReadFile(path)
	entry := fixtureEntry(t, path)
	tag := getSessionTag(t, handler, entry.ID)
	response := putSession(t, handler, entry.ID, entry, tag)
	if response.Code != http.StatusOK || sessionTagFromResponse(t, response, entry.ID) != tag {
		t.Fatalf("unchanged update: %d %s", response.Code, response.Body)
	}
	if after, _ := os.ReadFile(path); !bytes.Equal(before, after) {
		t.Fatalf("unchanged update rewrote the file:\n%s", after)
	}
}

func TestUpdateSessionRejectsWithoutChangingFile(t *testing.T) {
	handler, path := sessionWriter(t)
	original := fixtureEntry(t, path)
	tag := getSessionTag(t, handler, original.ID)
	before, _ := os.ReadFile(path)
	for _, test := range []struct {
		name   string
		id     string
		tag    string
		edit   func(*sessionEntry)
		status int
	}{
		{"missing tag", original.ID, "", nil, http.StatusPreconditionRequired},
		{"wildcard tag", original.ID, "*", nil, http.StatusPreconditionFailed},
		{"ID differs from URL", "other", tag, nil, http.StatusBadRequest},
		{"unknown session", "missing", tag, func(e *sessionEntry) { e.ID = "missing" }, http.StatusNotFound},
		{"invalid session", original.ID, tag, func(e *sessionEntry) { e.Activities[1].Departure = "edfe" }, http.StatusBadRequest},
		{"flight outside duty", original.ID, tag, func(e *sessionEntry) { e.DutyEnd = "2026-05-03T13:00" }, http.StatusBadRequest},
	} {
		t.Run(test.name, func(t *testing.T) {
			entry := fixtureEntry(t, path)
			entry.Student = "Corrected Name"
			if test.edit != nil {
				test.edit(&entry)
			}
			if response := putSession(t, handler, test.id, entry, test.tag); response.Code != test.status {
				t.Fatalf("status = %d, body = %s", response.Code, response.Body)
			}
			if after, _ := os.ReadFile(path); !bytes.Equal(before, after) {
				t.Fatal("rejected update modified the file")
			}
		})
	}
}

func TestUpdateSessionRefusesChangeMadeElsewhere(t *testing.T) {
	handler, path := sessionWriter(t)
	entry := fixtureEntry(t, path)
	tag := getSessionTag(t, handler, entry.ID)
	before, _ := os.ReadFile(path)
	elsewhere := bytes.Replace(before, []byte(`"landings": 5`), []byte(`"landings": 6`), 1)
	if bytes.Equal(before, elsewhere) {
		t.Fatal("fixture changed")
	}
	if err := os.WriteFile(path, elsewhere, 0o600); err != nil {
		t.Fatal(err)
	}
	entry.Student = "Corrected Name"
	if response := putSession(t, handler, entry.ID, entry, tag); response.Code != http.StatusPreconditionFailed {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body)
	}
	current, err := readSessionFile(path)
	if err != nil || current.Sessions[0].Activities[1].Landings != 6 || current.Sessions[0].Student == entry.Student {
		t.Fatalf("change made elsewhere was overwritten: %+v, %v", current, err)
	}
}
