package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRenderReferenceInvoiceHTML(t *testing.T) {
	var output bytes.Buffer
	if err := renderInvoiceHTML(&output, ReferenceDocument(), []byte("signature")); err != nil {
		t.Fatalf("render invoice HTML: %v", err)
	}

	html := output.String()
	for _, expected := range []string{
		"<!doctype html>",
		"Rechnung Nr. 2026-05",
		"Alex Beispiel - Blockzeit",
		">2:15<",
		">67,50 €<",
		">485,00 €<",
		"Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.",
		`class="signature"`,
		`src="data:image/png;base64,`,
		`alt="Unterschrift von Erika Musterfrau"`,
	} {
		if !strings.Contains(html, expected) {
			t.Errorf("rendered HTML does not contain %q", expected)
		}
	}
}

func TestWriteInvoiceHTML(t *testing.T) {
	path := filepath.Join(t.TempDir(), "invoice.html")
	if err := writeInvoiceHTML(path, ReferenceDocument(), nil); err != nil {
		t.Fatalf("write invoice HTML: %v", err)
	}

	contents, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read invoice HTML: %v", err)
	}
	if !strings.Contains(string(contents), "Rechnung Nr. 2026-05") {
		t.Error("HTML artifact does not contain the invoice number")
	}
}

func TestRenderInvoiceHTMLEscapesDocumentText(t *testing.T) {
	document := ReferenceDocument()
	document.Issuer.Name = `<script>alert("test")</script>`

	var output bytes.Buffer
	if err := renderInvoiceHTML(&output, document, nil); err != nil {
		t.Fatalf("render invoice HTML: %v", err)
	}

	html := output.String()
	if strings.Contains(html, "<script>") {
		t.Error("rendered HTML contains an unescaped script element")
	}
	if !strings.Contains(html, "&lt;script&gt;") {
		t.Error("rendered HTML does not contain the escaped issuer name")
	}
}
