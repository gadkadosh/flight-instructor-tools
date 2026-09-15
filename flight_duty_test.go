package main

import (
	"path/filepath"
	"testing"
	"time"
)

func TestBuildFlightDuty(t *testing.T) {
	input, err := readSessionFile(filepath.Join("testdata", "minimal-sessions.json"))
	if err != nil {
		t.Fatalf("read session file: %v", err)
	}

	config, err := readConfig(filepath.Join("testdata", "minimal-config.json"))
	if err != nil {
		t.Fatalf("read config: %v", err)
	}

	sessions, err := selectSessions(input.Sessions, "2026-05")
	if err != nil {
		t.Fatalf("select sessions: %v", err)
	}

	issueDate := time.Date(2026, time.June, 10, 0, 0, 0, 0, time.Local)
	dutyReport, err := buildDutyReport(sessions, config, "2026-05", issueDate, 120)
	if err != nil {
		t.Fatalf("build duty report: %v", err)
	}

	if !dutyReport.IssueDate.Equal(issueDate) {
		t.Errorf("issue date = %v, want %v", dutyReport.IssueDate, issueDate)
	}
	if got, expected := dutyReport.Month, "2026-05"; got != expected {
		t.Errorf("month = %v, want %v", dutyReport.Month, expected)
	}
	if got, expected := len(dutyReport.Lines), 31; got != expected {
		t.Errorf("len(Lines) = %v, want %v", got, expected)
	}

	for day, line := range dutyReport.Lines {
		if day == 3 {
			if got, expected := line.BlockMinutes, 65; got != expected {
				t.Errorf("block time = %d, want %v", got, expected)
			}
		} else {
			if !line.Start.IsZero() {
				t.Errorf("start time not empty for day %d", day)
			}
			if !line.End.IsZero() {
				t.Errorf("end time not empty for day %d", day)
			}
			if line.DutyTime != 0 {
				t.Errorf("duty time is not zero for day %d", day)
			}
			if line.BlockMinutes != 0 {
				t.Errorf("block time is not zero for day %d", day)
			}
			if !line.DutyOffUntil.IsZero() {
				t.Errorf("duty off time not empty for day %d", day)
			}
		}
	}

	if got, expected := dutyReport.Totals.CarryOver, 120; got != expected {
		t.Errorf("carryOver = %v, want %d", got, expected)
	}
	if got, expected := dutyReport.Totals.CurrentMonth, 0; got != expected {
		t.Errorf("currentMonth = %v, want %d", got, expected)
	}
	if got, expected := dutyReport.Totals.CurrentYear, 120; got != expected {
		t.Errorf("currentYear = %v, want %d", got, expected)
	}
}
