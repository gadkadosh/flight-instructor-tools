package main

import (
	"bytes"
	"context"
	"image"
	"image/png"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func setupDutyReportTest(t *testing.T) (args []string, outputDirectory, configPath string) {
	t.Helper()
	_, outputDirectory = setupInvoiceTest(t)
	config, err := readConfig("examples/config.json")
	if err != nil {
		t.Fatal(err)
	}
	config.TimeZone = "Europe/Berlin"
	config.DutyReportTemplateFile = "report.html.tmpl"
	config.SignatureFile = "signature.png"
	directory := t.TempDir()
	configPath = filepath.Join(directory, "config.json")
	writeTestConfig(t, configPath, config)
	tmpl, err := os.ReadFile("examples/duty-report.html.tmpl")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, config.DutyReportTemplateFile), tmpl, 0o644); err != nil {
		t.Fatal(err)
	}
	var signature bytes.Buffer
	if err := png.Encode(&signature, image.NewRGBA(image.Rect(0, 0, 1, 1))); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, config.SignatureFile), signature.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}
	return []string{"duty-report", "--sessions", "testdata/minimal-sessions.json", "--config", configPath,
		"--month", "2026-05", "--carry-over-flight-duty", "120:00", "--output-dir", outputDirectory}, outputDirectory, configPath
}

func TestRunDutyReportUsesWorkingDirectoryDefaults(t *testing.T) {
	_, output, configPath := setupDutyReportTest(t)
	fixture, err := os.ReadFile("testdata/minimal-sessions.json")
	if err != nil {
		t.Fatal(err)
	}
	directory := filepath.Dir(configPath)
	if err := os.WriteFile(filepath.Join(directory, "sessions.json"), fixture, 0o600); err != nil {
		t.Fatal(err)
	}
	t.Chdir(directory)
	args := []string{"duty-report", "--month", "2026-05", "--carry-over-flight-duty", "0:00", "--output-dir", output}
	if err := run(context.Background(), args, io.Discard, strings.NewReader(""), time.Now); err != nil {
		t.Fatal(err)
	}
	pdf := readFile(t, filepath.Join(output, "Dienstzeitnachweis-2026-05.pdf"))
	for _, want := range []string{"(Europe/Berlin)", "Month 3:00, carry 0:00, year 3:00, block 1:05"} {
		if !strings.Contains(pdf, want) {
			t.Errorf("report generated from default files missing %q:\n%s", want, pdf)
		}
	}
}

func TestDutyReportCLIValidationAndHelp(t *testing.T) {
	for _, flag := range []string{"--help", "-h"} {
		var stdout bytes.Buffer
		if err := run(context.Background(), []string{"duty-report", flag}, &stdout, strings.NewReader(""), time.Now); err != nil {
			t.Fatal(err)
		}
		for _, want := range []string{"duty-report", "-carry-over-flight-duty", "-sessions", "-config", "-month", "-issue-date", "-output-dir", "-force"} {
			if !strings.Contains(stdout.String(), want) {
				t.Errorf("help missing %q", want)
			}
		}
		if strings.Contains(stdout.String(), "-number") {
			t.Error("duty report must not require invoice number")
		}
	}
	args, output, _ := setupDutyReportTest(t)
	// Explicit carry-over is required even in January.
	args = append(args[:7:7], "--month", "2026-01")
	err := run(context.Background(), args, io.Discard, strings.NewReader(""), time.Now)
	if err == nil || !strings.Contains(err.Error(), "--carry-over-flight-duty is required") {
		t.Fatalf("error = %v", err)
	}
	entries, err := os.ReadDir(output)
	if err != nil || len(entries) != 0 {
		t.Fatalf("invalid command created outputs: %v, %v", entries, err)
	}
}
