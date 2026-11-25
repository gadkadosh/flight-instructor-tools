package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
	"time"
)

func TestInvoiceDownloadUsesSelectedSessions(t *testing.T) {
	// The stub returns the HTML as the PDF, so assertions inspect the document
	// that would be converted, alongside the API's download behavior.
	stubWeasyPrint(t, "exec /bin/cat")
	input, err := readSessionFile("testdata/minimal-sessions.json")
	if err != nil {
		t.Fatal(err)
	}
	second := shiftSession(input.Sessions[0], 31*24*time.Hour) // 3 May to 3 June
	second.ID, second.Student = "second", "Sam Beispiel"
	unselected := second
	unselected.ID, unselected.Student = "excluded", "Excluded Student"
	input.Sessions = append(input.Sessions, unselected, second)
	contents, err := json.Marshal(input)
	if err != nil {
		t.Fatal(err)
	}
	sessionsPath := filepath.Join(t.TempDir(), "sessions.json")
	if err := os.WriteFile(sessionsPath, contents, 0o600); err != nil {
		t.Fatal(err)
	}
	handler := webHandler(fstest.MapFS{}, sessionSource{sessionsPath: sessionsPath, configPath: "examples/config.json"}, &openTabs{})
	request := `{"sessionIds":["second","2026-05-03-alex","second"],"number":"2026-07","issueDate":"2026-07-01"}`
	for attempt := 0; attempt < 2; attempt++ {
		response := httptest.NewRecorder()
		r := httptest.NewRequest(http.MethodPost, "http://127.0.0.1/api/invoice", strings.NewReader(request))
		r.Header.Set("Content-Type", "application/json")
		handler.ServeHTTP(response, r)
		if response.Code != http.StatusOK || response.Header().Get("Content-Type") != "application/pdf" ||
			response.Header().Get("Content-Disposition") != "attachment; filename=Rechnung-2026-07.pdf" ||
			response.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("status = %d, headers = %v, body = %s", response.Code, response.Header(), response.Body)
		}
		body := response.Body.String()
		for _, want := range []string{"Rechnung Nr. 2026-07", "01.07.2026", "Alex Beispiel - Flugvorbereitung", "Sam Beispiel - Blockzeit", "03.05.26", "03.06.26", "90,00 €"} {
			if !strings.Contains(body, want) {
				t.Errorf("invoice missing %q", want)
			}
		}
		if strings.Contains(body, "Excluded Student") || strings.Count(body, "Sam Beispiel - Blockzeit") != 1 || strings.Index(body, "Alex Beispiel - Flugvorbereitung") > strings.Index(body, "Sam Beispiel - Blockzeit") {
			t.Fatal("invoice did not preserve selected sessions once each in file order")
		}
	}
}

func TestInvoiceDownloadErrors(t *testing.T) {
	valid := `{"sessionIds":["2026-05-03-alex"],"number":"2026-07","issueDate":"2026-06-09"}`
	for _, test := range []struct {
		name, body, contentType, config, origin, want string
		status                                        int
	}{
		{name: "empty selection", body: strings.Replace(valid, `["2026-05-03-alex"]`, `[]`, 1), status: 400, want: "select at least one session"},
		{name: "unknown selection", body: strings.Replace(valid, "2026-05-03-alex", "missing", 1), status: 400, want: "no longer exist"},
		{name: "partly stale selection", body: strings.Replace(valid, `["2026-05-03-alex"]`, `["2026-05-03-alex","missing"]`, 1), status: 400, want: "no longer exist"},
		{name: "missing number", body: strings.Replace(valid, "2026-07", "", 1), status: 422, want: "invoice number"},
		{name: "invalid number", body: strings.Replace(valid, "2026-07", "../other", 1), status: 422, want: "invoice number"},
		{name: "invalid date", body: strings.Replace(valid, "2026-06-09", "2026-02-30", 1), status: 400, want: "issue date"},
		{name: "missing date", body: strings.Replace(valid, "2026-06-09", "", 1), status: 400, want: "issue date"},
		{name: "malformed request", body: `{`, status: 400, want: "invalid invoice request"},
		{name: "multiple requests", body: valid + valid, status: 400, want: "single invoice request"},
		{name: "unknown field", body: strings.Replace(valid, `"number"`, `"unexpected"`, 1), status: 400, want: "unknown field"},
		{name: "wrong content type", body: valid, contentType: "text/plain", status: 415, want: "application/json"},
		{name: "foreign origin", body: valid, origin: "https://attacker.example", status: 403, want: "cross-origin"},
		{name: "missing config", body: valid, config: "missing.json", status: 500, want: "read config"},
		{name: "missing renderer", body: valid, status: 500, want: "WeasyPrint"},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Setenv("PATH", t.TempDir())
			config := test.config
			if config == "" {
				config = "examples/config.json"
			}
			contentType := test.contentType
			if contentType == "" {
				contentType = "application/json"
			}
			handler := webHandler(fstest.MapFS{}, sessionSource{sessionsPath: "testdata/minimal-sessions.json", configPath: config}, &openTabs{})
			response := httptest.NewRecorder()
			r := httptest.NewRequest(http.MethodPost, "http://127.0.0.1/api/invoice", strings.NewReader(test.body))
			r.Header.Set("Content-Type", contentType)
			if test.origin != "" {
				r.Header.Set("Origin", test.origin)
			}
			handler.ServeHTTP(response, r)
			if response.Code != test.status || !strings.Contains(response.Body.String(), test.want) {
				t.Fatalf("status = %d, body = %s; want %d and %q", response.Code, response.Body, test.status, test.want)
			}
			if response.Header().Get("Content-Type") == "application/pdf" {
				t.Fatal("error returned as a PDF")
			}
		})
	}
}
