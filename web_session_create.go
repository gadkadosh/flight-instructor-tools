package main

import (
	"fmt"
	"net/http"
	"slices"
	"strings"
	"time"
)

// Duty and flight times are wall-clock values in the configured timezone, not the browser's.
type sessionEntry struct {
	ID         string          `json:"id"`
	DutyStart  string          `json:"dutyStart"`
	DutyEnd    string          `json:"dutyEnd"`
	Student    string          `json:"student"`
	Activities []activityEntry `json:"activities"`
}

type activityEntry struct {
	ID      string       `json:"id"`
	Type    ActivityType `json:"type"`
	Minutes int          `json:"minutes,omitempty"`
	flightEntry
}

// flightEntry is a Flight with wall-clock times; validateSessionFile checks the result.
type flightEntry struct {
	BlockOff     string `json:"blockOff,omitempty"`
	BlockOn      string `json:"blockOn,omitempty"`
	FirstTakeoff string `json:"firstTakeoff,omitempty"`
	LastLanding  string `json:"lastLanding,omitempty"`
	Departure    string `json:"departure,omitempty"`
	Arrival      string `json:"arrival,omitempty"`
	Registration string `json:"registration,omitempty"`
	Landings     int    `json:"landings,omitempty"`
}

func (entry activityEntry) activity(location *time.Location) (Activity, error) {
	activity := Activity{ID: entry.ID, Type: entry.Type, Minutes: entry.Minutes}
	if entry.flightEntry == (flightEntry{}) {
		return activity, nil
	}
	activity.Flight = &Flight{
		Departure: entry.Departure, Arrival: entry.Arrival,
		Registration: strings.TrimSpace(entry.Registration), Landings: entry.Landings,
	}
	for _, field := range []struct {
		name, value string
		time        *time.Time
	}{
		{"blockOff", entry.BlockOff, &activity.BlockOff},
		{"blockOn", entry.BlockOn, &activity.BlockOn},
		{"firstTakeoff", entry.FirstTakeoff, &activity.FirstTakeoff},
		{"lastLanding", entry.LastLanding, &activity.LastLanding},
	} {
		if field.value == "" {
			continue
		}
		parsed, err := parseSessionTime(field.value, location)
		if err != nil {
			return Activity{}, fmt.Errorf("%s: %w", field.name, err)
		}
		*field.time = parsed
	}
	return activity, nil
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
	session := Session{ID: entry.ID, DutyStart: start, DutyEnd: end, Student: strings.TrimSpace(entry.Student)}
	for index, activityEntry := range entry.Activities {
		activity, err := activityEntry.activity(location)
		if err != nil {
			writeJSONError(w, http.StatusBadRequest, fmt.Errorf("activities[%d].%w", index, err))
			return
		}
		session.Activities = append(session.Activities, activity)
	}
	for _, existing := range view.Sessions {
		if existing.ID == session.ID {
			// A retry after a lost response must not append another session.
			if !existing.DutyStart.Equal(session.DutyStart) || !existing.DutyEnd.Equal(session.DutyEnd) ||
				existing.Student != session.Student ||
				!slices.EqualFunc(existing.Activities, session.Activities, Activity.equal) {
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
					return time.Time{}, fmt.Errorf("%q occurs twice during the clock change in %s; choose an unambiguous time", value, location)
				}
			}
		}
	}
	return parsed, nil
}
