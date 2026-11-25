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

func TestDutyReportDownloadIncludesWholeMonth(t *testing.T) {
	// The setup's stub converter returns the rendered document unchanged.
	_, _, configPath := setupDutyReportTest(t)
	input, err := readSessionFile("testdata/minimal-sessions.json")
	if err != nil {
		t.Fatal(err)
	}
	second := input.Sessions[0]
	second.ID = "second"
	second.DutyEnd = second.DutyStart.Add(2 * time.Hour)
	second.Activities = []Activity{testFlight("second-flight", ActivityDual, 30)}
	second = shiftSession(second, 4*time.Hour)
	outside := shiftSession(second, 31*24*time.Hour) // 3 May to 3 June
	outside.ID = "outside"
	input.Sessions = append(input.Sessions, second, outside)
	sessionsPath := filepath.Join(t.TempDir(), "sessions.json")
	contents, err := json.Marshal(input)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(sessionsPath, contents, 0o600); err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		name, month, want string
		emptyFile         bool
	}{
		{name: "all May sessions including the gap", month: "2026-05", want: "Month 6:00, carry 120:00, year 126:00, block 1:35"},
		{name: "empty month", month: "2026-07", want: "Month 0:00, carry 120:00, year 120:00, block 0:00"},
		{name: "empty file", month: "2026-05", want: "Month 0:00, carry 120:00, year 120:00, block 0:00", emptyFile: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			path := sessionsPath
			if test.emptyFile {
				path = filepath.Join(filepath.Dir(sessionsPath), "empty.json")
				if err := os.WriteFile(path, []byte(`{"schemaVersion":4,"sessions":[]}`), 0o600); err != nil {
					t.Fatal(err)
				}
			}
			handler := webHandler(fstest.MapFS{}, sessionSource{sessionsPath: path, configPath: configPath}, &openTabs{})
			for attempt := 0; attempt < 2; attempt++ {
				body := `{"month":"` + test.month + `","carryOverFlightDuty":"120:00","issueDate":"2026-06-09"}`
				r := httptest.NewRequest(http.MethodPost, "http://127.0.0.1/api/duty-report", strings.NewReader(body))
				r.Header.Set("Content-Type", "application/json")
				response := httptest.NewRecorder()
				handler.ServeHTTP(response, r)
				if response.Code != http.StatusOK || response.Header().Get("Content-Type") != "application/pdf" ||
					response.Header().Get("Content-Disposition") != "attachment; filename=Dienstzeitnachweis-"+test.month+".pdf" ||
					response.Header().Get("Cache-Control") != "no-store" {
					t.Fatalf("status = %d, headers = %v, body = %s", response.Code, response.Header(), response.Body)
				}
				for _, want := range []string{test.want, "Issued 09.06.2026 (Europe/Berlin)", `data:image/png;base64,`, "Erika Musterfrau"} {
					if !strings.Contains(response.Body.String(), want) {
						t.Errorf("report missing %q: %s", want, response.Body)
					}
				}
				if strings.Count(response.Body.String(), `class="day"`) != 31 {
					t.Error("report must contain 31 day slots")
				}
			}
		})
	}
}

func TestDutyReportDownloadErrors(t *testing.T) {
	fixture, err := os.ReadFile("testdata/minimal-sessions.json")
	if err != nil {
		t.Fatal(err)
	}
	valid := `{"month":"2026-05","carryOverFlightDuty":"120:00","issueDate":"2026-06-09"}`
	for _, test := range []struct {
		name, body, contentType, origin, want string
		input                                 string
		missingConfig                         bool
		status                                int
		change                                func(*Config)
	}{
		{name: "missing month", body: strings.Replace(valid, "2026-05", "", 1), status: 400, want: "month must use"},
		{name: "invalid month", body: strings.Replace(valid, "2026-05", "2026-13", 1), status: 400, want: "month must use"},
		{name: "invalid month format", body: strings.Replace(valid, "2026-05", "2026-5", 1), status: 400, want: "month must use"},
		{name: "missing carry-over", body: strings.Replace(valid, "120:00", "", 1), status: 400, want: "hours:minutes"},
		{name: "invalid carry-over", body: strings.Replace(valid, "120:00", "120:60", 1), status: 400, want: "hours:minutes"},
		{name: "negative carry-over", body: strings.Replace(valid, "120:00", "-1:00", 1), status: 400, want: "hours:minutes"},
		{name: "invalid issue date", body: strings.Replace(valid, "2026-06-09", "2026-02-30", 1), status: 400, want: "issue date"},
		{name: "missing issue date", body: strings.Replace(valid, "2026-06-09", "", 1), status: 400, want: "issue date"},
		{name: "malformed request", body: `{`, status: 400, want: "invalid duty report request"},
		{name: "multiple requests", body: valid + valid, status: 400, want: "single duty report request"},
		{name: "selection is not supported", body: strings.Replace(valid, `"month"`, `"sessionIds":[],"month"`, 1), status: 400, want: "unknown field"},
		{name: "wrong content type", body: valid, contentType: "text/plain", status: 415, want: "application/json"},
		{name: "foreign origin", body: valid, origin: "https://attacker.example", status: 403, want: "cross-origin"},
		{name: "missing config", body: valid, status: 500, want: "read config", missingConfig: true},
		{name: "invalid sessions JSON", body: valid, status: 500, want: "read sessions", input: `{`},
		{name: "invalid session records", body: valid, status: 500, want: "validate sessions", input: `{"schemaVersion":4,"sessions":[{}]}`},
		{name: "session crosses midnight", body: valid, status: 422, want: "crosses local midnight", input: strings.Replace(string(fixture), "13:00:00Z", "23:00:00Z", 1)},
		{name: "missing timezone", body: valid, status: 500, want: "explicit IANA timezone", change: func(c *Config) { c.TimeZone = "" }},
		{name: "missing template", body: valid, status: 500, want: "required for duty reports", change: func(c *Config) { c.DutyReportTemplateFile = "" }},
		{name: "unreadable template", body: valid, status: 500, want: "read duty report template", change: func(c *Config) { c.DutyReportTemplateFile = "missing.tmpl" }},
		{name: "invalid signature", body: valid, status: 500, want: "as PNG", change: func(c *Config) { c.SignatureFile = "report.html.tmpl" }},
		{name: "missing renderer", body: valid, status: 500, want: "WeasyPrint"},
	} {
		t.Run(test.name, func(t *testing.T) {
			_, _, configPath := setupDutyReportTest(t)
			if test.change != nil {
				config, err := readConfig(configPath)
				if err != nil {
					t.Fatal(err)
				}
				test.change(&config)
				writeTestConfig(t, configPath, config)
			}
			if test.missingConfig {
				configPath = filepath.Join(filepath.Dir(configPath), "missing.json")
			}
			sessionsPath := "testdata/minimal-sessions.json"
			if test.input != "" {
				sessionsPath = filepath.Join(t.TempDir(), "sessions.json")
				if err := os.WriteFile(sessionsPath, []byte(test.input), 0o600); err != nil {
					t.Fatal(err)
				}
			}
			t.Setenv("PATH", t.TempDir())
			contentType := test.contentType
			if contentType == "" {
				contentType = "application/json"
			}
			handler := webHandler(fstest.MapFS{}, sessionSource{sessionsPath: sessionsPath, configPath: configPath}, &openTabs{})
			r := httptest.NewRequest(http.MethodPost, "http://127.0.0.1/api/duty-report", strings.NewReader(test.body))
			r.Header.Set("Content-Type", contentType)
			if test.origin != "" {
				r.Header.Set("Origin", test.origin)
			}
			response := httptest.NewRecorder()
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
