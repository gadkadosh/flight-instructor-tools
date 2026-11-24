package main

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
)

func TestForeFlightDownload(t *testing.T) {
	config, err := readConfig("examples/config.json")
	if err != nil {
		t.Fatal(err)
	}
	configWithout := filepath.Join(t.TempDir(), "config.json")
	config.Aircraft = nil
	writeTestConfig(t, configWithout, config)
	for _, test := range []struct {
		name, config, body, want string
		status                   int
	}{
		{"selected sessions", "examples/config.json", `{"sessionIds":["2026-05-03-alex"]}`, "2026-05-03,D-EFTI,EDFE,EDFE,,10:30,10:37,11:31,11:35,,,01:05,01:05", 200},
		{"unknown aircraft", configWithout, `{"sessionIds":["2026-05-03-alex"]}`, "aircraft D-EFTI is not in the config", 422},
		{"stale selection", "examples/config.json", `{"sessionIds":["missing"]}`, "no longer exist", 400},
	} {
		t.Run(test.name, func(t *testing.T) {
			handler := webHandler(fstest.MapFS{}, sessionSource{sessionsPath: "testdata/minimal-sessions.json", configPath: test.config})
			response := httptest.NewRecorder()
			r := httptest.NewRequest(http.MethodPost, "http://127.0.0.1/api/foreflight", strings.NewReader(test.body))
			r.Header.Set("Content-Type", "application/json")
			handler.ServeHTTP(response, r)
			if response.Code != test.status || !strings.Contains(response.Body.String(), test.want) {
				t.Fatalf("status = %d, body = %s; want %d containing %q", response.Code, response.Body, test.status, test.want)
			}
			if test.status == 200 && (response.Header().Get("Content-Type") != "text/csv; charset=utf-8" ||
				response.Header().Get("Content-Disposition") != "attachment; filename=ForeFlight-2026-05-03.csv") {
				t.Errorf("headers = %v", response.Header())
			}
		})
	}
}
