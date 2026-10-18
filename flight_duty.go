package main

import (
	"fmt"
	"strconv"
	"strings"
	"time"
)

// DutyReportLine is one calendar slot. A nonexistent date has an empty Date;
// a non-working day has zero Start/End and no durations.
type DutyReportLine struct {
	Day          int       `json:"day"`
	Date         string    `json:"date,omitempty"`
	Start        time.Time `json:"start,omitzero"`
	End          time.Time `json:"end,omitzero"`
	DutyMinutes  int       `json:"dutyMinutes"` // Both working time and flight-duty time.
	BlockMinutes int       `json:"blockMinutes"`
	DutyOffUntil time.Time `json:"dutyOffUntil,omitzero"`
}

type DutyReportTotals struct {
	CarryOver    int `json:"carryOver"`    // Flight-duty minutes before this month.
	CurrentMonth int `json:"currentMonth"` // Flight-duty minutes in this month.
	CurrentYear  int `json:"currentYear"`  // CarryOver + CurrentMonth, not inferred from input.
	BlockMinutes int `json:"blockMinutes"` // Personal block minutes in this month only.
}

type DutyReport struct {
	IssueDate time.Time          `json:"issueDate"`
	Month     string             `json:"month"`
	TimeZone  string             `json:"timeZone"`
	Issuer    Party              `json:"issuer"`
	Lines     [31]DutyReportLine `json:"lines"`
	Totals    DutyReportTotals   `json:"totals"`
}

func dutyReportLocation(config Config) (*time.Location, error) {
	if config.TimeZone == "" || config.TimeZone == "Local" {
		return nil, fmt.Errorf("timeZone: duty reports require an explicit IANA timezone (for example Europe/Berlin); Local is not supported")
	}
	location, err := time.LoadLocation(config.TimeZone)
	if err != nil {
		return nil, fmt.Errorf("timeZone %q: %w", config.TimeZone, err)
	}
	return location, nil
}

func buildDutyReport(sessions []Session, config Config, month string, issueDate time.Time, carryOver int) (DutyReport, error) {
	location, err := dutyReportLocation(config)
	if err != nil {
		return DutyReport{}, err
	}
	first, err := time.ParseInLocation("2006-01", month, location)
	if err != nil || first.Format("2006-01") != month {
		return DutyReport{}, fmt.Errorf("month must use YYYY-MM format: %q", month)
	}
	if carryOver < 0 {
		return DutyReport{}, fmt.Errorf("flight-duty carry-over must not be negative")
	}
	report := DutyReport{IssueDate: issueDate, Month: month, TimeZone: config.TimeZone, Issuer: config.Issuer}
	next := first.AddDate(0, 1, 0)
	for i := range report.Lines {
		line := &report.Lines[i]
		line.Day = i + 1
		date := first.AddDate(0, 0, i)
		if date.Before(next) {
			line.Date = date.Format("2006-01-02")
		}
	}
	for _, session := range sessions {
		start, end := session.DutyStart.In(location), session.DutyEnd.In(location)
		// Ignore unrelated months, but catch intervals crossing into this month too.
		if !start.Before(next) || end.Before(first) {
			continue
		}
		if start.Format("2006-01-02") != end.Format("2006-01-02") {
			return DutyReport{}, fmt.Errorf("session %q crosses local midnight in %s (%s to %s); duty reports require same-day sessions", session.ID, config.TimeZone, start.Format(time.RFC3339), end.Format(time.RFC3339))
		}
		if start.Before(first) {
			continue
		}
		line := &report.Lines[start.Day()-1]
		if line.Start.IsZero() || start.Before(line.Start) {
			line.Start = start
		}
		if line.End.IsZero() || end.After(line.End) {
			line.End = end
		}
		for _, activity := range session.Activities {
			if activity.Type == ActivityDual {
				line.BlockMinutes += activity.Minutes
			}
		}
	}
	for i := range report.Lines {
		line := &report.Lines[i]
		if line.Start.IsZero() {
			continue
		}
		line.DutyMinutes = int(line.End.Sub(line.Start) / time.Minute)
		line.DutyOffUntil = line.End.Add(12 * time.Hour)
		report.Totals.CurrentMonth += line.DutyMinutes
		report.Totals.BlockMinutes += line.BlockMinutes
	}
	if carryOver > int(^uint(0)>>1)-report.Totals.CurrentMonth {
		return DutyReport{}, fmt.Errorf("flight-duty carry-over plus current month is too large")
	}
	report.Totals.CarryOver = carryOver
	report.Totals.CurrentYear = carryOver + report.Totals.CurrentMonth
	return report, nil
}

func parseCarryOver(value string) (int, error) {
	hours, minutes, ok := strings.Cut(value, ":")
	valid := ok && len(hours) > 0 && len(minutes) == 2
	for _, digit := range hours + minutes {
		valid = valid && digit >= '0' && digit <= '9'
	}
	h, hErr := strconv.Atoi(hours)
	m, mErr := strconv.Atoi(minutes)
	if !valid || hErr != nil || mErr != nil || m > 59 || h > (int(^uint(0)>>1)-m)/60 {
		return 0, fmt.Errorf("--carry-over-flight-duty must use nonnegative hours:minutes (for example 120:00 or 0:00): %q", value)
	}
	return h*60 + m, nil
}
