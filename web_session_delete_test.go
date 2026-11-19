package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"testing"
)

func deleteSessionRequest(handler http.Handler, id, tag, origin string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(http.MethodDelete, "http://127.0.0.1/api/sessions/"+id, nil)
	if tag != "" {
		request.Header.Set("If-Match", tag)
	}
	request.Header.Set("Origin", origin)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

func sessionTagFromResponse(t *testing.T, response *httptest.ResponseRecorder, id string) string {
	t.Helper()
	var view struct {
		Sessions []struct {
			ID   string `json:"id"`
			ETag string `json:"etag"`
		} `json:"sessions"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &view); err != nil {
		t.Fatal(err)
	}
	for _, session := range view.Sessions {
		if session.ID == id && strings.HasPrefix(session.ETag, `"`) && strings.HasSuffix(session.ETag, `"`) {
			return session.ETag
		}
	}
	t.Fatalf("no strong tag for %q in %s", id, response.Body)
	return ""
}

func getSessionTag(t *testing.T, handler http.Handler, id string) string {
	t.Helper()
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "http://127.0.0.1/api/sessions", nil))
	return sessionTagFromResponse(t, response, id)
}

func TestDeleteSessionPersistsAndRetries(t *testing.T) {
	handler, path := sessionWriter(t)
	original, err := readSessionFile(path)
	if err != nil {
		t.Fatal(err)
	}
	target := original.Sessions[0].ID
	tag := getSessionTag(t, handler, target)
	// Add another session after the client read the row it wants to delete.
	entry := validSessionEntry()
	entry.ID = "session / Köln?"
	created := postSession(t, handler, entry)
	if created.Code != http.StatusCreated {
		t.Fatalf("create: %d %s", created.Code, created.Body)
	}
	otherTag := sessionTagFromResponse(t, created, entry.ID)
	beforeDelete, err := readSessionFile(path)
	if err != nil {
		t.Fatal(err)
	}
	for range 2 {
		response := deleteSessionRequest(handler, target, tag, "http://127.0.0.1")
		var view sessionView
		if err := json.Unmarshal(response.Body.Bytes(), &view); err != nil {
			t.Fatal(err)
		}
		if response.Code != http.StatusOK || !reflect.DeepEqual(view.Sessions, beforeDelete.Sessions[1:]) {
			t.Fatalf("delete: %d %s", response.Code, response.Body)
		}
		if remainingTag := sessionTagFromResponse(t, response, entry.ID); remainingTag != otherTag {
			t.Fatal("deleting an unrelated session changed the remaining session's tag")
		}
	}
	persisted, err := readSessionFile(path)
	if err != nil || !reflect.DeepEqual(persisted.Sessions, beforeDelete.Sessions[1:]) {
		t.Fatalf("wrong persisted sessions: %+v, %v", persisted, err)
	}
	response := deleteSessionRequest(handler, url.PathEscape(entry.ID), otherTag, "http://127.0.0.1")
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"sessions":[]`) {
		t.Fatalf("delete last session: %d %s", response.Code, response.Body)
	}
	var empty SessionFile
	if err := readJSONFile(path, &empty); err != nil || empty.Sessions == nil || len(empty.Sessions) != 0 {
		t.Fatalf("wrong empty file: %+v, %v", empty, err)
	}
	if files, err := os.ReadDir(filepath.Dir(path)); err != nil || len(files) != 2 {
		t.Fatalf("expected only the session and config files, got %v, %v", files, err)
	}
}

func TestDeleteSessionRejectsStaleRecordAndForeignOrigin(t *testing.T) {
	handler, path := sessionWriter(t)
	original, err := readSessionFile(path)
	if err != nil {
		t.Fatal(err)
	}
	target := original.Sessions[0].ID
	tag := getSessionTag(t, handler, target)
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		name   string
		tag    string
		status int
	}{
		{name: "missing version", status: http.StatusPreconditionRequired},
		{name: "wildcard version", tag: "*", status: http.StatusPreconditionFailed},
	} {
		t.Run(test.name, func(t *testing.T) {
			response := deleteSessionRequest(handler, target, test.tag, "http://127.0.0.1")
			if response.Code != test.status {
				t.Fatalf("delete: %d %s", response.Code, response.Body)
			}
			if after, err := os.ReadFile(path); err != nil || !bytes.Equal(after, before) {
				t.Fatalf("rejected deletion modified the file: %v", err)
			}
		})
	}
	edited := bytes.Replace(before, []byte("Alex Beispiel"), []byte("Corrected Name"), 1)
	if err := os.WriteFile(path, edited, 0o600); err != nil {
		t.Fatal(err)
	}
	if response := deleteSessionRequest(handler, target, tag, "http://127.0.0.1"); response.Code != http.StatusPreconditionFailed {
		t.Fatalf("stale record: %d %s", response.Code, response.Body)
	}
	currentTag := getSessionTag(t, handler, target)
	if currentTag == tag {
		t.Fatal("editing the session did not change its tag")
	}
	if response := deleteSessionRequest(handler, target, currentTag, "https://example.com"); response.Code != http.StatusForbidden {
		t.Fatalf("foreign origin: %d %s", response.Code, response.Body)
	}
	if after, err := os.ReadFile(path); err != nil || !bytes.Equal(after, edited) {
		t.Fatalf("rejected deletion modified the file: %v", err)
	}
}

func TestDeleteSessionHandlesSlashID(t *testing.T) {
	handler, _ := sessionWriter(t)
	for _, id := range []string{"a/b", "a"} {
		entry := validSessionEntry()
		entry.ID = id
		if response := postSession(t, handler, entry); response.Code != http.StatusCreated {
			t.Fatalf("create: %d %s", response.Code, response.Body)
		}
	}
	response := deleteSessionRequest(handler, "a%2Fb", getSessionTag(t, handler, "a/b"), "http://127.0.0.1")
	var view sessionView
	if err := json.Unmarshal(response.Body.Bytes(), &view); err != nil {
		t.Fatal(err)
	}
	if response.Code != http.StatusOK || slices.ContainsFunc(view.Sessions, func(session Session) bool { return session.ID == "a/b" }) || !slices.ContainsFunc(view.Sessions, func(session Session) bool { return session.ID == "a" }) {
		t.Fatalf("slash ID deletion: %d %s", response.Code, response.Body)
	}
}

func TestDeleteSessionKeepsRecordIfWriteFails(t *testing.T) {
	handler, path := sessionWriter(t)
	original, err := readSessionFile(path)
	if err != nil {
		t.Fatal(err)
	}
	tag := getSessionTag(t, handler, original.Sessions[0].ID)
	directory := filepath.Dir(path)
	if err := os.Chmod(directory, 0o500); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := os.Chmod(directory, 0o700); err != nil {
			t.Error(err)
		}
	})
	if probe, err := os.CreateTemp(directory, "probe"); err == nil {
		probe.Close()
		t.Skip("test process can write to a read-only directory")
	}
	response := deleteSessionRequest(handler, original.Sessions[0].ID, tag, "http://127.0.0.1")
	if response.Code != http.StatusInternalServerError || !strings.Contains(response.Body.String(), "save sessions") {
		t.Fatalf("write failure: %d %s", response.Code, response.Body)
	}
	if current, err := readSessionFile(path); err != nil || !reflect.DeepEqual(current, original) {
		t.Fatalf("write failure modified the file: %+v, %v", current, err)
	}
}
