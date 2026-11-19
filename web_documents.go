package main

import (
	"context"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

func serveDocumentPDF(w http.ResponseWriter, r *http.Request, html []byte, filename string) {
	directory, err := os.MkdirTemp("", "fitools-document-*")
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, err)
		return
	}
	defer os.RemoveAll(directory)
	htmlPath := filepath.Join(directory, "document.html")
	pdfPath := filepath.Join(directory, "document.pdf")
	if err := os.WriteFile(htmlPath, html, 0o600); err != nil {
		writeJSONError(w, http.StatusInternalServerError, err)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), time.Minute)
	defer cancel()
	if err := writeInvoicePDF(ctx, htmlPath, pdfPath); err != nil {
		writeJSONError(w, http.StatusInternalServerError, err)
		return
	}
	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": filename}))
	http.ServeFile(w, r, pdfPath)
}
