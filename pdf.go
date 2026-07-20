package main

import (
	"context"
	"fmt"
	"os/exec"
	"strings"
)

const weasyPrintExecutable = "weasyprint"

// writeInvoicePDF converts an existing HTML artifact to PDF with WeasyPrint.
// The executable and arguments are passed directly to the operating system;
// no command shell is involved.
func writeInvoicePDF(ctx context.Context, htmlPath, pdfPath string) error {
	executable, err := exec.LookPath(weasyPrintExecutable)
	if err != nil {
		return fmt.Errorf("locate WeasyPrint executable %q in PATH: %w (install WeasyPrint and ensure it is on PATH)", weasyPrintExecutable, err)
	}

	output, err := exec.CommandContext(ctx, executable, htmlPath, pdfPath).CombinedOutput()
	if err != nil {
		details := strings.TrimSpace(string(output))
		if details == "" {
			return fmt.Errorf("convert HTML artifact to PDF with WeasyPrint: %w", err)
		}
		return fmt.Errorf("convert HTML artifact to PDF with WeasyPrint: %w: %s", err, details)
	}

	return nil
}
