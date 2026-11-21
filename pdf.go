package main

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"image/png"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

const weasyPrintExecutable = "weasyprint"

// convertHTMLToPDF converts html to PDF with WeasyPrint, piping the document
// through stdin and stdout so no files are written.
func convertHTMLToPDF(ctx context.Context, html []byte) ([]byte, error) {
	executable, err := exec.LookPath(weasyPrintExecutable)
	if err != nil {
		return nil, fmt.Errorf("locate WeasyPrint executable %q in PATH: %w (install WeasyPrint and ensure it is on PATH)", weasyPrintExecutable, err)
	}
	ctx, cancel := context.WithTimeout(ctx, time.Minute)
	defer cancel()
	var pdf, stderr bytes.Buffer
	command := exec.CommandContext(ctx, executable, "-", "-")
	command.Stdin = bytes.NewReader(html)
	command.Stdout = &pdf
	command.Stderr = &stderr
	if err := command.Run(); err != nil {
		if ctx.Err() != nil {
			err = ctx.Err()
		}
		details := strings.TrimSpace(stderr.String())
		if details == "" {
			return nil, fmt.Errorf("convert HTML to PDF with WeasyPrint: %w", err)
		}
		return nil, fmt.Errorf("convert HTML to PDF with WeasyPrint: %w: %s", err, details)
	}
	return pdf.Bytes(), nil
}

// writePDF writes pdf to path, asking before it replaces an existing file
// unless force is set. The PDF goes to a temporary file in the same folder
// first and is renamed into place, so a failed write never leaves a partial
// PDF behind.
func writePDF(path string, pdf []byte, force bool, stdout io.Writer, stdin io.Reader) error {
	if _, err := os.Stat(path); err == nil && !force {
		fmt.Fprintf(stdout, "%s exists. Overwrite? [y/N] ", path)
		scanner := bufio.NewScanner(stdin)
		if !scanner.Scan() {
			if err := scanner.Err(); err != nil {
				return fmt.Errorf("read overwrite confirmation: %w", err)
			}
			return fmt.Errorf("aborting: no confirmation received")
		}
		if !strings.EqualFold(strings.TrimSpace(scanner.Text()), "y") {
			return fmt.Errorf("aborting: overwrite not confirmed")
		}
	} else if err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("stat output file: %w", err)
	}
	directory := filepath.Dir(path)
	if err := os.MkdirAll(directory, 0o755); err != nil {
		return fmt.Errorf("create output directory: %w", err)
	}
	file, err := os.CreateTemp(directory, ".fitools-*.pdf")
	if err != nil {
		return fmt.Errorf("write PDF: %w", err)
	}
	defer os.Remove(file.Name())
	_, err = file.Write(pdf)
	if closeErr := file.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return fmt.Errorf("write PDF: %w", err)
	}
	if err := os.Rename(file.Name(), path); err != nil {
		return fmt.Errorf("move PDF into place: %w", err)
	}
	fmt.Fprintf(stdout, "Wrote %s\n", path)
	return nil
}

func configRelativePath(configPath, path string) string {
	if filepath.IsAbs(path) {
		return path
	}
	return filepath.Join(filepath.Dir(configPath), path)
}

// readSignature returns the configured signature PNG, or nil when none is set.
func readSignature(config Config, configPath string) ([]byte, error) {
	if config.SignatureFile == "" {
		return nil, nil
	}
	path := configRelativePath(configPath, config.SignatureFile)
	signaturePNG, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read signature %q: %w", path, err)
	}
	if _, err := png.Decode(bytes.NewReader(signaturePNG)); err != nil {
		return nil, fmt.Errorf("load signature %q as PNG: %w", path, err)
	}
	return signaturePNG, nil
}

func formatDuration(minutes int) string {
	return fmt.Sprintf("%d:%02d", minutes/60, minutes%60)
}
