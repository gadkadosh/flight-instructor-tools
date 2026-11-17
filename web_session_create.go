package main

import (
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"
)

// Duty times are wall-clock values in the configured timezone, not the browser's.
type sessionEntry struct {
	ID         string     `json:"id"`
	DutyStart  string     `json:"dutyStart"`
	DutyEnd    string     `json:"dutyEnd"`
	Student    string     `json:"student"`
	Activities []Activity `json:"activities"`
}

func (source sessionSource) createSession(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	fail := func(status int, err error) {
		w.WriteHeader(status)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
	}
	contentType, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if contentType != "application/json" {
		fail(http.StatusUnsupportedMediaType, fmt.Errorf("Content-Type must be application/json"))
		return
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	var entry sessionEntry
	if err := decoder.Decode(&entry); err != nil {
		fail(http.StatusBadRequest, fmt.Errorf("invalid session: %w", err))
		return
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		fail(http.StatusBadRequest, fmt.Errorf("expected a single session"))
		return
	}
	view, err := source.read()
	if err != nil {
		fail(http.StatusInternalServerError, err)
		return
	}
	location, _ := time.LoadLocation(view.TimeZone) // Already checked by read.
	start, err := parseSessionTime(entry.DutyStart, location)
	if err != nil {
		fail(http.StatusBadRequest, fmt.Errorf("duty start: %w", err))
		return
	}
	end, err := parseSessionTime(entry.DutyEnd, location)
	if err != nil {
		fail(http.StatusBadRequest, fmt.Errorf("duty end: %w", err))
		return
	}
	session := Session{
		ID: entry.ID, DutyStart: start, DutyEnd: end,
		Student:    strings.TrimSpace(entry.Student),
		Activities: entry.Activities,
	}
	for _, existing := range view.Sessions {
		if existing.ID == session.ID {
			// A retry after a lost response must not append another session.
			if !existing.DutyStart.Equal(session.DutyStart) || !existing.DutyEnd.Equal(session.DutyEnd) ||
				existing.Student != session.Student ||
				!slices.Equal(existing.Activities, session.Activities) {
				fail(http.StatusConflict, fmt.Errorf("session ID already exists with different values; reload before trying again"))
				return
			}
			json.NewEncoder(w).Encode(view)
			return
		}
	}
	view.Sessions = append(view.Sessions, session)
	input := SessionFile{SchemaVersion: supportedSessionSchemaVersion, Sessions: view.Sessions}
	if err := validateSessionRecords(input); err != nil {
		fail(http.StatusBadRequest, err)
		return
	}
	if err := writeSessionFile(source.inputPath, input); err != nil {
		fail(http.StatusInternalServerError, fmt.Errorf("save sessions: %w", err))
		return
	}
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(view)
}

func parseSessionTime(value string, location *time.Location) (time.Time, error) {
	const layout = "2006-01-02T15:04"
	parsed, err := time.ParseInLocation(layout, value, location)
	if err != nil || parsed.Format(layout) != value {
		return time.Time{}, fmt.Errorf("%q is not a valid local date and time in %s", value, location)
	}
	// A repeated clock hour has two possible instants. Never silently pick one.
	before, after := parsed.ZoneBounds()
	for _, boundary := range []time.Time{before, after} {
		if boundary.IsZero() {
			continue
		}
		_, offsetBefore := boundary.Add(-time.Second).Zone()
		_, offsetAfter := boundary.Zone()
		difference := time.Duration(offsetBefore-offsetAfter) * time.Second
		if difference > 0 {
			for _, alternative := range []time.Time{parsed.Add(difference), parsed.Add(-difference)} {
				if alternative.Format(layout) == value {
					return time.Time{}, fmt.Errorf("%q occurs twice during the clock change in %s; choose an unambiguous duty time", value, location)
				}
			}
		}
	}
	return parsed, nil
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
