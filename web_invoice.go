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

// readSelectedSessions returns the sessions with the given IDs, in file order.
func (source sessionSource) readSelectedSessions(w http.ResponseWriter, ids []string) ([]Session, bool) {
	if len(ids) == 0 {
		writeJSONError(w, http.StatusBadRequest, fmt.Errorf("select at least one session"))
		return nil, false
	}
	input, err := readSessionFile(source.sessionsPath)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, err)
		return nil, false
	}
	selectedIDs := make(map[string]bool, len(ids))
	for _, id := range ids {
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
		writeJSONError(w, http.StatusBadRequest, fmt.Errorf("selected sessions no longer exist; reload the page and select again"))
		return nil, false
	}
	return selected, true
}
