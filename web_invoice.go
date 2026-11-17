package main

import (
	"bytes"
	"fmt"
	"net/http"
	"os"
	"regexp"
	"strings"
)

var invoiceNumberPattern = regexp.MustCompile(`^[0-9]{4}-[0-9]+$`)

func (source sessionSource) serveInvoice(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	var request struct {
		SessionIDs []string `json:"sessionIds"`
		Number     string   `json:"number"`
		IssueDate  string   `json:"issueDate"`
	}
	if !decodeDocumentRequest(w, r, &request, "invoice") {
		return
	}
	request.Number = strings.TrimSpace(request.Number)
	if !invoiceNumberPattern.MatchString(request.Number) {
		documentError(w, http.StatusBadRequest, fmt.Errorf("invoice number must use year-running number, for example 2026-01"))
		return
	}
	issueDate, err := parseDate(request.IssueDate)
	if err != nil {
		documentError(w, http.StatusBadRequest, fmt.Errorf("issue date: %w", err))
		return
	}
	if len(request.SessionIDs) == 0 {
		documentError(w, http.StatusBadRequest, fmt.Errorf("select at least one session"))
		return
	}
	input, err := readSessionFile(source.inputPath)
	if err != nil {
		documentError(w, http.StatusInternalServerError, err)
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
		documentError(w, http.StatusBadRequest, fmt.Errorf("selected sessions no longer exist; reload the page and select again"))
		return
	}
	config, err := readConfig(source.configPath)
	if err != nil {
		documentError(w, http.StatusInternalServerError, err)
		return
	}
	document, err := buildInvoiceDocument(selected, config, request.Number, issueDate)
	if err != nil {
		documentError(w, http.StatusUnprocessableEntity, err)
		return
	}
	var signaturePNG []byte
	if config.SignatureFile != "" {
		signaturePNG, err = os.ReadFile(configRelativePath(source.configPath, config.SignatureFile))
		if err != nil {
			documentError(w, http.StatusInternalServerError, fmt.Errorf("read signature: %w", err))
			return
		}
	}
	var html bytes.Buffer
	if err := renderInvoiceHTML(&html, document, signaturePNG); err != nil {
		documentError(w, http.StatusInternalServerError, err)
		return
	}
	serveDocumentPDF(w, r, html.Bytes(), "Rechnung-"+request.Number+".pdf")
}
