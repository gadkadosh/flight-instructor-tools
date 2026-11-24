package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"testing"
	"time"
)

func TestReadSessionFileRejectsDuplicateSessionIDs(t *testing.T) {
	input, err := readSessionFile(filepath.Join("testdata", "minimal-sessions.json"))
	if err != nil {
		t.Fatal(err)
	}
	first := input.Sessions[0]
	middle := first
	middle.ID = "another-session"
	duplicate := first
	duplicate.Student = "Another student"
	input.Sessions = []Session{first, middle, duplicate}
	contents, err := json.Marshal(input)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "sessions.json")
	if err := os.WriteFile(path, contents, 0o600); err != nil {
		t.Fatal(err)
	}
	_, err = readSessionFile(path)
	want := `sessions[2].id: duplicate "` + first.ID + `" (first used at sessions[0].id)`
	if err == nil || !strings.Contains(err.Error(), want) {
		t.Fatalf("error = %v, want containing %q", err, want)
	}
}

// testFlight is a valid flight of the given block minutes.
func testFlight(id string, activityType ActivityType, minutes int) Activity {
	blockOff := time.Date(2026, 5, 3, 10, 0, 0, 0, time.UTC)
	return Activity{ID: id, Type: activityType, Flight: &Flight{
		BlockOff: blockOff, BlockOn: blockOff.Add(time.Duration(minutes) * time.Minute),
		Departure: "EDFE", Arrival: "EDFE", Registration: "D-EFTI", Landings: 1,
	}}
}

// shiftSession moves a copy of the session, flights included.
func shiftSession(session Session, by time.Duration) Session {
	session.DutyStart, session.DutyEnd = session.DutyStart.Add(by), session.DutyEnd.Add(by)
	session.Activities = slices.Clone(session.Activities)
	for index, activity := range session.Activities {
		if activity.Flight == nil {
			continue
		}
		flight := *activity.Flight
		flight.BlockOff, flight.BlockOn = flight.BlockOff.Add(by), flight.BlockOn.Add(by)
		if !flight.FirstTakeoff.IsZero() {
			flight.FirstTakeoff, flight.LastLanding = flight.FirstTakeoff.Add(by), flight.LastLanding.Add(by)
		}
		session.Activities[index].Flight = &flight
	}
	return session
}

func TestReadSessionFileRejectsInvalidInput(t *testing.T) {
	const valid = `{"schemaVersion":4,"sessions":[{"id":"session-1","dutyStart":"2026-05-03T10:00:00Z","dutyEnd":"2026-05-03T12:00:00Z","student":"Alex","activities":[` +
		`{"id":"activity-1","type":"dual","blockOff":"2026-05-03T10:30:00Z","blockOn":"2026-05-03T11:30:00Z","firstTakeoff":"2026-05-03T10:35:00Z","lastLanding":"2026-05-03T11:25:00Z","departure":"EDFE","arrival":"EDFZ","registration":"D-EFTI","landings":3},` +
		`{"id":"prep-1","type":"preparation","minutes":30}]}]}`
	const flight = "sessions[0].activities[0]."
	tests := []struct {
		name        string
		find        string
		replaceWith string
		wantError   string
	}{
		{"old schema", `"schemaVersion":4`, `"schemaVersion":1`, "schemaVersion: got 1, want 4"},
		{"previous schema", `"schemaVersion":4`, `"schemaVersion":3`, "schemaVersion: got 3, want 4"},
		{"future schema", `"schemaVersion":4`, `"schemaVersion":5`, "schemaVersion: got 5, want 4"},
		{"missing session ID", `"id":"session-1",`, ``, "sessions[0].id"},
		{"dot session ID", `"id":"session-1"`, `"id":"."`, `sessions[0].id: must not be "."`},
		{"dot-dot session ID", `"id":"session-1"`, `"id":".."`, `sessions[0].id: must not be ".."`},
		{"dutyStart date is null", `"dutyStart":"2026-05-03T10:00:00Z"`, `"dutyStart":null`, "sessions[0].dutyStart: missing or zero"},
		{"missing dutyStart date", `"dutyStart":"2026-05-03T10:00:00Z",`, ``, "sessions[0].dutyStart: missing or zero"},
		{"dutyEnd date is null", `"dutyEnd":"2026-05-03T12:00:00Z"`, `"dutyEnd":null`, "sessions[0].dutyEnd: missing or zero"},
		{"missing dutyEnd date", `"dutyEnd":"2026-05-03T12:00:00Z",`, ``, "sessions[0].dutyEnd: missing or zero"},
		{"invalid dutyStart date", `2026-05-03T10:00:00Z`, `2026-02-30T10:00:00Z`, "2026-02-30T10:00:00Z"},
		{"invalid dutyEnd date", `2026-05-03T12:00:00Z`, `2026-02-30T12:00:00Z`, "2026-02-30T12:00:00Z"},
		{"dutyEnd before dutyStart", `2026-05-03T12:00:00Z`, `2026-05-03T09:00:00Z`, "sessions[0].dutyEnd: must be after dutyStart"},
		{"dutyEnd equals dutyStart", `2026-05-03T12:00:00Z`, `2026-05-03T10:00:00Z`, "sessions[0].dutyEnd: must be after dutyStart"},
		{"missing subject", `"student":"Alex",`, ``, "sessions[0].student: required for training and preparation-only sessions"},
		{"missing activity ID", `"id":"activity-1",`, ``, flight + "id"},
		{"blank activity ID", `"id":"activity-1"`, `"id":" "`, flight + "id"},
		{"missing type", `"type":"dual",`, ``, flight + "type"},
		{"null type", `"type":"dual"`, `"type":null`, flight + "type"},
		{"unknown type", `"type":"dual"`, `"type":"exam"`, flight + "type"},
		{"flight minutes", `"type":"dual"`, `"type":"dual","minutes":60`, flight + "minutes: flights record blockOff and blockOn instead"},
		{"schema 3 flight", `"blockOff":"2026-05-03T10:30:00Z","blockOn":"2026-05-03T11:30:00Z","firstTakeoff":"2026-05-03T10:35:00Z","lastLanding":"2026-05-03T11:25:00Z","departure":"EDFE","arrival":"EDFZ","registration":"D-EFTI","landings":3`, `"minutes":60`, flight + "minutes: flights record blockOff and blockOn instead"},
		{"missing blockOff", `"blockOff":"2026-05-03T10:30:00Z",`, ``, flight + "blockOff: missing or zero"},
		{"missing blockOn", `"blockOn":"2026-05-03T11:30:00Z",`, ``, flight + "blockOn: missing or zero"},
		{"blockOn equals blockOff", `"blockOn":"2026-05-03T11:30:00Z"`, `"blockOn":"2026-05-03T10:30:00Z"`, flight + "blockOn: must be at least one minute after blockOff"},
		{"blockOn before blockOff", `"blockOn":"2026-05-03T11:30:00Z"`, `"blockOn":"2026-05-03T10:00:00Z"`, flight + "blockOn: must be at least one minute after blockOff"},
		{"blockOff before dutyStart in another offset", `"blockOff":"2026-05-03T10:30:00Z"`, `"blockOff":"2026-05-03T11:59:00+02:00"`, flight + "blockOff: must not be before dutyStart"},
		{"blockOn after dutyEnd", `"blockOn":"2026-05-03T11:30:00Z"`, `"blockOn":"2026-05-03T12:01:00Z"`, flight + "blockOn: must not be after dutyEnd"},
		{"takeoff without landing", `"lastLanding":"2026-05-03T11:25:00Z",`, ``, flight + "firstTakeoff, lastLanding: record both or neither"},
		{"landing without takeoff", `"firstTakeoff":"2026-05-03T10:35:00Z",`, ``, flight + "firstTakeoff, lastLanding: record both or neither"},
		{"takeoff before blockOff", `"firstTakeoff":"2026-05-03T10:35:00Z"`, `"firstTakeoff":"2026-05-03T10:29:00Z"`, flight + "firstTakeoff: must not be before blockOff"},
		{"landing equals takeoff", `"lastLanding":"2026-05-03T11:25:00Z"`, `"lastLanding":"2026-05-03T10:35:00Z"`, flight + "lastLanding: must be after firstTakeoff"},
		{"landing before takeoff", `"lastLanding":"2026-05-03T11:25:00Z"`, `"lastLanding":"2026-05-03T10:31:00Z"`, flight + "lastLanding: must be after firstTakeoff"},
		{"landing after blockOn", `"lastLanding":"2026-05-03T11:25:00Z"`, `"lastLanding":"2026-05-03T11:31:00Z"`, flight + "lastLanding: must not be after blockOn"},
		{"missing departure", `"departure":"EDFE",`, ``, flight + `departure: got ""`},
		{"lowercase departure", `"departure":"EDFE"`, `"departure":"edfe"`, flight + `departure: got "edfe"`},
		{"short arrival", `"arrival":"EDFZ"`, `"arrival":"FRA"`, flight + `arrival: got "FRA"`},
		{"blank registration", `"registration":"D-EFTI"`, `"registration":" "`, flight + "registration: must not be empty"},
		{"zero landings", `"landings":3`, `"landings":0`, flight + "landings: must be positive"},
		{"missing landings", `,"landings":3`, ``, flight + "landings: must be positive"},
		{"fractional landings", `"landings":3`, `"landings":1.5`, "landings"},
		{"preparation flight details", `"minutes":30`, `"minutes":30,"registration":"D-EFTI"`, "sessions[0].activities[1].type: preparation records minutes, not flight details"},
		{"missing preparation minutes", `,"minutes":30`, ``, "sessions[0].activities[1].minutes: must be positive"},
		{"null preparation minutes", `"minutes":30`, `"minutes":null`, "sessions[0].activities[1].minutes: must be positive"},
		{"negative preparation minutes", `"minutes":30`, `"minutes":-1`, "sessions[0].activities[1].minutes: must be positive"},
		{"fractional preparation minutes", `"minutes":30`, `"minutes":1.5`, "minutes"},
		{"legacy preparation field", `"student":"Alex"`, `"student":"Alex","preparationMinutes":30`, `unknown field "preparationMinutes"`},
		{"legacy flights field", `"student":"Alex"`, `"student":"Alex","flights":[]`, `unknown field "flights"`},
		{"legacy block duration", `"landings":3`, `"landings":3,"blockMinutes":60`, `unknown field "blockMinutes"`},
		{"unknown session field", `"student":"Alex"`, `"student":"Alex","unknown":true`, `unknown field "unknown"`},
		{"unknown activity field", `"landings":3`, `"landings":3,"unknown":true`, `unknown field "unknown"`},
		{"trailing content", valid, valid + `trailing content`, "trailing content"},
		{"second JSON value", valid, valid + `{}`, "unexpected second value"},
	}

	path := filepath.Join(t.TempDir(), "sessions.json")
	if err := os.WriteFile(path, []byte(valid), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := readSessionFile(path); err != nil {
		t.Fatalf("valid fixture: %v", err)
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if strings.Count(valid, test.find) != 1 {
				t.Fatal("test replacement must match exactly once")
			}
			contents := strings.Replace(valid, test.find, test.replaceWith, 1)
			path := filepath.Join(t.TempDir(), "sessions.json")
			if err := os.WriteFile(path, []byte(contents), 0o644); err != nil {
				t.Fatalf("write session file: %v", err)
			}
			_, err := readSessionFile(path)
			if err == nil || !strings.Contains(err.Error(), test.wantError) {
				t.Fatalf("error = %v, want containing %q", err, test.wantError)
			}
		})
	}
}

func TestSessionFileRequiresActivities(t *testing.T) {
	for _, activities := range [][]Activity{nil, {}} {
		session := Session{
			ID: "session", Student: "Alex",
			DutyStart: mustTimestamp(t, "2026-05-03T10:00:00Z"),
			DutyEnd:   mustTimestamp(t, "2026-05-03T12:00:00Z"), Activities: activities,
		}
		err := validateSessionFile(SessionFile{SchemaVersion: 4, Sessions: []Session{session}})
		if err == nil || !strings.Contains(err.Error(), "sessions[0].activities: must contain at least one activity") {
			t.Fatalf("activities %#v: error = %v", activities, err)
		}
	}
}

func TestSessionFileRoundTripsActivitiesWithCalculatedBlockMinutes(t *testing.T) {
	airborne := testFlight("airborne", ActivityDual, 65)
	// The block may fill the whole duty, and the time airborne the whole block.
	airborne.FirstTakeoff, airborne.LastLanding = airborne.BlockOff, airborne.BlockOn
	want := []Activity{
		{ID: "prep", Type: ActivityPreparation, Minutes: 30},
		airborne,
		testFlight("solo", ActivitySoloSupervision, 40),
		testFlight("rundflug", ActivityRundflug, 25),
		testFlight("schnupperflug", ActivitySchnupperflug, 20),
	}
	input := SessionFile{SchemaVersion: 4, Sessions: []Session{{
		ID: "session-1", Student: "Robin", Activities: want,
		DutyStart: airborne.BlockOff, DutyEnd: airborne.BlockOn,
	}}}
	path := filepath.Join(t.TempDir(), "sessions.json")
	if err := os.WriteFile(path, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := writeSessionFile(path, input); err != nil {
		t.Fatal(err)
	}
	contents, _ := os.ReadFile(path)
	if strings.Contains(string(contents), `"minutes": 65`) || strings.Count(string(contents), "firstTakeoff") != 1 {
		t.Fatalf("flights must store only block times and an optional takeoff/landing pair:\n%s", contents)
	}
	read, err := readSessionFile(path)
	if err != nil {
		t.Fatal(err)
	}
	got := read.Sessions[0].Activities
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("activities = %+v, want %+v", got, want)
	}
	var minutes []int
	for _, activity := range got {
		minutes = append(minutes, activity.durationMinutes())
	}
	if !slices.Equal(minutes, []int{30, 65, 40, 25, 20}) {
		t.Errorf("minutes = %v", minutes)
	}
}

func TestSessionStudentRequirements(t *testing.T) {
	for _, test := range []struct {
		name         string
		types        []ActivityType
		student      string
		wantRequired bool
	}{
		{"preparation only", []ActivityType{ActivityPreparation}, "", true},
		{"dual", []ActivityType{ActivityDual}, "", true},
		{"solo supervision", []ActivityType{ActivitySoloSupervision}, "", true},
		{"blank student", []ActivityType{ActivityDual}, " \t ", true},
		{"rundflug", []ActivityType{ActivityRundflug}, "", false},
		{"schnupperflug", []ActivityType{ActivitySchnupperflug}, "", false},
		{"special flights with preparation", []ActivityType{ActivityPreparation, ActivityRundflug, ActivitySchnupperflug}, "", false},
		{"dual with special flight", []ActivityType{ActivityRundflug, ActivityDual}, "", true},
		{"solo with special flight", []ActivityType{ActivitySchnupperflug, ActivitySoloSupervision}, "", true},
		{"named mixed session", []ActivityType{ActivityPreparation, ActivityDual, ActivitySoloSupervision, ActivityRundflug, ActivitySchnupperflug}, "Alex", false},
	} {
		t.Run(test.name, func(t *testing.T) {
			session := Session{
				ID: "session", Student: test.student,
				DutyStart: mustTimestamp(t, "2026-05-03T10:00:00Z"),
				DutyEnd:   mustTimestamp(t, "2026-05-03T12:00:00Z"),
			}
			for _, activityType := range test.types {
				activity := testFlight(string(activityType), activityType, 30)
				if activityType == ActivityPreparation {
					activity = Activity{ID: string(activityType), Type: activityType, Minutes: 30}
				}
				session.Activities = append(session.Activities, activity)
			}
			err := validateSessionFile(SessionFile{SchemaVersion: 4, Sessions: []Session{session}})
			if test.wantRequired {
				if err == nil || !strings.Contains(err.Error(), "sessions[0].student: required") {
					t.Fatalf("error = %v, want a required student", err)
				}
			} else if err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestReadConfigValidatesRatesTimeZoneAndAircraft(t *testing.T) {
	fixture, err := os.ReadFile(filepath.Join("examples", "config.json"))
	if err != nil {
		t.Fatalf("read valid config fixture: %v", err)
	}
	for _, test := range []struct{ name, find, replaceWith, wantError string }{
		{"zero block rate", `"blockCentsPerHour": 3000`, `"blockCentsPerHour": 0`, "rates.blockCentsPerHour: must be positive"},
		{"missing rates", `,
  "rates": {
    "preparationCentsPerHour": 2500,
    "blockCentsPerHour": 3000
  }`, ``, "rates.preparationCentsPerHour: must be positive"},
		{"rate history", `{
    "preparationCentsPerHour": 2500,
    "blockCentsPerHour": 3000
  }`, `[{"effectiveFrom": "2026-01-01", "preparationCentsPerHour": 2500, "blockCentsPerHour": 3000}]`, "cannot unmarshal array"},
		{"missing timezone", `"timeZone": "Europe/Berlin",`, ``, "timeZone: required"},
		{"computer timezone", `"Europe/Berlin"`, `"Local"`, "timeZone: required"},
		{"invalid timezone", `"Europe/Berlin"`, `"Not/AZone"`, `timeZone "Not/AZone"`},
		{"aircraft without type", `"typeCode": "P28A"`, `"typeCode": ""`, `aircraft["D-EKLM"].typeCode: must not be empty`},
		{"unknown aircraft class", `"model": "PA-28-181",
      "gearType": "FT",
      "engineType": "Piston",
      "categoryClass": "ASEL"`, `"model": "PA-28-181",
      "gearType": "FT",
      "engineType": "Piston",
      "categoryClass": "SEP"`, `aircraft["D-EKLM"].categoryClass: got "SEP", want one of ASEL`},
	} {
		t.Run(test.name, func(t *testing.T) {
			if strings.Count(string(fixture), test.find) != 1 {
				t.Fatal("test replacement must match exactly once")
			}
			path := filepath.Join(t.TempDir(), "config.json")
			contents := strings.Replace(string(fixture), test.find, test.replaceWith, 1)
			if err := os.WriteFile(path, []byte(contents), 0o644); err != nil {
				t.Fatalf("write config: %v", err)
			}
			_, err := readConfig(path)
			if err == nil || !strings.Contains(err.Error(), test.wantError) {
				t.Fatalf("error = %v, want containing %q", err, test.wantError)
			}
		})
	}
}

func TestConfigParsesDatesAndMonthsInTimeZone(t *testing.T) {
	config, err := readConfig(filepath.Join("examples", "config.json"))
	if err != nil {
		t.Fatal(err)
	}
	month, err := config.parseMonth("2026-06")
	if err != nil || month.Format(time.RFC3339) != "2026-06-01T00:00:00+02:00" {
		t.Errorf("month = %v, %v; want midnight in Europe/Berlin", month, err)
	}
	date, err := config.parseDate("2026-06-09")
	if err != nil || date.Format(time.RFC3339) != "2026-06-09T00:00:00+02:00" {
		t.Errorf("date = %v, %v; want midnight in Europe/Berlin", date, err)
	}
	// 23:30 UTC is already the next day in Berlin.
	today, err := config.issueDate("", func() time.Time { return mustTimestamp(t, "2026-05-31T23:30:00Z") })
	if err != nil || today.Format(time.RFC3339) != "2026-06-01T00:00:00+02:00" {
		t.Errorf("default issue date = %v, %v; want 2026-06-01 in Europe/Berlin", today, err)
	}
	for _, value := range []string{"2026-5", "2026-13", "", "../2026-05", "2026-05-01"} {
		if _, err := config.parseMonth(value); err == nil {
			t.Errorf("month %q unexpectedly accepted", value)
		}
	}
	for _, value := range []string{"2026-02-30", "2026-6-09", "", "2026-06"} {
		if _, err := config.parseDate(value); err == nil {
			t.Errorf("date %q unexpectedly accepted", value)
		}
	}
}
