package main

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"testing/fstest"
	"time"
)

func TestSessionsAPI(t *testing.T) {
	fixture, err := os.ReadFile("examples/sessions.json")
	if err != nil {
		t.Fatal(err)
	}
	var original SessionFile
	if err := json.Unmarshal(fixture, &original); err != nil {
		t.Fatal(err)
	}
	duplicates := original
	duplicates.Sessions = append([]Session(nil), original.Sessions...)
	duplicates.Sessions[1].ID = duplicates.Sessions[0].ID
	duplicateFixture, err := json.Marshal(duplicates)
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		name          string
		sessions      string
		config        string
		requireConfig bool
		wantZone      string
		wantError     string
	}{
		{name: "configured timezone without billing fields", sessions: string(fixture), config: `{"timeZone":"Europe/Berlin"}`, wantZone: "Europe/Berlin"},
		{name: "missing default config", sessions: string(fixture), wantZone: "UTC"},
		{name: "missing timezone", sessions: string(fixture), config: `{}`, wantError: "timeZone: required"},
		{name: "empty sessions", sessions: `{"schemaVersion":3,"sessions":[]}`, wantZone: "UTC"},
		{name: "null sessions", sessions: `{"schemaVersion":3,"sessions":null}`, wantZone: "UTC"},
		{name: "missing explicit config", sessions: string(fixture), requireConfig: true, wantError: "read config"},
		{name: "malformed config", sessions: string(fixture), config: `{`, wantError: "read config"},
		{name: "invalid timezone", sessions: string(fixture), config: `{"timeZone":"Invalid/Zone"}`, wantError: `timeZone "Invalid/Zone"`},
		{name: "machine timezone forbidden", sessions: string(fixture), config: `{"timeZone":"Local"}`, wantError: "explicit IANA timezone"},
		{name: "missing input", wantError: "--input"},
		{name: "malformed input", sessions: `{`, wantError: "read sessions"},
		{name: "unsupported schema", sessions: `{"schemaVersion":1,"sessions":[]}`, wantError: "schemaVersion"},
		{name: "invalid activity", sessions: strings.Replace(string(fixture), `"minutes": 30`, `"minutes": 0`, 1), wantError: "minutes: must be positive"},
		{name: "duplicate session ID", sessions: string(duplicateFixture), wantError: `sessions[1].id: duplicate "` + original.Sessions[0].ID + `" (first used at sessions[0].id)`},
	} {
		t.Run(test.name, func(t *testing.T) {
			directory := t.TempDir()
			source := sessionSource{
				inputPath:     filepath.Join(directory, "sessions.json"),
				configPath:    filepath.Join(directory, "config.json"),
				requireConfig: test.requireConfig,
			}
			for path, contents := range map[string]string{source.inputPath: test.sessions, source.configPath: test.config} {
				if contents != "" {
					if err := os.WriteFile(path, []byte(contents), 0o600); err != nil {
						t.Fatal(err)
					}
				}
			}
			handler := webHandler(fstest.MapFS{}, source)
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "http://127.0.0.1/api/sessions", nil))
			if response.Header().Get("Cache-Control") != "no-store" || response.Header().Get("Content-Type") != "application/json" {
				t.Fatalf("unexpected response headers: %v", response.Header())
			}
			if test.wantError != "" {
				var body struct{ Error string }
				if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
					t.Fatal(err)
				}
				if response.Code != http.StatusInternalServerError || !strings.Contains(body.Error, test.wantError) {
					t.Fatalf("status = %d, error = %q; want 500 and %q", response.Code, body.Error, test.wantError)
				}
				return
			}
			var view sessionView
			if err := json.Unmarshal(response.Body.Bytes(), &view); err != nil {
				t.Fatal(err)
			}
			if response.Code != http.StatusOK || view.TimeZone != test.wantZone {
				t.Fatalf("status = %d, view = %+v", response.Code, view)
			}
			if test.sessions == string(fixture) {
				if !reflect.DeepEqual(view.Sessions, original.Sessions) {
					t.Fatal("API changed session data or file order")
				}
			} else if view.Sessions == nil || len(view.Sessions) != 0 {
				t.Fatalf("empty sessions must be an array, got %+v", view.Sessions)
			}
		})
	}
}

func startTestWebServer(t *testing.T, arguments []string) string {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	reader, writer := io.Pipe()
	done := make(chan error, 1)
	go func() {
		done <- run(ctx, arguments, writer, strings.NewReader(""), time.Now)
		writer.Close()
	}()
	t.Cleanup(func() {
		cancel()
		reader.Close()
		select {
		case err := <-done:
			if err != nil {
				t.Errorf("stop server: %v", err)
			}
		case <-time.After(10 * time.Second):
			t.Error("server did not stop")
		}
	})
	scanner := bufio.NewScanner(reader)
	if !scanner.Scan() {
		t.Fatal("server did not print its URL")
	}
	url := strings.TrimPrefix(scanner.Text(), "Flight Instructor Tools: ")
	if !scanner.Scan() || scanner.Text() != "Press Ctrl+C to stop." {
		t.Fatalf("unexpected server output: %q", scanner.Text())
	}
	return url
}

func TestServeHosts(t *testing.T) {
	url := startTestWebServer(t, []string{
		"serve", "--no-open", "--input", "testdata/minimal-sessions.json",
		"--config", "examples/config.json",
	})
	client := &http.Client{Timeout: 5 * time.Second}
	for _, test := range []struct {
		host    string
		allowed bool
	}{
		{"127.0.0.1", true},
		{"127.0.0.1:8080", true},
		{"localhost", true},
		{"localhost:5173", true},
		{"LOCALHOST:8080", true},
		{"attacker.example", false},
		{"attacker.example:8080", false},
		{"localhost.attacker.example:8080", false},
		{"127.0.0.1.attacker.example:8080", false},
		{"192.168.1.1:8080", false},
		{"127.0.0.2:8080", false},
		{"[::1]:8080", false},
	} {
		t.Run(test.host, func(t *testing.T) {
			for _, route := range []struct{ path, content string }{
				{"/", "<title>Flight Instructor Tools</title>"},
				{"/api/sessions", "Alex Beispiel"},
			} {
				request, err := http.NewRequest(http.MethodGet, url+route.path, nil)
				if err != nil {
					t.Fatal(err)
				}
				request.Host = test.host
				response, err := client.Do(request)
				if err != nil {
					t.Fatal(err)
				}
				body, err := io.ReadAll(response.Body)
				response.Body.Close()
				if err != nil {
					t.Fatal(err)
				}
				if test.allowed {
					if response.StatusCode != http.StatusOK || !strings.Contains(string(body), route.content) {
						t.Errorf("%s: status = %d, body = %q; want 200 containing %q", route.path, response.StatusCode, body, route.content)
					}
				} else if response.StatusCode != http.StatusForbidden || string(body) != "Forbidden\n" {
					t.Errorf("%s: status = %d, body = %q; want 403 with no application data", route.path, response.StatusCode, body)
				}
			}
		})
	}
}

func TestServeSessionPaths(t *testing.T) {
	fixture, err := os.ReadFile("testdata/minimal-sessions.json")
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		name       string
		args       []string
		inputPath  string
		configPath string
	}{
		{"working directory defaults", []string{"--no-open"}, "sessions.json", "config.json"},
		{"explicit serve paths", []string{"serve", "--no-open", "--input", "custom.json", "--config", "settings.json"}, "custom.json", "settings.json"},
		{"implicit serve paths", []string{"--input", "custom.json", "--config", "settings.json", "--no-open"}, "custom.json", "settings.json"},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Chdir(t.TempDir())
			if err := os.WriteFile(test.inputPath, fixture, 0o600); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(test.configPath, []byte(`{"timeZone":"Europe/Berlin"}`), 0o600); err != nil {
				t.Fatal(err)
			}
			url := startTestWebServer(t, test.args)
			client := &http.Client{Timeout: 5 * time.Second}
			response, err := client.Get(url + "/api/sessions")
			if err != nil {
				t.Fatal(err)
			}
			defer response.Body.Close()
			var view sessionView
			if err := json.NewDecoder(response.Body).Decode(&view); err != nil {
				t.Fatal(err)
			}
			if response.StatusCode != http.StatusOK || view.TimeZone != "Europe/Berlin" || len(view.Sessions) != 1 || view.Sessions[0].Student != "Alex Beispiel" {
				t.Fatalf("status = %d, view = %+v", response.StatusCode, view)
			}
		})
	}
}
