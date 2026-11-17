package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

func documentError(w http.ResponseWriter, status int, err error) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
}

func decodeDocumentRequest(w http.ResponseWriter, r *http.Request, request any, name string) bool {
	contentType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || contentType != "application/json" {
		documentError(w, http.StatusUnsupportedMediaType, fmt.Errorf("expected application/json"))
		return false
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(request); err != nil {
		documentError(w, http.StatusBadRequest, fmt.Errorf("invalid %s request: %w", name, err))
		return false
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		documentError(w, http.StatusBadRequest, fmt.Errorf("expected a single %s request", name))
		return false
	}
	return true
}

func serveDocumentPDF(w http.ResponseWriter, r *http.Request, html []byte, filename string) {
	directory, err := os.MkdirTemp("", "fitools-document-*")
	if err != nil {
		documentError(w, http.StatusInternalServerError, err)
		return
	}
	defer os.RemoveAll(directory)
	htmlPath := filepath.Join(directory, "document.html")
	pdfPath := filepath.Join(directory, "document.pdf")
	if err := os.WriteFile(htmlPath, html, 0o600); err != nil {
		documentError(w, http.StatusInternalServerError, err)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), time.Minute)
	defer cancel()
	if err := writeInvoicePDF(ctx, htmlPath, pdfPath); err != nil {
		documentError(w, http.StatusInternalServerError, err)
		return
	}
	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": filename}))
	http.ServeFile(w, r, pdfPath)
}
