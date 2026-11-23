package main

import (
	"net/http"
	"slices"
)

func (source sessionSource) deleteSession(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	id := r.PathValue("id")
	view, err := source.read()
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, err)
		return
	}
	index := slices.IndexFunc(view.Sessions, func(session Session) bool { return session.ID == id })
	if index < 0 {
		// A previous request already removed the session.
		writeSessionView(w, http.StatusOK, view)
		return
	}
	if !matchesSession(w, r, view.Sessions[index], "deleting") {
		return
	}
	view.Sessions = slices.Delete(view.Sessions, index, index+1)
	source.save(w, view, http.StatusOK)
}
