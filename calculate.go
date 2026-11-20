package main

import (
	"fmt"
	"regexp"
	"slices"
	"strings"
	"time"
)

var invoiceNumberPattern = regexp.MustCompile(`^[0-9]{4}-[0-9]+$`)

func buildInvoiceDocument(sessions []Session, config Config, number string, issueDate time.Time) (Document, error) {
	if !invoiceNumberPattern.MatchString(number) {
		return Document{}, fmt.Errorf("invoice number must use year-running number, for example 2026-01")
	}
	orderedSessions := slices.Clone(sessions)
	slices.SortStableFunc(orderedSessions, func(a, b Session) int {
		return a.DutyStart.Compare(b.DutyStart)
	})

	var lines []Line
	for _, session := range orderedSessions {
		sessionDate := session.DutyStart.In(config.location)
		newLines, err := calculateSessionLines(session, sessionDate, config.Rates, config.VATRatePercent)
		if err != nil {
			return Document{}, fmt.Errorf("session %q: %w", session.ID, err)
		}

		lines = append(lines, newLines...)
	}

	netCents := 0
	for _, line := range lines {
		netCents += line.TotalCents
	}

	return Document{
		Number:       number,
		IssueDate:    issueDate,
		Currency:     config.Currency,
		Issuer:       config.Issuer,
		Customer:     config.Customer,
		Lines:        lines,
		Totals:       Totals{NetCents: netCents, VATCents: 0, GrossCents: netCents},
		PaymentText:  config.PaymentText,
		VATStatement: config.VATStatement,
		ClosingText:  config.ClosingText,
		TaxNumber:    config.TaxNumber,
		BankDetails:  config.BankDetails,
	}, nil
}

// selectSessions returns the sessions starting in month, the first instant of a
// local calendar month.
func selectSessions(sessions []Session, month time.Time) ([]Session, error) {
	next := month.AddDate(0, 1, 0)
	var selected []Session
	for _, session := range sessions {
		if !session.DutyStart.Before(month) && session.DutyStart.Before(next) {
			selected = append(selected, session)
		}
	}

	if len(selected) == 0 {
		return selected, fmt.Errorf("no session found for month %s", month.Format("2006-01"))
	}

	return selected, nil
}

func calculateSessionLines(session Session, date time.Time, rates Rates, vatRatePercent int) ([]Line, error) {
	preparationMinutes, blockMinutes := 0, 0
	var blockLabels []string
	for _, activity := range session.Activities {
		if err := activity.validate(); err != nil {
			return nil, fmt.Errorf("activity %q: %w", activity.ID, err)
		}
		if activity.Type == ActivityPreparation {
			preparationMinutes += activity.Minutes
		} else {
			blockMinutes += activity.Minutes
			label := activityKinds[activity.Type].invoiceLabel
			if !slices.Contains(blockLabels, label) {
				blockLabels = append(blockLabels, label)
			}
		}
	}

	slices.Sort(blockLabels)
	lines := make([]Line, 0, 2)
	if preparationMinutes > 0 {
		description := invoiceDescription(session.Student, activityKinds[ActivityPreparation].invoiceLabel)
		lines = append(lines, newInvoiceLine(date, description, preparationMinutes, rates.PreparationCentsPerHour, vatRatePercent))
	}
	if blockMinutes > 0 {
		description := invoiceDescription(session.Student, strings.Join(blockLabels, " / "))
		lines = append(lines, newInvoiceLine(date, description, blockMinutes, rates.BlockCentsPerHour, vatRatePercent))
	}

	if len(lines) == 0 {
		return nil, fmt.Errorf("has no billable duration")
	}
	return lines, nil
}

func invoiceDescription(student, label string) string {
	if student = strings.TrimSpace(student); student != "" {
		return student + " - " + label
	}
	return label
}

func newInvoiceLine(date time.Time, description string, minutes, hourlyRateCents, vatRatePercent int) Line {
	return Line{
		Date:            date,
		Description:     description,
		Minutes:         minutes,
		HourlyRateCents: hourlyRateCents,
		VATRatePercent:  vatRatePercent,
		TotalCents:      roundHalfUp(minutes*hourlyRateCents, 60),
	}
}

func roundHalfUp(numerator, denominator int) int {
	return (numerator + denominator/2) / denominator
}

func (config Config) parseMonth(value string) (time.Time, error) {
	month, err := time.ParseInLocation("2006-01", value, config.location)
	if err != nil || month.Format("2006-01") != value {
		return time.Time{}, fmt.Errorf("month must use YYYY-MM format: %q", value)
	}
	return month, nil
}

func (config Config) parseDate(value string) (time.Time, error) {
	date, err := time.ParseInLocation("2006-01-02", value, config.location)
	if err != nil || date.Format("2006-01-02") != value {
		return time.Time{}, fmt.Errorf("must be a valid date in YYYY-MM-DD format: %q", value)
	}
	return date, nil
}

func (config Config) issueDate(value string, now func() time.Time) (time.Time, error) {
	if value == "" {
		today := now().In(config.location)
		return time.Date(today.Year(), today.Month(), today.Day(), 0, 0, 0, 0, config.location), nil
	}
	date, err := config.parseDate(value)
	if err != nil {
		return time.Time{}, fmt.Errorf("issue date: %w", err)
	}
	return date, nil
}
