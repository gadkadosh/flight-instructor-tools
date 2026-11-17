package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"os"
	"strings"
)

type sessionSource struct {
	inputPath     string
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
	mux.HandleFunc("POST /api/invoice", source.serveInvoice)
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
	if err := readJSONFile(source.inputPath, &input); err != nil {
		return sessionView{}, fmt.Errorf("read sessions (use --input to choose another file): %w", err)
	}
	if err := validateSessionRecords(input); err != nil {
		return sessionView{}, fmt.Errorf("validate sessions %q: %w", source.inputPath, err)
	}
	var config Config
	if err := readJSONFile(source.configPath, &config); err != nil {
		if source.requireConfig || !errors.Is(err, os.ErrNotExist) {
			return sessionView{}, fmt.Errorf("read config (use --config to choose another file): %w", err)
		}
	}
	location, err := config.location()
	if err != nil {
		return sessionView{}, err
	}
	if input.Sessions == nil {
		input.Sessions = []Session{}
	}
	return sessionView{Sessions: input.Sessions, TimeZone: location.String()}, nil
}

func (source sessionSource) serveSessions(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	view, err := source.read()
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}
	json.NewEncoder(w).Encode(view)
}
