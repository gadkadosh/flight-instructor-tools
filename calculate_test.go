package main

import (
	"bytes"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"
)

func TestBuildMinimalInvoiceDocument(t *testing.T) {
	input, err := readSessionFile(filepath.Join("testdata", "minimal-sessions.json"))
	if err != nil {
		t.Fatalf("read sessions: %v", err)
	}
	config, err := readConfig(filepath.Join("testdata", "minimal-config.json"))
	if err != nil {
		t.Fatalf("read config: %v", err)
	}
	issueDate := time.Date(2026, time.June, 9, 0, 0, 0, 0, time.Local)

	sessions, err := selectSessions(input.Sessions, "2026-05", time.UTC)
	if err != nil {
		t.Fatalf("select sessions: %v", err)
	}

	document, err := buildInvoiceDocument(sessions, config, "2026-05", issueDate)
	if err != nil {
		t.Fatalf("build invoice document: %v", err)
	}

	if got, want := document.Number, "2026-05"; got != want {
		t.Errorf("invoice number = %q, want %q", got, want)
	}
	if !document.IssueDate.Equal(issueDate) {
		t.Errorf("issue date = %v, want %v", document.IssueDate, issueDate)
	}
	if got, want := len(document.Lines), 2; got != want {
		t.Fatalf("line count = %d, want %d", got, want)
	}

	preparation := document.Lines[0]
	if got, want := preparation.Description, "Alex Beispiel - Flugvorbereitung"; got != want {
		t.Errorf("preparation description = %q, want %q", got, want)
	}
	if got, want := preparation.Minutes, 30; got != want {
		t.Errorf("preparation minutes = %d, want %d", got, want)
	}
	if got, want := preparation.TotalCents, 1250; got != want {
		t.Errorf("preparation total = %d, want %d", got, want)
	}

	block := document.Lines[1]
	if got, want := block.Description, "Alex Beispiel - Blockzeit"; got != want {
		t.Errorf("block description = %q, want %q", got, want)
	}
	if got, want := block.Minutes, 65; got != want {
		t.Errorf("block minutes = %d, want %d", got, want)
	}
	if got, want := block.TotalCents, 3250; got != want {
		t.Errorf("block total = %d, want %d", got, want)
	}
	if got, want := document.Totals, (Totals{NetCents: 4500, VATCents: 0, GrossCents: 4500}); got != want {
		t.Errorf("totals = %+v, want %+v", got, want)
	}

	var rendered bytes.Buffer
	if err := renderInvoiceHTML(&rendered, document, nil); err != nil {
		t.Fatalf("render calculated document: %v", err)
	}
	for _, expected := range []string{"Alex Beispiel - Blockzeit", ">1:05<", ">32,50 €<", ">45,00 €<"} {
		if !strings.Contains(rendered.String(), expected) {
			t.Errorf("rendered invoice does not contain %q", expected)
		}
	}
}

func TestBuildInvoiceDocumentOrdersSessionsByDutyStart(t *testing.T) {
	sessions := []Session{
		{
			ID:         "zulu",
			DutyStart:  mustTimestamp(t, "2026-05-03T12:00:00Z"),
			Student:    "Zulu",
			Activities: []Activity{{ID: "zulu-flight", Type: ActivityDual, Minutes: 60}},
		},
		{
			ID:        "early",
			DutyStart: mustTimestamp(t, "2026-05-03T13:00:00+02:00"),
			Student:   "Early",
			Activities: []Activity{
				{ID: "early-flight", Type: ActivityDual, Minutes: 60},
				{ID: "early-prep", Type: ActivityPreparation, Minutes: 30},
			},
		},
		{
			ID:         "alpha",
			DutyStart:  mustTimestamp(t, "2026-05-03T14:00:00+02:00"),
			Student:    "Alpha",
			Activities: []Activity{{ID: "alpha-flight", Type: ActivityDual, Minutes: 60}},
		},
	}
	config := Config{Rates: []Rate{{EffectiveFrom: "2026-01-01", PreparationCentsPerHour: 2500, BlockCentsPerHour: 3000}}}

	document, err := buildInvoiceDocument(sessions, config, "2026-05", time.Time{})
	if err != nil {
		t.Fatal(err)
	}

	var descriptions []string
	for _, line := range document.Lines {
		descriptions = append(descriptions, line.Description)
	}
	wantDescriptions := []string{"Early - Flugvorbereitung", "Early - Blockzeit", "Zulu - Blockzeit", "Alpha - Blockzeit"}
	if !slices.Equal(descriptions, wantDescriptions) {
		t.Errorf("invoice line order = %q, want %q", descriptions, wantDescriptions)
	}
	for i, want := range []string{"zulu", "early", "alpha"} {
		if got := sessions[i].ID; got != want {
			t.Errorf("input session %d = %q, want %q", i, got, want)
		}
	}
}

func TestInvoiceDatesUseConfiguredTimeZone(t *testing.T) {
	config, err := readConfig("testdata/minimal-config.json")
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		name, zone, start, date, printedDate string
	}{
		{"east of UTC", "Europe/Berlin", "2026-05-31T22:30:00Z", "2026-06-01", "01.06.26"},
		{"west of UTC", "America/New_York", "2026-06-01T00:30:00Z", "2026-05-31", "31.05.26"},
		{"default UTC", "", "2026-06-01T00:30:00+02:00", "2026-05-31", "31.05.26"},
	} {
		t.Run(test.name, func(t *testing.T) {
			config := config
			config.TimeZone = test.zone
			session := Session{
				ID:         "boundary",
				DutyStart:  mustTimestamp(t, test.start),
				Student:    "Alex",
				Activities: []Activity{{ID: "flight", Type: ActivityDual, Minutes: 60}},
			}
			document, err := buildInvoiceDocument([]Session{session}, config, "2026-001", mustTimestamp(t, "2026-07-01T00:00:00Z"))
			if err != nil {
				t.Fatal(err)
			}
			snapshot := newInvoiceSnapshot(document)
			if len(snapshot.Lines) != 1 {
				t.Fatalf("lines = %+v, want one billed flight", snapshot.Lines)
			}
			if got := snapshot.Lines[0].Date; got != test.date {
				t.Errorf("invoice date = %s, want %s", got, test.date)
			}
			var html bytes.Buffer
			if err := renderInvoiceHTML(&html, document, nil); err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(html.String(), test.printedDate) {
				t.Errorf("rendered invoice missing %q", test.printedDate)
			}
		})
	}
}

func mustTimestamp(t *testing.T, value string) time.Time {
	parsed, err := time.Parse(time.RFC3339, value)
	if err != nil {
		t.Fatalf("invalid test timestamp %q: %v", value, err)
	}
	return parsed
}

func TestBuildInvoiceDocumentWithMultipleSessionsAndActivities(t *testing.T) {
	input := SessionFile{
		SchemaVersion: 2,
		Sessions: []Session{
			{
				ID:         "april",
				DutyStart:  mustTimestamp(t, "2026-04-30T10:00:00Z"),
				DutyEnd:    mustTimestamp(t, "2026-04-30T12:00:00Z"),
				Student:    "April Student",
				Activities: []Activity{{ID: "april-flight", Type: ActivityDual, Minutes: 60}},
			},
			{
				ID:        "may-1",
				DutyStart: mustTimestamp(t, "2026-05-03T10:00:00Z"),
				DutyEnd:   mustTimestamp(t, "2026-05-03T11:30:00Z"),
				Student:   "Alex",
				Activities: []Activity{
					{ID: "prep-1", Type: ActivityPreparation, Minutes: 30},
					{ID: "flight-1", Type: ActivityDual, Minutes: 20},
					{ID: "flight-2", Type: ActivitySoloSupervision, Minutes: 30},
				},
			},
			{
				ID:        "may-2",
				DutyStart: mustTimestamp(t, "2026-05-07T10:00:00Z"),
				DutyEnd:   mustTimestamp(t, "2026-05-07T11:30:00Z"),
				Student:   "Robin",
				Activities: []Activity{
					{ID: "flight-3", Type: ActivityDual, Minutes: 40},
					{ID: "flight-4", Type: ActivityDual, Minutes: 50},
				},
			},
			{
				ID:         "may-3",
				DutyStart:  mustTimestamp(t, "2026-05-16T10:00:00Z"),
				DutyEnd:    mustTimestamp(t, "2026-05-16T11:30:00Z"),
				Student:    "Betty",
				Activities: []Activity{{ID: "prep-2", Type: ActivityPreparation, Minutes: 60}},
			},
			{
				ID:         "june",
				DutyStart:  mustTimestamp(t, "2026-06-01T10:00:00Z"),
				DutyEnd:    mustTimestamp(t, "2026-06-01T11:30:00Z"),
				Student:    "June Student",
				Activities: []Activity{{ID: "june-flight", Type: ActivityDual, Minutes: 60}},
			},
		},
	}
	config := Config{
		Currency: "EUR",
		Rates: []Rate{
			{
				EffectiveFrom:           "2026-01-01",
				PreparationCentsPerHour: 2500,
				BlockCentsPerHour:       3000,
			}},
	}
	issueDate := time.Date(2026, time.June, 9, 0, 0, 0, 0, time.Local)

	sessions, err := selectSessions(input.Sessions, "2026-05", time.UTC)
	if err != nil {
		t.Fatalf("select sessions: %v", err)
	}

	document, err := buildInvoiceDocument(sessions, config, "2026-05", issueDate)
	if err != nil {
		t.Fatalf("build invoice document: %v", err)
	}

	expectedLines := []Line{
		{
			Date:            time.Date(2026, 5, 3, 10, 0, 0, 0, time.UTC),
			Description:     "Alex - Flugvorbereitung",
			Minutes:         30,
			HourlyRateCents: 2500,
			VATRatePercent:  0,
			TotalCents:      1250,
		},
		{
			Date:            time.Date(2026, 5, 3, 10, 0, 0, 0, time.UTC),
			Description:     "Alex - Blockzeit",
			Minutes:         50,
			HourlyRateCents: 3000,
			VATRatePercent:  0,
			TotalCents:      2500,
		},
		{
			Date:            time.Date(2026, 5, 7, 10, 0, 0, 0, time.UTC),
			Description:     "Robin - Blockzeit",
			Minutes:         90,
			HourlyRateCents: 3000,
			VATRatePercent:  0,
			TotalCents:      4500,
		},
		{
			Date:            time.Date(2026, 5, 16, 10, 0, 0, 0, time.UTC),
			Description:     "Betty - Flugvorbereitung",
			Minutes:         60,
			HourlyRateCents: 2500,
			VATRatePercent:  0,
			TotalCents:      2500,
		},
	}

	if got, want := len(document.Lines), len(expectedLines); want != got {
		t.Fatalf("Incorrect line count = %d, expected = %d", got, want)
	}

	for i, want := range expectedLines {
		if got := document.Lines[i]; got != want {
			t.Fatalf("Incorrect line %d = %+v, expected = %+v", i, got, want)
		}
	}

	if got, want := document.Totals, (Totals{NetCents: 10750, VATCents: 0, GrossCents: 10750}); got != want {
		t.Fatalf("totals = %+v, want %+v", got, want)
	}
}

func TestSelectSessionsForMonth(t *testing.T) {
	sessions := []Session{
		{ID: "april", DutyStart: mustTimestamp(t, "2026-04-30T12:00:00Z")},
		{ID: "may-1", DutyStart: mustTimestamp(t, "2026-05-03T12:00:00Z")},
		{ID: "may-2", DutyStart: mustTimestamp(t, "2026-05-07T12:00:00Z")},
		{ID: "june", DutyStart: mustTimestamp(t, "2026-06-01T12:00:00Z")},
	}

	selected, err := selectSessions(sessions, "2026-05", time.UTC)
	if err != nil {
		t.Fatalf("select session: %v", err)
	}

	wantIDs := []string{"may-1", "may-2"}

	if got, want := len(selected), len(wantIDs); got != want {
		t.Fatalf("Selected sessions length = %d, want %d", got, want)
	}

	for i, want := range wantIDs {
		if got := selected[i].ID; want != got {
			t.Fatalf("selected session = %q, want %q", got, want)
		}
	}
}

func TestSelectSessionsRejectsNoSessions(t *testing.T) {
	sessions := []Session{{ID: "april", DutyStart: mustTimestamp(t, "2026-04-30T14:00:00Z")}}

	_, err := selectSessions(sessions, "2026-05", time.UTC)
	if err == nil {
		t.Fatal("select session unexpectedly succeeded")
	}
	if !strings.Contains(err.Error(), "no session") {
		t.Fatalf("error %q does not contain no session", err)
	}
}

func TestRateForDateUsesLatestApplicableRate(t *testing.T) {
	rates := []Rate{
		{EffectiveFrom: "2026-06-01", BlockCentsPerHour: 4000},
		{EffectiveFrom: "2025-01-01", BlockCentsPerHour: 2000},
		{EffectiveFrom: "2026-01-01", BlockCentsPerHour: 3000},
	}
	date := time.Date(2026, time.May, 3, 0, 0, 0, 0, time.Local)

	rate, err := rateForDate(rates, date)
	if err != nil {
		t.Fatalf("select rate: %v", err)
	}
	if got, want := rate.BlockCentsPerHour, 3000; got != want {
		t.Fatalf("block rate = %d, want %d", got, want)
	}
}
