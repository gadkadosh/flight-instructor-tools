package main

import (
	"fmt"
	"net/http"
	"time"
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
	location, err := dutyReportLocation(config)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, err)
		return
	}
	issueDate, err := time.ParseInLocation("2006-01-02", request.IssueDate, location)
	if err != nil || issueDate.Format("2006-01-02") != request.IssueDate {
		writeJSONError(w, http.StatusBadRequest, fmt.Errorf("issue date must use YYYY-MM-DD format: %q", request.IssueDate))
		return
	}
	if month, err := time.ParseInLocation("2006-01", request.Month, location); err != nil || month.Format("2006-01") != request.Month {
		writeJSONError(w, http.StatusBadRequest, fmt.Errorf("month must use YYYY-MM format: %q", request.Month))
		return
	}
	var input SessionFile
	if err := readJSONFile(source.inputPath, &input); err != nil {
		writeJSONError(w, http.StatusInternalServerError, fmt.Errorf("read sessions: %w", err))
		return
	}
	if err := validateSessionRecords(input); err != nil {
		writeJSONError(w, http.StatusInternalServerError, fmt.Errorf("validate sessions: %w", err))
		return
	}
	report, err := buildDutyReport(input.Sessions, config, request.Month, issueDate, carryOver)
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
