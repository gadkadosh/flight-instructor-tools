package main

import (
	"fmt"
	"net/http"
	"strings"
)

func (source sessionSource) serveInvoice(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	var request struct {
		SessionIDs []string `json:"sessionIds"`
		Number     string   `json:"number"`
		IssueDate  string   `json:"issueDate"`
	}
	if !decodeJSONRequest(w, r, &request, "invoice") {
		return
	}
	request.Number = strings.TrimSpace(request.Number)
	selected, ok := source.readSelectedSessions(w, request.SessionIDs)
	if !ok {
		return
	}
	config, err := readConfig(source.configPath)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, err)
		return
	}
	issueDate, err := config.parseDate(request.IssueDate)
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, fmt.Errorf("issue date: %w", err))
		return
	}
	document, err := buildInvoiceDocument(selected, config, request.Number, issueDate)
	if err != nil {
		writeJSONError(w, http.StatusUnprocessableEntity, err)
		return
	}
	pdf, err := invoicePDF(r.Context(), document, config, source.configPath)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, err)
		return
	}
	servePDF(w, pdf, "Rechnung-"+request.Number+".pdf")
}
