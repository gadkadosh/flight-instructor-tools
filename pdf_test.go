package main

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestWriteInvoicePDFInvokesWeasyPrintWithoutShellInterpolation(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("test uses a POSIX test executable")
	}

	binDirectory := t.TempDir()
	executablePath := filepath.Join(binDirectory, weasyPrintExecutable)
	argumentsPath := filepath.Join(t.TempDir(), "arguments")
	fakeWeasyPrint := `#!/bin/sh
printf '%s\n' "$@" > "$FAKE_WEASYPRINT_ARGUMENTS"
printf 'pdf' > "$2"
`
	if err := os.WriteFile(executablePath, []byte(fakeWeasyPrint), 0o755); err != nil {
		t.Fatalf("write fake WeasyPrint executable: %v", err)
	}
	t.Setenv("PATH", binDirectory)
	t.Setenv("FAKE_WEASYPRINT_ARGUMENTS", argumentsPath)

	artifactDirectory := filepath.Join(t.TempDir(), "artifacts with spaces")
	if err := os.Mkdir(artifactDirectory, 0o755); err != nil {
		t.Fatalf("create artifact directory: %v", err)
	}
	htmlPath := filepath.Join(artifactDirectory, "invoice;echo-not-run.html")
	pdfPath := filepath.Join(artifactDirectory, "invoice.pdf")
	if err := os.WriteFile(htmlPath, []byte("<html></html>"), 0o644); err != nil {
		t.Fatalf("write HTML artifact: %v", err)
	}

	if err := writeInvoicePDF(context.Background(), htmlPath, pdfPath); err != nil {
		t.Fatalf("write invoice PDF: %v", err)
	}

	arguments, err := os.ReadFile(argumentsPath)
	if err != nil {
		t.Fatalf("read captured arguments: %v", err)
	}
	if got, want := string(arguments), htmlPath+"\n"+pdfPath+"\n"; got != want {
		t.Fatalf("WeasyPrint arguments = %q, want %q", got, want)
	}
	contents, err := os.ReadFile(pdfPath)
	if err != nil {
		t.Fatalf("read PDF artifact: %v", err)
	}
	if string(contents) != "pdf" {
		t.Fatalf("PDF artifact = %q, want %q", contents, "pdf")
	}
}

func TestWriteInvoicePDFReportsMissingWeasyPrint(t *testing.T) {
	t.Setenv("PATH", t.TempDir())

	err := writeInvoicePDF(context.Background(), "invoice.html", "invoice.pdf")
	if err == nil {
		t.Fatal("write invoice PDF unexpectedly succeeded")
	}
	for _, expected := range []string{"WeasyPrint", "PATH", "install"} {
		if !strings.Contains(err.Error(), expected) {
			t.Errorf("error %q does not contain %q", err, expected)
		}
	}
}

func TestWriteInvoicePDFIncludesRendererFailureOutput(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("test uses a POSIX test executable")
	}

	binDirectory := t.TempDir()
	executablePath := filepath.Join(binDirectory, weasyPrintExecutable)
	if err := os.WriteFile(executablePath, []byte("#!/bin/sh\necho 'invalid document' >&2\nexit 2\n"), 0o755); err != nil {
		t.Fatalf("write fake WeasyPrint executable: %v", err)
	}
	t.Setenv("PATH", binDirectory)

	err := writeInvoicePDF(context.Background(), "invoice.html", "invoice.pdf")
	if err == nil {
		t.Fatal("write invoice PDF unexpectedly succeeded")
	}
	if !strings.Contains(err.Error(), "invalid document") {
		t.Fatalf("error %q does not contain renderer output", err)
	}
}
