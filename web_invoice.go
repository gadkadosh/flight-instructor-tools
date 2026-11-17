package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

var invoiceNumberPattern = regexp.MustCompile(`^[0-9]{4}-[0-9]+$`)

func invoiceError(w http.ResponseWriter, status int, err error) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
}

func (source sessionSource) serveInvoice(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	contentType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || contentType != "application/json" {
		invoiceError(w, http.StatusUnsupportedMediaType, fmt.Errorf("expected application/json"))
		return
	}
	var request struct {
		SessionIDs []string `json:"sessionIds"`
		Number     string   `json:"number"`
		IssueDate  string   `json:"issueDate"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		invoiceError(w, http.StatusBadRequest, fmt.Errorf("invalid invoice request: %w", err))
		return
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		invoiceError(w, http.StatusBadRequest, fmt.Errorf("expected a single invoice request"))
		return
	}
	request.Number = strings.TrimSpace(request.Number)
	if !invoiceNumberPattern.MatchString(request.Number) {
		invoiceError(w, http.StatusBadRequest, fmt.Errorf("invoice number must use year-running number, for example 2026-01"))
		return
	}
	issueDate, err := parseDate(request.IssueDate)
	if err != nil {
		invoiceError(w, http.StatusBadRequest, fmt.Errorf("issue date: %w", err))
		return
	}
	if len(request.SessionIDs) == 0 {
		invoiceError(w, http.StatusBadRequest, fmt.Errorf("select at least one session"))
		return
	}
	input, err := readSessionFile(source.inputPath)
	if err != nil {
		invoiceError(w, http.StatusInternalServerError, err)
		return
	}
	selectedIDs := make(map[string]bool, len(request.SessionIDs))
	for _, id := range request.SessionIDs {
		selectedIDs[id] = true
	}
	var selected []Session
	for _, session := range input.Sessions {
		if selectedIDs[session.ID] {
			selected = append(selected, session)
			delete(selectedIDs, session.ID)
		}
	}
	if len(selectedIDs) > 0 {
		invoiceError(w, http.StatusBadRequest, fmt.Errorf("selected sessions no longer exist; reload the page and select again"))
		return
	}
	config, err := readConfig(source.configPath)
	if err != nil {
		invoiceError(w, http.StatusInternalServerError, err)
		return
	}
	document, err := buildInvoiceDocument(selected, config, request.Number, issueDate)
	if err != nil {
		invoiceError(w, http.StatusUnprocessableEntity, err)
		return
	}
	var signaturePNG []byte
	if config.SignatureFile != "" {
		signaturePNG, err = os.ReadFile(configRelativePath(source.configPath, config.SignatureFile))
		if err != nil {
			invoiceError(w, http.StatusInternalServerError, fmt.Errorf("read signature: %w", err))
			return
		}
	}
	directory, err := os.MkdirTemp("", "fitools-invoice-*")
	if err != nil {
		invoiceError(w, http.StatusInternalServerError, err)
		return
	}
	defer os.RemoveAll(directory)
	htmlPath := filepath.Join(directory, "invoice.html")
	pdfPath := filepath.Join(directory, "invoice.pdf")
	if err := writeInvoiceHTML(htmlPath, document, signaturePNG); err != nil {
		invoiceError(w, http.StatusInternalServerError, err)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), time.Minute)
	defer cancel()
	if err := writeInvoicePDF(ctx, htmlPath, pdfPath); err != nil {
		invoiceError(w, http.StatusInternalServerError, err)
		return
	}
	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{
		"filename": "Rechnung-" + request.Number + ".pdf",
	}))
	http.ServeFile(w, r, pdfPath)
}
