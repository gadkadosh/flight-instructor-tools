package main

import (
	"path/filepath"
	"reflect"
	"slices"
	"testing"
)

func TestCalculateSessionLinesGroupsActivitiesBeforeRounding(t *testing.T) {
	date := mustTimestamp(t, "2026-05-03T10:00:00Z")
	session := Session{
		Student: "Alex",
		Activities: []Activity{
			{ID: "flight-1", Type: ActivityDual, Minutes: 1},
			{ID: "prep-1", Type: ActivityPreparation, Minutes: 1},
			{ID: "flight-2", Type: ActivitySoloSupervision, Minutes: 1},
			{ID: "prep-2", Type: ActivityPreparation, Minutes: 1},
		},
	}
	rate := Rates{PreparationCentsPerHour: 2500, BlockCentsPerHour: 3100}
	lines := calculateSessionLines(session, date, rate, 0)
	want := []Line{
		{Date: date, Description: "Alex - Flugvorbereitung", Minutes: 2, HourlyRateCents: 2500, TotalCents: 83},
		{Date: date, Description: "Alex - Blockzeit", Minutes: 2, HourlyRateCents: 3100, TotalCents: 103},
	}
	if !slices.Equal(lines, want) {
		t.Errorf("lines = %+v, want %+v", lines, want)
	}
}

func TestCalculateSessionLinesBillsSpecialFlights(t *testing.T) {
	date := mustTimestamp(t, "2026-05-03T10:00:00Z")
	for _, test := range []struct {
		activityType ActivityType
		student      string
		preparation  string
		block        string
	}{
		{ActivityRundflug, "", "Flugvorbereitung", "Rundflug"},
		{ActivitySchnupperflug, "", "Flugvorbereitung", "Schnupperflug"},
		{ActivityRundflug, " Alex ", "Alex - Flugvorbereitung", "Alex - Rundflug"},
		{ActivitySchnupperflug, "Alex", "Alex - Flugvorbereitung", "Alex - Schnupperflug"},
	} {
		t.Run(test.block, func(t *testing.T) {
			session := Session{
				Student: test.student,
				Activities: []Activity{
					{ID: "prep", Type: ActivityPreparation, Minutes: 2},
					{ID: "flight-1", Type: test.activityType, Minutes: 1},
					{ID: "flight-2", Type: test.activityType, Minutes: 60},
				},
			}
			lines := calculateSessionLines(session, date, Rates{PreparationCentsPerHour: 2500, BlockCentsPerHour: 3100}, 0)
			want := []Line{
				{Date: date, Description: test.preparation, Minutes: 2, HourlyRateCents: 2500, TotalCents: 83},
				{Date: date, Description: test.block, Minutes: 61, HourlyRateCents: 3100, TotalCents: 3152},
			}
			if !slices.Equal(lines, want) {
				t.Fatalf("lines = %+v, want %+v", lines, want)
			}
		})
	}

	t.Run("mixed flights retain a single rounded block charge", func(t *testing.T) {
		session := Session{Student: "Alex", Activities: []Activity{
			{ID: "dual", Type: ActivityDual, Minutes: 1},
			{ID: "solo", Type: ActivitySoloSupervision, Minutes: 1},
			{ID: "rundflug", Type: ActivityRundflug, Minutes: 1},
			{ID: "schnupperflug", Type: ActivitySchnupperflug, Minutes: 1},
		}}
		want := []Line{{Date: date, Description: "Alex - Blockzeit / Rundflug / Schnupperflug", Minutes: 4, HourlyRateCents: 3100, TotalCents: 207}}
		for range 2 {
			if lines := calculateSessionLines(session, date, Rates{BlockCentsPerHour: 3100}, 0); !slices.Equal(lines, want) {
				t.Fatalf("lines = %+v, want %+v", lines, want)
			}
			slices.Reverse(session.Activities)
		}
	})
}

func TestMixedActivitiesPreserveInvoice(t *testing.T) {
	input, err := readSessionFile(filepath.Join("testdata", "minimal-sessions.json"))
	if err != nil {
		t.Fatalf("read sessions: %v", err)
	}
	config, err := readConfig(filepath.Join("testdata", "minimal-config.json"))
	if err != nil {
		t.Fatalf("read config: %v", err)
	}
	issueDate := mustTimestamp(t, "2026-06-09T00:00:00Z")
	want, err := buildInvoiceDocument(input.Sessions, config, "2026-05", issueDate)
	if err != nil {
		t.Fatal(err)
	}
	mixed := slices.Clone(input.Sessions)
	mixed[0].Activities = []Activity{
		{ID: "prep-1", Type: ActivityPreparation, Minutes: 10},
		{ID: "flight-1", Type: ActivityDual, Minutes: 40},
		{ID: "prep-2", Type: ActivityPreparation, Minutes: 20},
		{ID: "flight-2", Type: ActivitySoloSupervision, Minutes: 25},
	}
	got, err := buildInvoiceDocument(mixed, config, "2026-05", issueDate)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("mixed activities changed the invoice:\ngot  %+v\nwant %+v", got, want)
	}
	if len(got.Lines) != 2 || got.Lines[0].Minutes != 30 || got.Lines[1].Minutes != 65 || got.Totals.GrossCents != 4500 {
		t.Errorf("lines = %+v, totals = %+v; want 0:30 preparation and 1:05 block for 45,00 €", got.Lines, got.Totals)
	}
}
