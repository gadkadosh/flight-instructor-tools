package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

func TestForeFlightDownload(t *testing.T) {
	for _, test := range []struct {
		name, body, want string
		status           int
	}{
		{"selected sessions", `{"sessionIds":["2026-05-03-alex"]}`, "2026-05-03,DEFTI,EDFE,EDFE,,10:30,10:37,11:31,11:35,,,01:05,01:05", 200},
		{"stale selection", `{"sessionIds":["missing"]}`, "no longer exist", 400},
	} {
		t.Run(test.name, func(t *testing.T) {
			handler := webHandler(fstest.MapFS{}, sessionSource{sessionsPath: "testdata/minimal-sessions.json", configPath: "examples/config.json"}, &openTabs{})
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
