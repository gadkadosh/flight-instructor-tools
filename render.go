package main

import (
	"bytes"
	"context"
	_ "embed"
	"encoding/base64"
	"fmt"
	"html/template"
	"io"
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

// invoicePDF renders document with the configured signature as a PDF.
func invoicePDF(ctx context.Context, document Document, config Config, configPath string) ([]byte, error) {
	signaturePNG, err := readSignature(config, configPath)
	if err != nil {
		return nil, err
	}
	var html bytes.Buffer
	if err := renderInvoiceHTML(&html, document, signaturePNG); err != nil {
		return nil, fmt.Errorf("render invoice HTML: %w", err)
	}
	return convertHTMLToPDF(ctx, html.Bytes())
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
