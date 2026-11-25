package main

import (
	"bufio"
	"bytes"
	"context"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestRunWithoutArgumentsServesEmbeddedUIAndOpensBrowser(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("test uses a POSIX browser-opening stub")
	}
	binDir := t.TempDir()
	openedURL := filepath.Join(binDir, "opened-url")
	t.Setenv("FITOOLS_TEST_OPENED_URL", openedURL)
	t.Setenv("PATH", binDir)
	for _, name := range []string{"open", "xdg-open"} {
		if err := os.WriteFile(filepath.Join(binDir, name), []byte("#!/bin/sh\nprintf '%s' \"$1\" > \"$FITOOLS_TEST_OPENED_URL\"\n"), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	// The UI must come from the binary, independent of the working directory.
	t.Chdir(t.TempDir())
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	reader, writer := io.Pipe()
	defer reader.Close()
	done := make(chan error, 1)
	go func() {
		done <- run(ctx, nil, writer, strings.NewReader(""), time.Now)
		writer.Close()
	}()
	scanner := bufio.NewScanner(reader)
	if !scanner.Scan() {
		t.Fatal("server did not print its URL")
	}
	url := strings.TrimPrefix(scanner.Text(), "Flight Instructor Tools: ")
	if !strings.HasPrefix(url, "http://127.0.0.1:") {
		t.Fatalf("server URL = %q, want loopback address", url)
	}
	if !scanner.Scan() || scanner.Text() != "Press Ctrl+C to stop." {
		t.Fatalf("unexpected server output: %q", scanner.Text())
	}
	client := &http.Client{Timeout: 5 * time.Second}
	get := func(path, contentType string) []byte {
		t.Helper()
		response, err := client.Get(url + path)
		if err != nil {
			t.Fatalf("get %s: %v", path, err)
		}
		defer response.Body.Close()
		body, err := io.ReadAll(response.Body)
		if err != nil {
			t.Fatal(err)
		}
		if response.StatusCode != http.StatusOK || !strings.Contains(response.Header.Get("Content-Type"), contentType) {
			t.Fatalf("%s: status = %d, content type = %q", path, response.StatusCode, response.Header.Get("Content-Type"))
		}
		return body
	}
	html := get("/", "text/html")
	if !bytes.Contains(html, []byte("<title>Flight Instructor Tools</title>")) {
		t.Fatal("page does not contain the application title")
	}
	script := regexp.MustCompile(`src="([^"]+\.js)"`).FindSubmatch(html)
	style := regexp.MustCompile(`href="([^"]+\.css)"`).FindSubmatch(html)
	if len(script) != 2 || len(style) != 2 {
		t.Fatalf("page does not reference built JavaScript and CSS: %s", html)
	}
	js := get(string(script[1]), "javascript")
	if !bytes.Contains(js, []byte("/api/sessions")) {
		t.Fatal("JavaScript bundle does not contain the React application")
	}
	if !bytes.Contains(js, []byte("/api/presence")) {
		t.Fatal("JavaScript bundle does not hold a presence stream, so the server would never stop with its tabs")
	}
	get(string(style[1]), "text/css")
	response, err := client.Get(url + "/input.go")
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusNotFound {
		t.Fatalf("source file request status = %d, want 404", response.StatusCode)
	}
	// An open tab must not hold up Ctrl+C.
	openTab(t, url)
	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("stop server: %v", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("server did not stop after cancellation")
	}
	opened, err := os.ReadFile(openedURL)
	if err != nil || string(opened) != url {
		t.Fatalf("browser opened %q, want %q (error: %v)", opened, url, err)
	}
	if response, err := client.Get(url); err == nil {
		response.Body.Close()
		t.Fatal("server still accepts requests after stopping")
	}
}

func TestRunServeArguments(t *testing.T) {
	for _, test := range []struct {
		name string
		args []string
		want string
	}{
		{"help", []string{"serve", "--help"}, ""},
		{"unknown flag", []string{"serve", "--unknown"}, "parse serve arguments"},
		{"positional argument", []string{"serve", "extra"}, "unexpected positional arguments"},
		{"invalid port", []string{"serve", "--port", "-1"}, "listen for web UI"},
	} {
		t.Run(test.name, func(t *testing.T) {
			var stdout bytes.Buffer
			err := run(context.Background(), test.args, &stdout, strings.NewReader(""), time.Now)
			if test.want == "" {
				if err != nil || !strings.Contains(stdout.String(), "-no-open") || !strings.Contains(stdout.String(), "-port") {
					t.Fatalf("serve help = %q, error = %v", stdout.String(), err)
				}
			} else if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("error = %v, want %q", err, test.want)
			}
		})
	}
}
