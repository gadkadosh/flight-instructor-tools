package main

import "time"

type Party struct {
	Name         string   `json:"name"`
	AddressLines []string `json:"addressLines"`
	Email        string   `json:"email,omitempty"`
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
	IBAN string `json:"iban"`
	BIC  string `json:"bic"`
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
