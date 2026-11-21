package main

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

// stubWeasyPrint puts a fake WeasyPrint running script on PATH. With
// "exec /bin/cat" the PDF is the HTML input, so tests can inspect the document
// that would be converted.
func stubWeasyPrint(t *testing.T, script string) {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("test uses a POSIX test executable")
	}
	binDirectory := t.TempDir()
	if err := os.WriteFile(filepath.Join(binDirectory, weasyPrintExecutable), []byte("#!/bin/sh\n"+script+"\n"), 0o755); err != nil {
		t.Fatalf("write fake WeasyPrint: %v", err)
	}
	t.Setenv("PATH", binDirectory)
}

func TestConvertHTMLToPDFPipesDocumentThroughWeasyPrint(t *testing.T) {
	argumentsPath := filepath.Join(t.TempDir(), "arguments")
	t.Setenv("FAKE_WEASYPRINT_ARGUMENTS", argumentsPath)
	stubWeasyPrint(t, `printf '%s\n' "$@" > "$FAKE_WEASYPRINT_ARGUMENTS"; printf 'pdf of '; exec /bin/cat`)

	pdf, err := convertHTMLToPDF(context.Background(), []byte("<html></html>"))
	if err != nil {
		t.Fatalf("convert HTML: %v", err)
	}
	if got, want := string(pdf), "pdf of <html></html>"; got != want {
		t.Fatalf("PDF = %q, want %q", got, want)
	}
	arguments, err := os.ReadFile(argumentsPath)
	if err != nil {
		t.Fatalf("read captured arguments: %v", err)
	}
	if got, want := string(arguments), "-\n-\n"; got != want {
		t.Fatalf("WeasyPrint arguments = %q, want stdin and stdout %q", got, want)
	}
}

func TestConvertHTMLToPDFReportsMissingWeasyPrint(t *testing.T) {
	t.Setenv("PATH", t.TempDir())

	_, err := convertHTMLToPDF(context.Background(), []byte("<html></html>"))
	if err == nil {
		t.Fatal("convert HTML unexpectedly succeeded")
	}
	for _, expected := range []string{"WeasyPrint", "PATH", "install"} {
		if !strings.Contains(err.Error(), expected) {
			t.Errorf("error %q does not contain %q", err, expected)
		}
	}
}

func TestConvertHTMLToPDFIncludesRendererFailureOutput(t *testing.T) {
	stubWeasyPrint(t, "printf 'partial'; echo 'invalid document' >&2; exit 2")

	pdf, err := convertHTMLToPDF(context.Background(), []byte("<html></html>"))
	if err == nil || !strings.Contains(err.Error(), "invalid document") {
		t.Fatalf("error = %v, want renderer output", err)
	}
	if pdf != nil {
		t.Fatalf("PDF = %q, want none on failure", pdf)
	}
}

func TestConvertHTMLToPDFReportsTimeout(t *testing.T) {
	stubWeasyPrint(t, "exec /bin/sleep 5")
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()

	_, err := convertHTMLToPDF(ctx, []byte("<html></html>"))
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("error = %v, want deadline exceeded", err)
	}
}
