package main

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type sessionSource struct {
	sessionsPath  string
	configPath    string
	requireConfig bool
}

type sessionView struct {
	Sessions []Session `json:"sessions"`
	TimeZone string    `json:"timeZone"`
}

func webHandler(assets fs.FS, source sessionSource) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/sessions", source.serveSessions)
	var saveMu sync.Mutex
	sessionWrite := func(handler http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			saveMu.Lock()
			defer saveMu.Unlock()
			handler(w, r)
		}
	}
	mux.HandleFunc("POST /api/sessions", sessionWrite(source.createSession))
	mux.HandleFunc("PUT /api/sessions/{id}", sessionWrite(source.updateSession))
	mux.HandleFunc("DELETE /api/sessions/{id}", sessionWrite(source.deleteSession))
	mux.HandleFunc("POST /api/invoice", source.serveInvoice)
	mux.HandleFunc("POST /api/duty-report", source.serveDutyReport)
	mux.Handle("GET /", http.FileServerFS(assets))
	protected := http.NewCrossOriginProtection().Handler(mux)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host := r.Host
		if hostname, _, err := net.SplitHostPort(host); err == nil {
			host = hostname
		}
		// Reject foreign hostnames to prevent DNS rebinding into the local server.
		if host != "127.0.0.1" && !strings.EqualFold(host, "localhost") {
			http.Error(w, "Forbidden", http.StatusForbidden)
			return
		}
		protected.ServeHTTP(w, r)
	})
}

func (source sessionSource) read() (sessionView, error) {
	var input SessionFile
	if err := readJSONFile(source.sessionsPath, &input); err != nil {
		return sessionView{}, fmt.Errorf("read sessions (use --sessions to choose another file): %w", err)
	}
	if err := validateSessionFile(input); err != nil {
		return sessionView{}, fmt.Errorf("validate sessions %q: %w", source.sessionsPath, err)
	}
	// Without a config file there are no documents to date; show times in UTC.
	location := time.UTC
	var config Config
	if err := readJSONFile(source.configPath, &config); err == nil {
		if location, err = loadTimeZone(config.TimeZone); err != nil {
			return sessionView{}, err
		}
	} else if source.requireConfig || !errors.Is(err, os.ErrNotExist) {
		return sessionView{}, fmt.Errorf("read config (use --config to choose another file): %w", err)
	}
	if input.Sessions == nil {
		input.Sessions = []Session{}
	}
	return sessionView{Sessions: input.Sessions, TimeZone: location.String()}, nil
}

func writeSessionFile(path string, input SessionFile) error {
	// Follow a configured symlink instead of replacing the link itself.
	resolved, err := filepath.EvalSymlinks(path)
	if err != nil {
		return err
	}
	info, err := os.Stat(resolved)
	if err != nil {
		return err
	}
	file, err := os.CreateTemp(filepath.Dir(resolved), ".sessions-*.json")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	defer file.Close()
	if err := file.Chmod(info.Mode().Perm()); err != nil {
		return err
	}
	encoder := json.NewEncoder(file)
	encoder.SetIndent("", "  ")
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(input); err != nil {
		return err
	}
	if err := file.Sync(); err != nil {
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	return os.Rename(file.Name(), resolved)
}

func (source sessionSource) serveSessions(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	view, err := source.read()
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, err)
		return
	}
	writeSessionView(w, http.StatusOK, view)
}

func (source sessionSource) save(w http.ResponseWriter, view sessionView, status int) {
	input := SessionFile{SchemaVersion: supportedSessionSchemaVersion, Sessions: view.Sessions}
	if err := validateSessionFile(input); err != nil {
		writeJSONError(w, http.StatusBadRequest, err)
		return
	}
	if err := writeSessionFile(source.sessionsPath, input); err != nil {
		writeJSONError(w, http.StatusInternalServerError, fmt.Errorf("save sessions: %w", err))
		return
	}
	writeSessionView(w, status, view)
}

func sessionETag(session Session) (string, error) {
	data, err := json.Marshal(session)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf(`"%x"`, sha256.Sum256(data)), nil
}

func sameSession(first, second Session) (bool, error) {
	firstTag, firstErr := sessionETag(first)
	secondTag, secondErr := sessionETag(second)
	return firstTag == secondTag, errors.Join(firstErr, secondErr)
}

// matchesSession reports whether the request names the stored version of session, so a change
// based on an outdated copy cannot overwrite a newer one.
func matchesSession(w http.ResponseWriter, r *http.Request, session Session, action string) bool {
	tag, err := sessionETag(session)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, fmt.Errorf("encode session: %w", err))
		return false
	}
	matches := r.Header.Values("If-Match")
	if len(matches) == 0 {
		writeJSONError(w, http.StatusPreconditionRequired, fmt.Errorf("reload the page and review the session before %s", action))
		return false
	}
	if len(matches) != 1 || matches[0] != tag {
		writeJSONError(w, http.StatusPreconditionFailed, fmt.Errorf("this session changed; reload the page and review it before %s", action))
		return false
	}
	return true
}

func writeSessionView(w http.ResponseWriter, status int, view sessionView) {
	type taggedSession struct {
		Session
		ETag string `json:"etag"`
	}
	response := struct {
		Sessions []taggedSession `json:"sessions"`
		TimeZone string          `json:"timeZone"`
	}{Sessions: make([]taggedSession, 0, len(view.Sessions)), TimeZone: view.TimeZone}
	for _, session := range view.Sessions {
		tag, err := sessionETag(session)
		if err != nil {
			writeJSONError(w, http.StatusInternalServerError, fmt.Errorf("encode session: %w", err))
			return
		}
		response.Sessions = append(response.Sessions, taggedSession{Session: session, ETag: tag})
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(response)
}
