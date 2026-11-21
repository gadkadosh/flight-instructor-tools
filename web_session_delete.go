package main

import (
	"fmt"
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
	if index >= 0 {
		tag, err := sessionETag(view.Sessions[index])
		if err != nil {
			writeJSONError(w, http.StatusInternalServerError, fmt.Errorf("encode session: %w", err))
			return
		}
		matches := r.Header.Values("If-Match")
		if len(matches) == 0 {
			writeJSONError(w, http.StatusPreconditionRequired, fmt.Errorf("reload the page and review the session before deleting"))
			return
		}
		if len(matches) != 1 || matches[0] != tag {
			writeJSONError(w, http.StatusPreconditionFailed, fmt.Errorf("this session changed; reload the page and review it before deleting"))
			return
		}
		view.Sessions = slices.Delete(view.Sessions, index, index+1)
		input := SessionFile{SchemaVersion: supportedSessionSchemaVersion, Sessions: view.Sessions}
		if err := writeSessionFile(source.sessionsPath, input); err != nil {
			writeJSONError(w, http.StatusInternalServerError, fmt.Errorf("save sessions: %w", err))
			return
		}
	}
	// Return the current view if a previous request already removed the session.
	writeSessionView(w, http.StatusOK, view)
}
