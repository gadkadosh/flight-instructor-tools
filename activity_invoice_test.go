package main

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"
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
	rate := Rate{PreparationCentsPerHour: 2500, BlockCentsPerHour: 3100}
	lines, err := calculateSessionLines(session, date, rate, 0)
	if err != nil {
		t.Fatalf("calculate lines: %v", err)
	}
	want := []Line{
		{Date: date, Description: "Alex - Flugvorbereitung", Minutes: 2, HourlyRateCents: 2500, TotalCents: 83},
		{Date: date, Description: "Alex - Blockzeit", Minutes: 2, HourlyRateCents: 3100, TotalCents: 103},
	}
	if !slices.Equal(lines, want) {
		t.Errorf("lines = %+v, want %+v", lines, want)
	}
}

func TestCalculateSessionLinesBillsSoloSupervisionWithoutStudent(t *testing.T) {
	date := mustTimestamp(t, "2026-05-03T10:00:00Z")
	session := Session{
		Description: "Solo supervision",
		Activities:  []Activity{{ID: "solo-1", Type: ActivitySoloSupervision, Minutes: 61}},
	}
	lines, err := calculateSessionLines(session, date, Rate{BlockCentsPerHour: 3100}, 0)
	if err != nil {
		t.Fatalf("calculate lines: %v", err)
	}
	want := []Line{{Date: date, Description: "Solo supervision", Minutes: 61, HourlyRateCents: 3100, TotalCents: 3152}}
	if !slices.Equal(lines, want) {
		t.Errorf("lines = %+v, want %+v", lines, want)
	}
}

func TestCalculateSessionLinesRejectsInvalidActivities(t *testing.T) {
	for _, test := range []struct {
		name      string
		activity  Activity
		wantError string
	}{
		{"missing type", Activity{ID: "invalid", Minutes: 30}, "type:"},
		{"unknown type", Activity{ID: "invalid", Type: "exam", Minutes: 30}, "type:"},
		{"zero minutes", Activity{ID: "invalid", Type: ActivityDual}, "minutes:"},
		{"negative preparation", Activity{ID: "invalid", Type: ActivityPreparation, Minutes: -1}, "minutes:"},
	} {
		t.Run(test.name, func(t *testing.T) {
			session := Session{Student: "Alex", Activities: []Activity{test.activity}}
			_, err := calculateSessionLines(session, time.Time{}, Rate{}, 0)
			if err == nil || !strings.Contains(err.Error(), test.wantError) {
				t.Fatalf("error = %v, want containing %q", err, test.wantError)
			}
		})
	}
}

func TestRunGenerateMixedActivitiesPreservesInvoice(t *testing.T) {
	args, outputDirectory := setupGenerateTest(t)
	input, err := readSessionFile(filepath.Join("testdata", "minimal-sessions.json"))
	if err != nil {
		t.Fatalf("read sessions: %v", err)
	}
	input.Sessions[0].Activities = []Activity{
		{ID: "prep-1", Type: ActivityPreparation, Minutes: 10},
		{ID: "flight-1", Type: ActivityDual, Minutes: 40},
		{ID: "prep-2", Type: ActivityPreparation, Minutes: 20},
		{ID: "flight-2", Type: ActivitySoloSupervision, Minutes: 25},
	}
	contents, err := json.Marshal(input)
	if err != nil {
		t.Fatalf("encode sessions: %v", err)
	}
	inputPath := filepath.Join(t.TempDir(), "sessions.json")
	if err := os.WriteFile(inputPath, contents, 0o644); err != nil {
		t.Fatalf("write sessions: %v", err)
	}
	args = append(args, "--input", inputPath, "--issue-date", "2026-06-09")
	var stdout bytes.Buffer
	if err := run(context.Background(), args, &stdout, strings.NewReader(""), time.Now); err != nil {
		t.Fatalf("generate invoice: %v", err)
	}
	snapshot, err := os.ReadFile(filepath.Join(outputDirectory, "Rechnung-2026-05.json"))
	if err != nil {
		t.Fatalf("read snapshot: %v", err)
	}
	want, err := os.ReadFile(filepath.Join("testdata", "minimal-snapshot.json"))
	if err != nil {
		t.Fatalf("read expected snapshot: %v", err)
	}
	if !bytes.Equal(snapshot, want) {
		t.Errorf("mixed activities changed the expected invoice:\n%s", snapshot)
	}
	html, err := os.ReadFile(filepath.Join(outputDirectory, "Rechnung-2026-05.html"))
	if err != nil {
		t.Fatalf("read HTML: %v", err)
	}
	for _, text := range []string{"Alex Beispiel - Flugvorbereitung", "Alex Beispiel - Blockzeit", ">0:30<", ">1:05<", ">45,00 €<"} {
		if !bytes.Contains(html, []byte(text)) {
			t.Errorf("HTML does not contain %q", text)
		}
	}
}
