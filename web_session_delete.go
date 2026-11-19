package main

import (
	"encoding/json"
	"fmt"
	"net/http"
)

func (source sessionSource) deleteSessions(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	var request struct {
		SessionIDs []string `json:"sessionIds"`
	}
	if !decodeDocumentRequest(w, r, &request, "delete") {
		return
	}
	if len(request.SessionIDs) == 0 {
		documentError(w, http.StatusBadRequest, fmt.Errorf("select at least one session"))
		return
	}
	view, err := source.read()
	if err != nil {
		documentError(w, http.StatusInternalServerError, err)
		return
	}
	deleteIDs := make(map[string]bool, len(request.SessionIDs))
	for _, id := range request.SessionIDs {
		deleteIDs[id] = true
	}
	// Unknown IDs are treated as already deleted, so a retry after a lost response succeeds.
	kept := make([]Session, 0, len(view.Sessions))
	for _, session := range view.Sessions {
		if !deleteIDs[session.ID] {
			kept = append(kept, session)
		}
	}
	if len(kept) != len(view.Sessions) {
		input := SessionFile{SchemaVersion: supportedSessionSchemaVersion, Sessions: kept}
		if err := writeSessionFile(source.inputPath, input); err != nil {
			documentError(w, http.StatusInternalServerError, fmt.Errorf("save sessions: %w", err))
			return
		}
		view.Sessions = kept
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(view)
}
