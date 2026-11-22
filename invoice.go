package main

import (
	"fmt"
	"regexp"
	"slices"
	"strings"
	"time"
)

type Line struct {
	Date            time.Time
	Description     string
	Minutes         int
	HourlyRateCents int
	VATRatePercent  int
	TotalCents      int
}

type Totals struct {
	NetCents   int
	VATCents   int
	GrossCents int
}

type Document struct {
	Number       string
	IssueDate    time.Time
	Currency     string
	Issuer       Party
	Customer     Party
	Lines        []Line
	Totals       Totals
	PaymentText  string
	VATStatement string
	ClosingText  string
	TaxNumber    string
	BankDetails  BankDetails
}

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
		lines = append(lines, calculateSessionLines(session, sessionDate, config.Rates, config.VATRatePercent)...)
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

func calculateSessionLines(session Session, date time.Time, rates Rates, vatRatePercent int) []Line {
	preparationMinutes, blockMinutes := 0, 0
	var blockLabels []string
	for _, activity := range session.Activities {
		kind := activityKinds[activity.Type]
		if !kind.flight {
			preparationMinutes += activity.durationMinutes()
		} else {
			blockMinutes += activity.durationMinutes()
			label := kind.invoiceLabel
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
	return lines
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
