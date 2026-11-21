package main

import (
	"fmt"
	"net/http"
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
	w.Header().Set("Cache-Control", "no-store")
	var entry sessionEntry
	if !decodeJSONRequest(w, r, &entry, "session") {
		return
	}
	view, err := source.read()
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, err)
		return
	}
	location, _ := time.LoadLocation(view.TimeZone) // Already checked by read.
	start, err := parseSessionTime(entry.DutyStart, location)
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, fmt.Errorf("duty start: %w", err))
		return
	}
	end, err := parseSessionTime(entry.DutyEnd, location)
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, fmt.Errorf("duty end: %w", err))
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
				writeJSONError(w, http.StatusConflict, fmt.Errorf("session ID already exists with different values; reload before trying again"))
				return
			}
			writeSessionView(w, http.StatusOK, view)
			return
		}
	}
	view.Sessions = append(view.Sessions, session)
	input := SessionFile{SchemaVersion: supportedSessionSchemaVersion, Sessions: view.Sessions}
	if err := validateSessionFile(input); err != nil {
		writeJSONError(w, http.StatusBadRequest, err)
		return
	}
	if err := writeSessionFile(source.sessionsPath, input); err != nil {
		writeJSONError(w, http.StatusInternalServerError, fmt.Errorf("save sessions: %w", err))
		return
	}
	writeSessionView(w, http.StatusCreated, view)
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
