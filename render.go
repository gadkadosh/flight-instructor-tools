package main

import (
	_ "embed"
	"encoding/base64"
	"fmt"
	"html/template"
	"io"
	"os"
	"strconv"
	"time"
)

//go:embed invoice.html.tmpl
var invoiceTemplateSource string

var invoiceTemplate = template.Must(template.New("invoice").Funcs(template.FuncMap{
	"formatLongDate":  func(date time.Time) string { return date.Format("02.01.2006") },
	"formatShortDate": func(date time.Time) string { return date.Format("02.01.06") },
	"formatDuration":  formatDuration,
	"formatMoney":     formatMoney,
}).Parse(invoiceTemplateSource))

type invoiceTemplateData struct {
	Document
	SignatureBase64 string
}

func renderInvoiceHTML(writer io.Writer, document Document, signaturePNG []byte) error {
	data := invoiceTemplateData{
		Document:        document,
		SignatureBase64: base64.StdEncoding.EncodeToString(signaturePNG),
	}
	return invoiceTemplate.Execute(writer, data)
}

func writeInvoiceHTML(path string, document Document, signaturePNG []byte) error {
	file, err := os.Create(path)
	if err != nil {
		return fmt.Errorf("create HTML artifact: %w", err)
	}

	if err := renderInvoiceHTML(file, document, signaturePNG); err != nil {
		_ = file.Close()
		return fmt.Errorf("render HTML artifact: %w", err)
	}
	if err := file.Close(); err != nil {
		return fmt.Errorf("close HTML artifact: %w", err)
	}

	return nil
}

func formatDuration(minutes int) string {
	return fmt.Sprintf("%d:%02d", minutes/60, minutes%60)
}

func formatMoney(cents int) string {
	sign := ""
	if cents < 0 {
		sign = "-"
		cents = -cents
	}

	euros := strconv.Itoa(cents / 100)
	for index := len(euros) - 3; index > 0; index -= 3 {
		euros = euros[:index] + "." + euros[index:]
	}

	return fmt.Sprintf("%s%s,%02d €", sign, euros, cents%100)
}
