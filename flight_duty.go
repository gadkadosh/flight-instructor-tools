package main

import (
	"time"
)

type DutyReportLine struct {
	Start        time.Time
	End          time.Time
	DutyTime     int
	BlockMinutes int
	DutyOffUntil time.Time
}

type DutyReportTotals struct {
	CarryOver    int
	CurrentMonth int
	CurrentYear  int
}

type DutyReport struct {
	IssueDate time.Time
	Month     string
	Issuer    Party
	Lines     [31]DutyReportLine
	Totals    DutyReportTotals
}

func buildDutyReport(sessions []Session, config Config, month string, issueDate time.Time, carryOver int) (DutyReport, error) {
	var lines [31]DutyReportLine
	currentMonth := 0

	for _, session := range sessions {
		date, err := parseDateTime(session.DutyStart)
		if err != nil {
			return DutyReport{}, err
		}
		day := date.Day()
		if day >= 31 {
			return DutyReport{}, err
		}

		// TODO: add flight duty time to currentMonth
		current := &lines[day]
		for _, flight := range session.Flights {
			current.BlockMinutes += *flight.BlockMinutes
		}
	}

	currentYear := carryOver + currentMonth

	return DutyReport{
		IssueDate: issueDate,
		Month:     month,
		Issuer:    config.Issuer,
		Lines:     lines,
		Totals:    DutyReportTotals{CarryOver: carryOver, CurrentMonth: currentMonth, CurrentYear: currentYear},
	}, nil
}
