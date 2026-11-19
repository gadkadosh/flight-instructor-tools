package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func deleteSessions(t *testing.T, handler http.Handler, contentType, body string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(http.MethodDelete, "http://127.0.0.1/api/sessions", strings.NewReader(body))
	request.Header.Set("Content-Type", contentType)
	request.Header.Set("Origin", "http://127.0.0.1")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

func TestDeleteSessionsPersistsAndRetries(t *testing.T) {
	handler, path := sessionWriter(t)
	original, err := readSessionFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if response := postSession(t, handler, validSessionEntry()); response.Code != http.StatusCreated {
		t.Fatalf("create: %d %s", response.Code, response.Body)
	}
	for range 2 {
		response := deleteSessions(t, handler, "application/json", `{"sessionIds":["new-session","missing"]}`)
		if response.Code != http.StatusOK {
			t.Fatalf("status = %d, body = %s", response.Code, response.Body)
		}
		var view sessionView
		if err := json.Unmarshal(response.Body.Bytes(), &view); err != nil {
			t.Fatal(err)
		}
		if len(view.Sessions) != 1 || view.Sessions[0].ID != original.Sessions[0].ID || view.TimeZone != "Europe/Berlin" {
			t.Fatalf("unexpected view: %+v", view)
		}
		persisted, err := readSessionFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if len(persisted.Sessions) != 1 || persisted.Sessions[0].ID != original.Sessions[0].ID {
			t.Fatalf("wrong persisted sessions: %+v", persisted.Sessions)
		}
	}

	response := deleteSessions(t, handler, "application/json", `{"sessionIds":["`+original.Sessions[0].ID+`"]}`)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"sessions":[]`) {
		t.Fatalf("delete last session: %d %s", response.Code, response.Body)
	}
	// The UI accepts an empty sessions file, unlike the CLI document commands.
	persisted, err := sessionSource{inputPath: path, configPath: "missing.json"}.read()
	if err != nil || len(persisted.Sessions) != 0 {
		t.Fatalf("last session not deleted: %+v, %v", persisted, err)
	}
	info, err := os.Stat(path)
	if err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("file permissions changed: %v, %v", info, err)
	}
}

func TestDeleteSessionsRejectsInvalidRequestsWithoutChangingFile(t *testing.T) {
	for _, test := range []struct {
		name, contentType, body string
		status                  int
	}{
		{"no sessions", "application/json", `{"sessionIds":[]}`, http.StatusBadRequest},
		{"missing sessions", "application/json", `{}`, http.StatusBadRequest},
		{"unknown field", "application/json", `{"sessionIds":["x"],"all":true}`, http.StatusBadRequest},
		{"trailing data", "application/json", `{"sessionIds":["x"]}{}`, http.StatusBadRequest},
		{"form body", "application/x-www-form-urlencoded", `sessionIds=x`, http.StatusUnsupportedMediaType},
	} {
		t.Run(test.name, func(t *testing.T) {
			handler, path := sessionWriter(t)
			before, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			response := deleteSessions(t, handler, test.contentType, test.body)
			if response.Code != test.status || !strings.Contains(response.Body.String(), `"error"`) {
				t.Fatalf("status = %d, body = %s", response.Code, response.Body)
			}
			after, err := os.ReadFile(path)
			if err != nil || string(after) != string(before) {
				t.Fatalf("file changed: %v", err)
			}
		})
	}
}

func TestDeleteSessionsRejectsCrossOriginRequests(t *testing.T) {
	handler, path := sessionWriter(t)
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodDelete, "http://127.0.0.1/api/sessions", strings.NewReader(`{"sessionIds":["2026-05-03-alex"]}`))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Sec-Fetch-Site", "cross-site")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusForbidden {
		t.Fatalf("status = %d", response.Code)
	}
	if after, err := os.ReadFile(path); err != nil || string(after) != string(before) {
		t.Fatalf("file changed: %v", err)
	}
}
