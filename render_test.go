package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRenderReferenceInvoiceHTML(t *testing.T) {
	var output bytes.Buffer
	if err := renderInvoiceHTML(&output, referenceDocument(), []byte("signature")); err != nil {
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

func TestRenderInvoiceHTMLEscapesDocumentText(t *testing.T) {
	document := referenceDocument()
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

func TestInvoicePDFSignature(t *testing.T) {
	stubWeasyPrint(t, "exec /bin/cat")
	var signature bytes.Buffer
	if err := png.Encode(&signature, image.NewRGBA(image.Rect(0, 0, 1, 1))); err != nil {
		t.Fatal(err)
	}
	signaturePath := filepath.Join(t.TempDir(), "signature.png")
	if err := os.WriteFile(signaturePath, signature.Bytes(), 0o644); err != nil {
		t.Fatalf("write signature: %v", err)
	}
	fixture, err := os.ReadFile(filepath.Join("testdata", "minimal-config.json"))
	if err != nil {
		t.Fatalf("read config fixture: %v", err)
	}

	for _, test := range []struct {
		name              string
		signatureFileJSON string
		wantSignature     bool
		wantError         string
	}{
		{name: "omitted"},
		{name: "empty", signatureFileJSON: `""`},
		{name: "absolute path", signatureFileJSON: fmt.Sprintf("%q", signaturePath), wantSignature: true},
		{name: "relative path", signatureFileJSON: `"signature.png"`, wantSignature: true},
		{name: "missing file", signatureFileJSON: `"missing.png"`, wantError: "read signature"},
		{name: "directory instead of file", signatureFileJSON: `"."`, wantError: "read signature"},
		{name: "not a PNG", signatureFileJSON: `"not-a-signature.png"`, wantError: "load signature"},
	} {
		t.Run(test.name, func(t *testing.T) {
			configDirectory := t.TempDir()
			if err := os.WriteFile(filepath.Join(configDirectory, "signature.png"), signature.Bytes(), 0o644); err != nil {
				t.Fatalf("write relative signature: %v", err)
			}
			if err := os.WriteFile(filepath.Join(configDirectory, "not-a-signature.png"), []byte("signature"), 0o644); err != nil {
				t.Fatalf("write invalid signature: %v", err)
			}
			var config map[string]json.RawMessage
			if err := json.Unmarshal(fixture, &config); err != nil {
				t.Fatalf("decode config fixture: %v", err)
			}
			if test.signatureFileJSON != "" {
				config["signatureFile"] = json.RawMessage(test.signatureFileJSON)
			}
			contents, err := json.Marshal(config)
			if err != nil {
				t.Fatalf("encode config: %v", err)
			}
			configPath := filepath.Join(configDirectory, "config.json")
			if err := os.WriteFile(configPath, contents, 0o644); err != nil {
				t.Fatalf("write config: %v", err)
			}
			parsed, err := readConfig(configPath)
			if err != nil {
				t.Fatal(err)
			}

			pdf, err := invoicePDF(context.Background(), referenceDocument(), parsed, configPath)
			if test.wantError != "" {
				if err == nil || !strings.Contains(err.Error(), test.wantError) || !strings.Contains(err.Error(), configDirectory) {
					t.Fatalf("error = %v, want signature read error with resolved path", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("render invoice PDF: %v", err)
			}
			html := string(pdf)
			if !strings.Contains(html, "Rechnung Nr. 2026-05") {
				t.Error("invoice does not contain its number")
			}
			if got := strings.Contains(html, `class="signature"`); got != test.wantSignature {
				t.Errorf("signature image present = %v, want %v", got, test.wantSignature)
			}
			if test.wantSignature && !strings.Contains(html, `src="data:image/png;base64,`+base64.StdEncoding.EncodeToString(signature.Bytes())+`"`) {
				t.Error("invoice does not embed the supplied signature")
			}
		})
	}
}
