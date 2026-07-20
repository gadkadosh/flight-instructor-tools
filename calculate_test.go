package main

import (
	"bytes"
	"path/filepath"
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

	document, err := buildInvoiceDocument(input, config, "2026-05", "2026-05", issueDate)
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

func TestSelectSingleSessionForMonth(t *testing.T) {
	sessions := []Session{
		{ID: "april", Date: "2026-04-30"},
		{ID: "may", Date: "2026-05-03"},
		{ID: "june", Date: "2026-06-01"},
	}

	selected, err := selectSingleSession(sessions, "2026-05")
	if err != nil {
		t.Fatalf("select session: %v", err)
	}
	if got, want := selected.ID, "may"; got != want {
		t.Fatalf("selected session = %q, want %q", got, want)
	}
}

func TestSelectSingleSessionRejectsUnsupportedCounts(t *testing.T) {
	tests := []struct {
		name     string
		sessions []Session
		want     string
	}{
		{name: "none", sessions: []Session{{ID: "april", Date: "2026-04-30"}}, want: "no session"},
		{name: "multiple", sessions: []Session{{ID: "one", Date: "2026-05-03"}, {ID: "two", Date: "2026-05-04"}}, want: "2 sessions"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := selectSingleSession(test.sessions, "2026-05")
			if err == nil {
				t.Fatal("select session unexpectedly succeeded")
			}
			if !strings.Contains(err.Error(), test.want) {
				t.Fatalf("error %q does not contain %q", err, test.want)
			}
		})
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
