package main

import (
	"mime"
	"net/http"
)

func (source sessionSource) serveForeFlight(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	var request struct {
		SessionIDs []string `json:"sessionIds"`
	}
	if !decodeJSONRequest(w, r, &request, "ForeFlight export") {
		return
	}
	selected, ok := source.readSelectedSessions(w, request.SessionIDs)
	if !ok {
		return
	}
	config, err := readConfig(source.configPath)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, err)
		return
	}
	data, filename, err := foreFlightLogbook(selected, config.Aircraft)
	if err != nil {
		writeJSONError(w, http.StatusUnprocessableEntity, err)
		return
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": filename}))
	w.Write(data)
}
