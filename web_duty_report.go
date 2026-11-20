package main

import (
	"fmt"
	"net/http"
)

func (source sessionSource) serveDutyReport(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	var request struct {
		Month               string `json:"month"`
		CarryOverFlightDuty string `json:"carryOverFlightDuty"`
		IssueDate           string `json:"issueDate"`
	}
	if !decodeJSONRequest(w, r, &request, "duty report") {
		return
	}
	carryOver, err := parseCarryOver(request.CarryOverFlightDuty)
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, err)
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
	month, err := config.parseMonth(request.Month)
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, err)
		return
	}
	input, err := readSessionFile(source.inputPath)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, err)
		return
	}
	report, err := buildDutyReport(input.Sessions, config, month, issueDate, carryOver)
	if err != nil {
		writeJSONError(w, http.StatusUnprocessableEntity, err)
		return
	}
	html, err := renderConfiguredDutyReport(report, config, source.configPath)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, err)
		return
	}
	serveDocumentPDF(w, r, html, "Dienstzeitnachweis-"+request.Month+".pdf")
}
