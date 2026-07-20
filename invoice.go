package main

import "time"

type Party struct {
	Name         string
	AddressLines []string
	Email        string
}

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

type BankDetails struct {
	IBAN string
	BIC  string
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
