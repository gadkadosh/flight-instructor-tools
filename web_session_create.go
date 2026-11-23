package main

import (
	"fmt"
	"net/http"
	"slices"
	"strings"
	"time"
)

// Duty times are wall-clock values in the configured timezone, not the browser's; they are stored in UTC.
// Flight times are absolute, because the form enters them in UTC as logbooks do.
type sessionEntry struct {
	ID         string     `json:"id"`
	DutyStart  string     `json:"dutyStart"`
	DutyEnd    string     `json:"dutyEnd"`
	Student    string     `json:"student"`
	Activities []Activity `json:"activities"`
}

func (source sessionSource) createSession(w http.ResponseWriter, r *http.Request) {
	view, session, ok := source.readEntry(w, r)
	if !ok {
		return
	}
	if index := slices.IndexFunc(view.Sessions, func(existing Session) bool { return existing.ID == session.ID }); index >= 0 {
		// A retry after a lost response must not append another session.
		if same, err := sameSession(view.Sessions[index], session); err != nil {
			writeJSONError(w, http.StatusInternalServerError, err)
		} else if !same {
			writeJSONError(w, http.StatusConflict, fmt.Errorf("session ID already exists with different values; reload before trying again"))
		} else {
			writeSessionView(w, http.StatusOK, view)
		}
		return
	}
	view.Sessions = append(view.Sessions, session)
	source.save(w, view, http.StatusCreated)
}

// readEntry decodes a session from the form along with the current sessions it applies to.
func (source sessionSource) readEntry(w http.ResponseWriter, r *http.Request) (sessionView, Session, bool) {
	w.Header().Set("Cache-Control", "no-store")
	var entry sessionEntry
	if !decodeJSONRequest(w, r, &entry, "session") {
		return sessionView{}, Session{}, false
	}
	view, err := source.read()
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, err)
		return sessionView{}, Session{}, false
	}
	location, _ := time.LoadLocation(view.TimeZone) // Already checked by read.
	start, err := parseSessionTime(entry.DutyStart, location)
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, fmt.Errorf("duty start: %w", err))
		return sessionView{}, Session{}, false
	}
	end, err := parseSessionTime(entry.DutyEnd, location)
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, fmt.Errorf("duty end: %w", err))
		return sessionView{}, Session{}, false
	}
	session := Session{
		ID: entry.ID, DutyStart: start.UTC(), DutyEnd: end.UTC(),
		Student:    strings.TrimSpace(entry.Student),
		Activities: entry.Activities,
	}
	for _, activity := range session.Activities {
		if activity.Flight != nil {
			activity.Registration = strings.TrimSpace(activity.Registration)
		}
	}
	return view, session, true
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
					return time.Time{}, fmt.Errorf("%q occurs twice during the clock change in %s; choose an unambiguous time", value, location)
				}
			}
		}
	}
	return parsed, nil
}
