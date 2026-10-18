package main

import (
	"strings"
	"testing"
	"time"
)

func dutySession(t *testing.T, id, start, end string, activities ...Activity) Session {
	t.Helper()
	return Session{ID: id, DutyStart: mustTimestamp(t, start), DutyEnd: mustTimestamp(t, end), Student: "Test Student", Activities: activities}
}

func TestDutyReportDailySpansAndPersonalBlock(t *testing.T) {
	sessions := []Session{
		dutySession(t, "afternoon", "2026-05-03T14:00:00+02:00", "2026-05-03T15:30:00+02:00",
			Activity{ID: "dual-1", Type: ActivityDual, Minutes: 65}),
		dutySession(t, "morning", "2026-05-03T09:00:00+02:00", "2026-05-03T10:00:00+02:00",
			Activity{ID: "prep", Type: ActivityPreparation, Minutes: 30},
			Activity{ID: "dual-2", Type: ActivityDual, Minutes: 30}),
		dutySession(t, "solo", "2026-05-04T09:00:00+02:00", "2026-05-04T13:00:00+02:00",
			Activity{ID: "supervision", Type: ActivitySoloSupervision, Minutes: 180}),
		dutySession(t, "overlapping-dual", "2026-05-04T10:00:00+02:00", "2026-05-04T11:00:00+02:00",
			Activity{ID: "dual-3", Type: ActivityDual, Minutes: 60}),
		dutySession(t, "solo-only", "2026-05-05T11:00:00+02:00", "2026-05-05T14:00:00+02:00",
			Activity{ID: "supervision-2", Type: ActivitySoloSupervision, Minutes: 120}),
	}
	issueDate := mustTimestamp(t, "2026-06-10T00:00:00+02:00")
	report, err := buildDutyReport(sessions, Config{TimeZone: "Europe/Berlin"}, "2026-05", issueDate, 7200)
	if err != nil {
		t.Fatal(err)
	}
	if report.Month != "2026-05" || !report.IssueDate.Equal(issueDate) || report.TimeZone != "Europe/Berlin" {
		t.Fatalf("report metadata = %+v", report)
	}
	for _, test := range []struct {
		day, duty, block int
		start, end, rest string
	}{
		{3, 390, 95, "09:00", "15:30", "2026-05-04 03:30"},
		{4, 240, 60, "09:00", "13:00", "2026-05-05 01:00"},
		{5, 180, 0, "11:00", "14:00", "2026-05-06 02:00"},
	} {
		line := report.Lines[test.day-1]
		if line.Day != test.day || line.DutyMinutes != test.duty || line.BlockMinutes != test.block ||
			line.Start.Format("15:04") != test.start || line.End.Format("15:04") != test.end ||
			line.DutyOffUntil.Format("2006-01-02 15:04") != test.rest {
			t.Errorf("day %d = %+v, want %+v", test.day, line, test)
		}
	}
	if want := (DutyReportTotals{CarryOver: 7200, CurrentMonth: 810, CurrentYear: 8010, BlockMinutes: 155}); report.Totals != want {
		t.Errorf("totals = %+v, want %+v", report.Totals, want)
	}
	for _, line := range report.Lines {
		if line.Day >= 3 && line.Day <= 5 {
			continue
		}
		if !line.Start.IsZero() || !line.End.IsZero() || !line.DutyOffUntil.IsZero() || line.DutyMinutes != 0 || line.BlockMinutes != 0 {
			t.Errorf("non-working day not blank: %+v", line)
		}
	}
}

func TestDutyReportDoesNotCapOrDeduplicateOverlappingDual(t *testing.T) {
	var sessions []Session
	for _, id := range []string{"a", "b"} {
		sessions = append(sessions, dutySession(t, id, "2026-05-01T09:00:00Z", "2026-05-01T10:00:00Z",
			Activity{ID: id, Type: ActivityDual, Minutes: 90}))
	}
	report, err := buildDutyReport(sessions, Config{TimeZone: "UTC"}, "2026-05", time.Time{}, 0)
	if err != nil {
		t.Fatal(err)
	}
	if line := report.Lines[0]; line.DutyMinutes != 60 || line.BlockMinutes != 180 {
		t.Fatalf("overlapping dual = %+v, want duty 60 and block 180", line)
	}
}

func TestDutyReportTimeZoneAndElapsedTime(t *testing.T) {
	for _, test := range []struct {
		name, month, start, end, rest string
		day, duty                     int
	}{
		{"UTC previous month becomes local first day", "2026-05", "2026-04-30T22:15:00Z", "2026-04-30T23:30:00Z", "2026-05-01 13:30 +0200", 1, 75},
		{"last day", "2026-05", "2026-05-31T19:00:00Z", "2026-05-31T21:00:00Z", "2026-06-01 11:00 +0200", 31, 120},
		{"spring duty elapsed", "2026-03", "2026-03-29T00:30:00Z", "2026-03-29T02:30:00Z", "2026-03-29 16:30 +0200", 29, 120},
		{"fall duty elapsed", "2026-10", "2026-10-25T00:30:00Z", "2026-10-25T02:30:00Z", "2026-10-25 15:30 +0100", 25, 120},
		{"spring rest elapsed", "2026-03", "2026-03-28T19:00:00Z", "2026-03-28T20:00:00Z", "2026-03-29 10:00 +0200", 28, 60},
		{"fall rest elapsed", "2026-10", "2026-10-24T19:00:00Z", "2026-10-24T20:00:00Z", "2026-10-25 09:00 +0100", 24, 60},
	} {
		t.Run(test.name, func(t *testing.T) {
			session := dutySession(t, "test", test.start, test.end, Activity{ID: "dual", Type: ActivityDual, Minutes: 20})
			report, err := buildDutyReport([]Session{session}, Config{TimeZone: "Europe/Berlin"}, test.month, time.Time{}, 0)
			if err != nil {
				t.Fatal(err)
			}
			line := report.Lines[test.day-1]
			if line.DutyMinutes != test.duty || line.BlockMinutes != 20 || line.Start.Location().String() != "Europe/Berlin" ||
				line.DutyOffUntil.Format("2006-01-02 15:04 -0700") != test.rest {
				t.Errorf("line = %+v; want duty %d, rest %s", line, test.duty, test.rest)
			}
		})
	}
}

func TestDutyReportUsesLocalMonthInsteadOfTimestampMonth(t *testing.T) {
	session := dutySession(t, "local-june", "2026-05-31T22:15:00Z", "2026-05-31T23:15:00Z", Activity{ID: "dual", Type: ActivityDual, Minutes: 45})
	may, err := buildDutyReport([]Session{session}, Config{TimeZone: "Europe/Berlin"}, "2026-05", time.Time{}, 0)
	if err != nil {
		t.Fatal(err)
	}
	june, err := buildDutyReport([]Session{session}, Config{TimeZone: "Europe/Berlin"}, "2026-06", time.Time{}, 0)
	if err != nil {
		t.Fatal(err)
	}
	if may.Totals.CurrentMonth != 0 || !may.Lines[30].Start.IsZero() || june.Lines[0].DutyMinutes != 60 || june.Lines[0].BlockMinutes != 45 || june.Lines[0].Start.Format("15:04") != "00:15" {
		t.Fatalf("incorrect local-month selection: May %+v, June %+v", may.Totals, june.Lines[0])
	}
}

func TestDutyReportEmptyMonthsAndCalendarSlots(t *testing.T) {
	unrelated := dutySession(t, "unrelated", "2025-12-31T23:00:00Z", "2026-01-01T01:00:00Z")
	for _, test := range []struct {
		month string
		days  int
	}{{"2026-02", 28}, {"2028-02", 29}, {"2026-04", 30}, {"2026-05", 31}} {
		report, err := buildDutyReport([]Session{unrelated}, Config{TimeZone: "UTC"}, test.month, time.Time{}, 123)
		if err != nil {
			t.Fatal(err)
		}
		if len(report.Lines) != 31 || report.Totals != (DutyReportTotals{CarryOver: 123, CurrentYear: 123}) {
			t.Fatalf("empty %s report = %+v", test.month, report)
		}
		for i, line := range report.Lines {
			if (line.Date != "") != (i < test.days) || !line.Start.IsZero() || line.DutyMinutes != 0 {
				t.Errorf("%s day %d = %+v", test.month, i+1, line)
			}
		}
	}
}

func TestDutyReportRejectsLocalMidnightButInvoiceDoesNot(t *testing.T) {
	session := dutySession(t, "overnight", "2026-04-30T21:30:00Z", "2026-04-30T22:30:00Z",
		Activity{ID: "dual", Type: ActivityDual, Minutes: 60})
	for _, month := range []string{"2026-04", "2026-05"} {
		_, err := buildDutyReport([]Session{session}, Config{TimeZone: "Europe/Berlin"}, month, time.Time{}, 0)
		if err == nil || !strings.Contains(err.Error(), `session "overnight" crosses local midnight in Europe/Berlin`) {
			t.Fatalf("error = %v, want local-midnight error with session ID", err)
		}
	}
	config, err := readConfig("testdata/minimal-config.json")
	if err != nil {
		t.Fatal(err)
	}
	invoice, err := buildInvoiceDocument([]Session{session}, config, "test", time.Time{})
	if err != nil || invoice.Totals.GrossCents != 3000 {
		t.Fatalf("overnight invoice = %+v, %v; want 3000 cents", invoice, err)
	}
	if _, err := selectSessions([]Session{session}, "2026-05"); err == nil {
		t.Fatal("invoice selection must still reject empty months")
	}
}

func TestDutyReportRequiresExplicitTimeZoneAndValidMonth(t *testing.T) {
	for _, zone := range []string{"", "Local", "Not/AZone"} {
		if _, err := buildDutyReport(nil, Config{TimeZone: zone}, "2026-05", time.Time{}, 0); err == nil || !strings.Contains(err.Error(), "timeZone") {
			t.Errorf("zone %q: error = %v", zone, err)
		}
	}
	for _, month := range []string{"2026-5", "2026-13", "", "../2026-05"} {
		if _, err := buildDutyReport(nil, Config{TimeZone: "UTC"}, month, time.Time{}, 0); err == nil {
			t.Errorf("month %q unexpectedly accepted", month)
		}
	}
}

func TestParseCarryOver(t *testing.T) {
	for _, test := range []struct {
		value string
		want  int
	}{{"0:00", 0}, {"120:00", 7200}, {"1234:59", 74099}, {"1:05", 65}} {
		got, err := parseCarryOver(test.value)
		if err != nil || got != test.want {
			t.Errorf("parse %q = %d, %v; want %d", test.value, got, err, test.want)
		}
	}
	for _, value := range []string{"", "120", "1:5", "1:60", "-1:00", "+1:00", " 1:00", "1:00 ", "1:00:00", ":00", "1.5:00", "999999999999999999999999:00"} {
		if _, err := parseCarryOver(value); err == nil {
			t.Errorf("accepted %q", value)
		}
	}
}
