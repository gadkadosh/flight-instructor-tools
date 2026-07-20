package main

import "time"

// ReferenceDocument returns anonymized data shaped like the local reference invoice.
func ReferenceDocument() Document {
	date := func(day int) time.Time {
		return time.Date(2026, time.May, day, 0, 0, 0, 0, time.Local)
	}

	return Document{
		Number:    "2026-05",
		IssueDate: time.Date(2026, time.June, 9, 0, 0, 0, 0, time.Local),
		Currency:  "EUR",
		Issuer: Party{
			Name:         "Erika Musterfrau",
			AddressLines: []string{"Musterstraße 6", "12345 Musterstadt"},
			Email:        "erika@example.com",
		},
		Customer: Party{
			Name:         "Musterflugschule GmbH",
			AddressLines: []string{"Flugplatzstraße 2, 54321 Beispielstadt"},
		},
		Lines: []Line{
			{Date: date(3), Description: "Alex Beispiel - Flugvorbereitung", Minutes: 30, HourlyRateCents: 2500, VATRatePercent: 0, TotalCents: 1250},
			{Date: date(3), Description: "Alex Beispiel - Blockzeit", Minutes: 135, HourlyRateCents: 3000, VATRatePercent: 0, TotalCents: 6750},
			{Date: date(3), Description: "Robin Muster - Flugvorbereitung", Minutes: 60, HourlyRateCents: 2500, VATRatePercent: 0, TotalCents: 2500},
			{Date: date(3), Description: "Robin Muster - Blockzeit", Minutes: 80, HourlyRateCents: 3000, VATRatePercent: 0, TotalCents: 4000},
			{Date: date(10), Description: "Taylor Test - Flugvorbereitung", Minutes: 30, HourlyRateCents: 2500, VATRatePercent: 0, TotalCents: 1250},
			{Date: date(10), Description: "Taylor Test - Blockzeit", Minutes: 30, HourlyRateCents: 3000, VATRatePercent: 0, TotalCents: 1500},
			{Date: date(10), Description: "Chris Beispiel - Flugvorbereitung", Minutes: 30, HourlyRateCents: 2500, VATRatePercent: 0, TotalCents: 1250},
			{Date: date(10), Description: "Chris Beispiel - Blockzeit", Minutes: 122, HourlyRateCents: 3000, VATRatePercent: 0, TotalCents: 6100},
			{Date: date(10), Description: "Robin Muster - Flugvorbereitung", Minutes: 30, HourlyRateCents: 2500, VATRatePercent: 0, TotalCents: 1250},
			{Date: date(10), Description: "Robin Muster - Blockzeit", Minutes: 88, HourlyRateCents: 3000, VATRatePercent: 0, TotalCents: 4400},
			{Date: date(24), Description: "Rundflug 45°", Minutes: 45, HourlyRateCents: 3000, VATRatePercent: 0, TotalCents: 2250},
			{Date: date(24), Description: "Sam Muster - Flugvorbereitung", Minutes: 60, HourlyRateCents: 2500, VATRatePercent: 0, TotalCents: 2500},
			{Date: date(24), Description: "Sam Muster - Blockzeit", Minutes: 106, HourlyRateCents: 3000, VATRatePercent: 0, TotalCents: 5300},
			{Date: date(24), Description: "Dana Beispiel - Flugvorbereitung", Minutes: 30, HourlyRateCents: 2500, VATRatePercent: 0, TotalCents: 1250},
			{Date: date(24), Description: "Dana Beispiel - Blockzeit", Minutes: 139, HourlyRateCents: 3000, VATRatePercent: 0, TotalCents: 6950},
		},
		Totals: Totals{
			NetCents:   48500,
			VATCents:   0,
			GrossCents: 48500,
		},
		PaymentText:  "Bitte überweisen Sie den Rechnungsbetrag auf meinem Bankkonto.",
		VATStatement: "Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.",
		ClosingText:  "Mit Freundlichen Grüßen",
		TaxNumber:    "00/000/00000",
		BankDetails: BankDetails{
			IBAN: "DE00 0000 0000 0000 0000 00",
			BIC:  "XXXXXXXXXXX",
		},
	}
}
