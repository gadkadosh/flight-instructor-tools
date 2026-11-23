package main

import (
	"fmt"
	"net/http"
	"slices"
)

func (source sessionSource) updateSession(w http.ResponseWriter, r *http.Request) {
	view, session, ok := source.readEntry(w, r)
	if !ok {
		return
	}
	if session.ID != r.PathValue("id") {
		writeJSONError(w, http.StatusBadRequest, fmt.Errorf("session ID %q does not match the URL", session.ID))
		return
	}
	index := slices.IndexFunc(view.Sessions, func(existing Session) bool { return existing.ID == session.ID })
	if index < 0 {
		writeJSONError(w, http.StatusNotFound, fmt.Errorf("this session no longer exists; reload the page"))
		return
	}
	// Saving what is already stored changes nothing, so a retry after a lost response succeeds.
	same, err := sameSession(view.Sessions[index], session)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, err)
		return
	}
	if same {
		writeSessionView(w, http.StatusOK, view)
		return
	}
	if !matchesSession(w, r, view.Sessions[index], "saving") {
		return
	}
	view.Sessions[index] = session
	source.save(w, view, http.StatusOK)
}
