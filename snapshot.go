package main

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
)

type invoiceSnapshot struct {
	InvoiceNumber string                `json:"invoiceNumber"`
	IssueDate     string                `json:"issueDate"`
	Currency      string                `json:"currency"`
	Issuer        Party                 `json:"issuer"`
	Customer      Party                 `json:"customer"`
	Lines         []invoiceSnapshotLine `json:"lines"`
	Totals        invoiceSnapshotTotals `json:"totals"`
	PaymentText   string                `json:"paymentText"`
	VATStatement  string                `json:"vatStatement"`
	ClosingText   string                `json:"closingText"`
	TaxNumber     string                `json:"taxNumber"`
	BankDetails   BankDetails           `json:"bankDetails"`
}

type invoiceSnapshotLine struct {
	Date            string `json:"date"`
	Description     string `json:"description"`
	Minutes         int    `json:"minutes"`
	HourlyRateCents int    `json:"hourlyRateCents"`
	VATRatePercent  int    `json:"vatRatePercent"`
	TotalCents      int    `json:"totalCents"`
}

type invoiceSnapshotTotals struct {
	NetCents   int `json:"netCents"`
	VATCents   int `json:"vatCents"`
	GrossCents int `json:"grossCents"`
}

func newInvoiceSnapshot(document Document) invoiceSnapshot {
	lines := make([]invoiceSnapshotLine, len(document.Lines))
	for index, line := range document.Lines {
		lines[index] = invoiceSnapshotLine{
			Date:            line.Date.Format("2006-01-02"),
			Description:     line.Description,
			Minutes:         line.Minutes,
			HourlyRateCents: line.HourlyRateCents,
			VATRatePercent:  line.VATRatePercent,
			TotalCents:      line.TotalCents,
		}
	}

	return invoiceSnapshot{
		InvoiceNumber: document.Number,
		IssueDate:     document.IssueDate.Format("2006-01-02"),
		Currency:      document.Currency,
		Issuer:        document.Issuer,
		Customer:      document.Customer,
		Lines:         lines,
		Totals: invoiceSnapshotTotals{
			NetCents:   document.Totals.NetCents,
			VATCents:   document.Totals.VATCents,
			GrossCents: document.Totals.GrossCents,
		},
		PaymentText:  document.PaymentText,
		VATStatement: document.VATStatement,
		ClosingText:  document.ClosingText,
		TaxNumber:    document.TaxNumber,
		BankDetails:  document.BankDetails,
	}
}

func renderInvoiceSnapshot(writer io.Writer, document Document) error {
	encoder := json.NewEncoder(writer)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(newInvoiceSnapshot(document)); err != nil {
		return fmt.Errorf("encode JSON snapshot: %w", err)
	}
	return nil
}

func writeInvoiceSnapshot(path string, document Document) error {
	file, err := os.Create(path)
	if err != nil {
		return fmt.Errorf("create JSON snapshot: %w", err)
	}

	if err := renderInvoiceSnapshot(file, document); err != nil {
		_ = file.Close()
		return err
	}
	if err := file.Close(); err != nil {
		return fmt.Errorf("close JSON snapshot: %w", err)
	}
	return nil
}
