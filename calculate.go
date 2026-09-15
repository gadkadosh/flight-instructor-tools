package main

import (
	"fmt"
	"strings"
	"time"
)

func buildInvoiceDocument(sessions []Session, config Config, number string, issueDate time.Time) (Document, error) {
	var lines []Line
	for _, session := range sessions {
		sessionDate, err := parseDateTime(session.DutyStart)
		if err != nil {
			return Document{}, fmt.Errorf("session %q date: %w", session.ID, err)
		}
		rate, err := rateForDate(config.Rates, sessionDate)
		if err != nil {
			return Document{}, fmt.Errorf("session %q: %w", session.ID, err)
		}

		newLines, err := calculateSessionLines(session, sessionDate, rate, config.VATRatePercent)
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

func selectSessions(sessions []Session, month string) ([]Session, error) {
	requestedMonth, err := parseMonth(month)
	if err != nil {
		return []Session{}, err
	}

	var selected []Session
	for _, session := range sessions {
		date, err := parseDateTime(session.DutyStart)
		if err != nil {
			return []Session{}, fmt.Errorf("session %q date: %w", session.ID, err)
		}
		if date.Year() == requestedMonth.Year() && date.Month() == requestedMonth.Month() {
			selected = append(selected, session)
		}
	}

	if len(selected) == 0 {
		return selected, fmt.Errorf("no session found for month %s", month)
	}

	return selected, nil
}

func rateForDate(rates []Rate, date time.Time) (Rate, error) {
	var selected Rate
	var selectedDate time.Time
	found := false

	for _, rate := range rates {
		effectiveFrom, err := parseDate(rate.EffectiveFrom)
		if err != nil {
			return Rate{}, fmt.Errorf("rate effectiveFrom %q: %w", rate.EffectiveFrom, err)
		}
		if effectiveFrom.After(date) {
			continue
		}
		if !found || effectiveFrom.After(selectedDate) {
			selected = rate
			selectedDate = effectiveFrom
			found = true
		}
	}

	if !found {
		return Rate{}, fmt.Errorf("no rate applies on %s", date.Format("2006-01-02"))
	}
	return selected, nil
}

func calculateSessionLines(session Session, date time.Time, rate Rate, vatRatePercent int) ([]Line, error) {
	subject := strings.TrimSpace(session.Student)
	if subject == "" {
		subject = strings.TrimSpace(session.Description)
	}

	lines := make([]Line, 0, 2)
	if session.PreparationMinutes != nil {
		if *session.PreparationMinutes <= 0 {
			return nil, fmt.Errorf("preparationMinutes must be positive")
		}
		description := subject
		if strings.TrimSpace(session.Student) != "" {
			description += " - Flugvorbereitung"
		}
		lines = append(lines, newInvoiceLine(date, description, *session.PreparationMinutes, rate.PreparationCentsPerHour, vatRatePercent))
	}

	blockMinutes := 0
	for _, flight := range session.Flights {
		if flight.BlockMinutes == nil {
			return nil, fmt.Errorf("flight %q blockMinutes is required", flight.ID)
		}
		if *flight.BlockMinutes <= 0 {
			return nil, fmt.Errorf("flight %q blockMinutes must be positive", flight.ID)
		}
		blockMinutes += *flight.BlockMinutes
	}
	if blockMinutes > 0 {
		description := subject
		if strings.TrimSpace(session.Student) != "" {
			description += " - Blockzeit"
		}
		lines = append(lines, newInvoiceLine(date, description, blockMinutes, rate.BlockCentsPerHour, vatRatePercent))
	}

	if len(lines) == 0 {
		return nil, fmt.Errorf("has no billable duration")
	}
	return lines, nil
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

func parseMonth(value string) (time.Time, error) {
	month, err := time.ParseInLocation("2006-01", value, time.Local)
	if err != nil || month.Format("2006-01") != value {
		return time.Time{}, fmt.Errorf("month must use YYYY-MM format: %q", value)
	}
	return month, nil
}

func parseDate(value string) (time.Time, error) {
	date, err := time.ParseInLocation("2006-01-02", value, time.Local)
	if err != nil || date.Format("2006-01-02") != value {
		if err != nil {
			return time.Time{}, fmt.Errorf("must be a valid date in YYYY-MM-DD format: %w", err)
		}
		return time.Time{}, fmt.Errorf("must be a valid date in YYYY-MM-DD format")
	}
	return date, nil
}

func parseDateTime(value string) (time.Time, error) {
	date, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return time.Time{}, fmt.Errorf("must be a valid date in YYYY-MM-DDTHH:MM:SSZ format (RFC 3339)")
	}
	return date, nil
}
