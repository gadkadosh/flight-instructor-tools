package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"image"
	"image/png"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func writeTestConfig(t *testing.T, path string, config Config) {
	t.Helper()
	data, err := json.Marshal(config)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatal(err)
	}
}

func setupDutyReportTest(t *testing.T) (args []string, outputDirectory, configPath string) {
	t.Helper()
	_, outputDirectory = setupGenerateTest(t)
	config, err := readConfig("testdata/minimal-config.json")
	if err != nil {
		t.Fatal(err)
	}
	config.TimeZone = "Europe/Berlin"
	config.DutyReportTemplateFile = "report.html.tmpl"
	config.SignatureFile = "signature.png"
	directory := t.TempDir()
	configPath = filepath.Join(directory, "config.json")
	writeTestConfig(t, configPath, config)
	tmpl, err := os.ReadFile("testdata/duty-report.html.tmpl")
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
	return []string{"duty-report", "--input", "testdata/minimal-sessions.json", "--config", configPath,
		"--month", "2026-05", "--carry-over-flight-duty", "120:00", "--output-dir", outputDirectory}, outputDirectory, configPath
}

// renderTestDutyReport renders the report for month, issued 2026-06-09, through
// the stub converter, which returns the HTML unchanged.
func renderTestDutyReport(t *testing.T, configPath, inputPath, month string, carryOver int) (string, error) {
	t.Helper()
	config, err := readConfig(configPath)
	if err != nil {
		t.Fatal(err)
	}
	first, err := config.parseMonth(month)
	if err != nil {
		t.Fatal(err)
	}
	issueDate, err := config.parseDate("2026-06-09")
	if err != nil {
		t.Fatal(err)
	}
	input, err := readSessionFile(inputPath)
	if err != nil {
		t.Fatal(err)
	}
	report, err := buildDutyReport(input.Sessions, config, first, issueDate, carryOver)
	if err != nil {
		t.Fatal(err)
	}
	pdf, err := dutyReportPDF(context.Background(), report, config, configPath)
	return string(pdf), err
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

func TestDutyReportPDFRendersTemplateWithSignature(t *testing.T) {
	_, _, configPath := setupDutyReportTest(t)
	html, err := renderTestDutyReport(t, configPath, "testdata/minimal-sessions.json", "2026-05", 7200)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"Erika Musterfrau — Mai 2026", "Issued 09.06.2026 (Europe/Berlin)",
		"<td>03</td><td>12:00</td><td>15:00</td><td>3:00</td><td>1:05</td><td>03:00</td>",
		"Month 3:00, carry 120:00, year 123:00, block 1:05"} {
		if !strings.Contains(html, want) {
			t.Errorf("HTML missing %q", want)
		}
	}
	signature, err := os.ReadFile(filepath.Join(filepath.Dir(configPath), "signature.png"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(html, `src="data:image/png;base64,`+base64.StdEncoding.EncodeToString(signature)+`"`) {
		t.Error("signature is not embedded")
	}
	if strings.Count(html, `class="day"`) != 31 {
		t.Error("HTML must display 31 rows")
	}
}

func TestDutyReportTemplateFormatsGermanMonths(t *testing.T) {
	path := filepath.Join(t.TempDir(), "month.html.tmpl")
	if err := os.WriteFile(path, []byte(`{{formatMonth .Month}}`), 0o644); err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct{ month, want string }{
		{"2026-01", "Januar"}, {"2026-03", "März"},
		{"2026-09", "September"}, {"2027-12", "Dezember"},
	} {
		var html bytes.Buffer
		if err := renderDutyReportHTML(&html, DutyReport{Month: test.month}, path, nil); err != nil {
			t.Fatal(err)
		}
		if html.String() != test.want {
			t.Errorf("month %s rendered as %q, want %q", test.month, html.String(), test.want)
		}
	}
}

func TestDutyReportPDFEmptyFebruary(t *testing.T) {
	_, _, configPath := setupDutyReportTest(t)
	html, err := renderTestDutyReport(t, configPath, "testdata/minimal-sessions.json", "2026-02", 0)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Count(html, `class="day"`) != 31 || strings.Count(html, `<tr class="day"><td></td><td></td><td></td><td></td><td></td><td></td></tr>`) != 3 ||
		!strings.Contains(html, `<tr class="day"><td>28</td><td></td><td></td><td></td><td></td><td></td></tr>`) ||
		!strings.Contains(html, "Month 0:00, carry 0:00, year 0:00, block 0:00") {
		t.Fatalf("empty rows/totals incorrect: %s", html)
	}
}

func TestDutyReportPDFTemplateAndSignatureFailures(t *testing.T) {
	for _, test := range []struct {
		name, want string
		change     func(*Config)
	}{
		{"missing template setting", "dutyReportTemplateFile", func(c *Config) { c.DutyReportTemplateFile = "" }},
		{"missing template file", "read duty report template", func(c *Config) { c.DutyReportTemplateFile = "not-there.tmpl" }},
		{"missing signature", "read signature", func(c *Config) { c.SignatureFile = "missing.png" }},
		{"signature directory", "read signature", func(c *Config) { c.SignatureFile = "." }},
		{"corrupt signature", "load signature", func(c *Config) { c.SignatureFile = "report.html.tmpl" }},
	} {
		t.Run(test.name, func(t *testing.T) {
			_, _, configPath := setupDutyReportTest(t)
			config, err := readConfig(configPath)
			if err != nil {
				t.Fatal(err)
			}
			test.change(&config)
			writeTestConfig(t, configPath, config)
			_, err = renderTestDutyReport(t, configPath, "testdata/minimal-sessions.json", "2026-05", 0)
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("error = %v, want %q", err, test.want)
			}
		})
	}
	for _, source := range []string{"{{range .Lines}}", "{{.UnknownField}}", "{{range .Lines}}{{.Unsupported}}{{end}}", "{{unknownFunction}}"} {
		t.Run(source, func(t *testing.T) {
			_, _, configPath := setupDutyReportTest(t)
			path := filepath.Join(filepath.Dir(configPath), "report.html.tmpl")
			if err := os.WriteFile(path, []byte(source), 0o644); err != nil {
				t.Fatal(err)
			}
			_, err := renderTestDutyReport(t, configPath, "testdata/minimal-sessions.json", "2026-05", 0)
			if err == nil || !strings.Contains(err.Error(), "duty report template") || !strings.Contains(err.Error(), path) {
				t.Fatalf("template error = %v", err)
			}
		})
	}
}

func TestDutyReportTemplateMayOmitFieldsAndUseAbsolutePaths(t *testing.T) {
	_, _, configPath := setupDutyReportTest(t)
	config, err := readConfig(configPath)
	if err != nil {
		t.Fatal(err)
	}
	config.DutyReportTemplateFile = filepath.Join(filepath.Dir(configPath), "report.html.tmpl")
	config.SignatureFile = filepath.Join(filepath.Dir(configPath), "signature.png")
	writeTestConfig(t, configPath, config)
	if err := os.WriteFile(config.DutyReportTemplateFile, []byte(`<p>{{.Month}}</p>`), 0o644); err != nil {
		t.Fatal(err)
	}
	html, err := renderTestDutyReport(t, configPath, "testdata/minimal-sessions.json", "2026-05", 0)
	if err != nil {
		t.Fatal(err)
	}
	if html != "<p>2026-05</p>" {
		t.Fatalf("HTML = %q", html)
	}
}

func TestDutyReportPDFEmptySessionFileAndOptionalSignature(t *testing.T) {
	_, _, configPath := setupDutyReportTest(t)
	inputPath := filepath.Join(t.TempDir(), "empty.json")
	if err := os.WriteFile(inputPath, []byte(`{"schemaVersion":3,"sessions":[]}`), 0o644); err != nil {
		t.Fatal(err)
	}
	config, err := readConfig(configPath)
	if err != nil {
		t.Fatal(err)
	}
	config.SignatureFile = ""
	writeTestConfig(t, configPath, config)
	html, err := renderTestDutyReport(t, configPath, inputPath, "2026-05", 7200)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(html, "<img") || !strings.Contains(html, "Month 0:00, carry 120:00, year 120:00, block 0:00") {
		t.Fatalf("unsigned empty HTML = %s", html)
	}
}

func TestDutyReportCLIValidationAndHelp(t *testing.T) {
	for _, flag := range []string{"--help", "-h"} {
		var stdout bytes.Buffer
		if err := run(context.Background(), []string{"duty-report", flag}, &stdout, strings.NewReader(""), time.Now); err != nil {
			t.Fatal(err)
		}
		for _, want := range []string{"duty-report", "-carry-over-flight-duty", "-input", "-config", "-month", "-issue-date", "-output-dir", "-force"} {
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
