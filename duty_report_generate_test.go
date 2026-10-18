package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/iotest"
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

func readDutyArtifact(t *testing.T, directory, month, extension string) []byte {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(directory, "Dienstzeitnachweis-"+month+"."+extension))
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func TestRunDutyReportArtifactsSignatureAndRelativePaths(t *testing.T) {
	args, output, configPath := setupDutyReportTest(t)
	var stdout bytes.Buffer
	clock := func() time.Time { return mustTimestamp(t, "2026-05-31T23:30:00Z") }
	if err := run(context.Background(), args, &stdout, strings.NewReader(""), clock); err != nil {
		t.Fatal(err)
	}
	var snapshot DutyReport
	if err := json.Unmarshal(readDutyArtifact(t, output, "2026-05", "json"), &snapshot); err != nil {
		t.Fatal(err)
	}
	if snapshot.Totals != (DutyReportTotals{CarryOver: 7200, CurrentMonth: 180, CurrentYear: 7380, BlockMinutes: 65}) ||
		snapshot.IssueDate.Format("2006-01-02") != "2026-06-01" || snapshot.Issuer.Name != "Erika Musterfrau" ||
		snapshot.TimeZone != "Europe/Berlin" || snapshot.Lines[2].Start.Format("15:04") != "12:00" {
		t.Fatalf("snapshot has incorrect calculated values: %+v", snapshot)
	}
	html := string(readDutyArtifact(t, output, "2026-05", "html"))
	for _, want := range []string{"Erika Musterfrau — 2026-05", "Issued 01.06.2026 (Europe/Berlin)",
		"<td>03</td><td>12:00</td><td>15:00</td><td>3:00</td><td>1:05</td><td>04.05.2026 03:00</td>",
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
	if got := string(readDutyArtifact(t, output, "2026-05", "pdf")); got != "pdf" {
		t.Errorf("PDF conversion output = %q", got)
	}
	if strings.Count(stdout.String(), "Wrote ") != 3 {
		t.Errorf("output = %q", stdout.String())
	}
}

func TestRunDutyReportEmptyFebruaryAndExplicitIssueDate(t *testing.T) {
	args, output, _ := setupDutyReportTest(t)
	args = append(args, "--month", "2026-02", "--carry-over-flight-duty", "0:00", "--issue-date", "2026-03-02")
	if err := run(context.Background(), args, io.Discard, strings.NewReader(""), func() time.Time {
		t.Fatal("clock read with explicit issue date")
		return time.Time{}
	}); err != nil {
		t.Fatal(err)
	}
	var snapshot DutyReport
	if err := json.Unmarshal(readDutyArtifact(t, output, "2026-02", "json"), &snapshot); err != nil {
		t.Fatal(err)
	}
	if snapshot.Totals != (DutyReportTotals{}) || len(snapshot.Lines) != 31 || snapshot.Lines[28].Date != "" ||
		snapshot.IssueDate.Format("2006-01-02") != "2026-03-02" {
		t.Fatalf("empty February = %+v", snapshot)
	}
	html := string(readDutyArtifact(t, output, "2026-02", "html"))
	if strings.Count(html, `class="day"`) != 31 || strings.Count(html, `<tr class="day"><td></td><td></td><td></td><td></td><td></td><td></td></tr>`) != 3 ||
		!strings.Contains(html, "Month 0:00, carry 0:00, year 0:00, block 0:00") {
		t.Fatalf("empty rows/totals incorrect: %s", html)
	}
}

func TestDutyReportTemplateAndConfigFailuresLeaveNoOutputs(t *testing.T) {
	for _, test := range []struct {
		name, want string
		change     func(*Config)
	}{
		{"missing timezone", "timeZone", func(c *Config) { c.TimeZone = "" }},
		{"invalid timezone", "timeZone", func(c *Config) { c.TimeZone = "Not/AZone" }},
		{"computer timezone", "timeZone", func(c *Config) { c.TimeZone = "Local" }},
		{"missing template setting", "dutyReportTemplateFile", func(c *Config) { c.DutyReportTemplateFile = "" }},
		{"missing template file", "read duty report template", func(c *Config) { c.DutyReportTemplateFile = "not-there.tmpl" }},
		{"missing signature", "read signature", func(c *Config) { c.SignatureFile = "missing.png" }},
		{"signature directory", "read signature", func(c *Config) { c.SignatureFile = "." }},
		{"corrupt signature", "load signature", func(c *Config) { c.SignatureFile = "report.html.tmpl" }},
	} {
		t.Run(test.name, func(t *testing.T) {
			args, output, configPath := setupDutyReportTest(t)
			config, err := readConfig(configPath)
			if err != nil {
				t.Fatal(err)
			}
			test.change(&config)
			writeTestConfig(t, configPath, config)
			err = run(context.Background(), args, io.Discard, strings.NewReader(""), time.Now)
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("error = %v, want %q", err, test.want)
			}
			entries, err := os.ReadDir(output)
			if err != nil || len(entries) != 0 {
				t.Fatalf("partial outputs = %v, %v", entries, err)
			}
		})
	}
	for _, source := range []string{"{{range .Lines}}", "{{.UnknownField}}", "{{range .Lines}}{{.Unsupported}}{{end}}", "{{unknownFunction}}"} {
		t.Run(source, func(t *testing.T) {
			args, output, configPath := setupDutyReportTest(t)
			path := filepath.Join(filepath.Dir(configPath), "report.html.tmpl")
			if err := os.WriteFile(path, []byte(source), 0o644); err != nil {
				t.Fatal(err)
			}
			// Existing files must survive template errors, even with --force.
			original := filepath.Join(output, "Dienstzeitnachweis-2026-05.json")
			if err := os.WriteFile(original, []byte("original"), 0o644); err != nil {
				t.Fatal(err)
			}
			err := run(context.Background(), append(args, "--force"), io.Discard, strings.NewReader(""), time.Now)
			if err == nil || !strings.Contains(err.Error(), "duty report template") || !strings.Contains(err.Error(), path) {
				t.Fatalf("template error = %v", err)
			}
			data, err := os.ReadFile(original)
			if err != nil || string(data) != "original" {
				t.Fatalf("existing output changed: %q, %v", data, err)
			}
			entries, err := os.ReadDir(output)
			if err != nil || len(entries) != 1 {
				t.Fatalf("partial outputs = %v, %v", entries, err)
			}
		})
	}
}

func TestDutyReportTemplateMayOmitFieldsAndUseAbsolutePaths(t *testing.T) {
	args, output, configPath := setupDutyReportTest(t)
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
	if err := run(context.Background(), args, io.Discard, strings.NewReader(""), time.Now); err != nil {
		t.Fatal(err)
	}
	if got := string(readDutyArtifact(t, output, "2026-05", "html")); got != "<p>2026-05</p>" {
		t.Fatalf("HTML = %q", got)
	}
}

func TestDutyReportOverwrite(t *testing.T) {
	for _, test := range []struct {
		name, response, force, wantError string
		existing                         []string
		readError                        bool
	}{
		{name: "no outputs"},
		{name: "JSON only", existing: []string{"json"}, response: "y\n"},
		{name: "HTML only", existing: []string{"html"}, response: "y\n"},
		{name: "PDF only", existing: []string{"pdf"}, response: "y\n"},
		{name: "all outputs", existing: []string{"json", "html", "pdf"}, response: " Y \n"},
		{name: "decline", existing: []string{"json", "html", "pdf"}, response: "n\n", wantError: "aborting: overwrite not confirmed"},
		{name: "EOF", existing: []string{"pdf"}, wantError: "aborting: no confirmation received"},
		{name: "blank", existing: []string{"html"}, response: "\n", wantError: "aborting: overwrite not confirmed"},
		{name: "read failure", existing: []string{"json"}, readError: true, wantError: "read overwrite confirmation: input failed"},
		{name: "force", existing: []string{"json", "html", "pdf"}, force: "--force"},
		{name: "force short", existing: []string{"json", "html", "pdf"}, force: "-f"},
	} {
		t.Run(test.name, func(t *testing.T) {
			args, output, _ := setupDutyReportTest(t)
			for _, ext := range test.existing {
				if err := os.WriteFile(filepath.Join(output, "Dienstzeitnachweis-2026-05."+ext), []byte("original"), 0o644); err != nil {
					t.Fatal(err)
				}
			}
			if test.force != "" {
				args = append(args, test.force)
			}
			var stdin io.Reader = strings.NewReader(test.response)
			if test.readError {
				stdin = iotest.ErrReader(fmt.Errorf("input failed"))
			}
			var stdout bytes.Buffer
			err := run(context.Background(), args, &stdout, stdin, time.Now)
			if test.wantError != "" {
				if err == nil || err.Error() != test.wantError {
					t.Fatalf("error = %v, want %q", err, test.wantError)
				}
				entries, err := os.ReadDir(output)
				if err != nil || len(entries) != len(test.existing) {
					t.Fatalf("unexpected outputs = %v, %v", entries, err)
				}
				for _, ext := range test.existing {
					if got := string(readDutyArtifact(t, output, "2026-05", ext)); got != "original" {
						t.Errorf("%s changed on refusal", ext)
					}
				}
			} else {
				if err != nil {
					t.Fatal(err)
				}
				for _, artifact := range []struct{ ext, want string }{{"json", `"currentYear": 7380`}, {"html", "year 123:00"}, {"pdf", "pdf"}} {
					if !bytes.Contains(readDutyArtifact(t, output, "2026-05", artifact.ext), []byte(artifact.want)) {
						t.Errorf("%s has incorrect content", artifact.ext)
					}
				}
			}
			wantPrompts := 0
			if len(test.existing) > 0 && test.force == "" {
				wantPrompts = 1
			}
			if got := strings.Count(stdout.String(), "Overwrite? [y/N]"); got != wantPrompts {
				t.Errorf("prompts = %d, want %d", got, wantPrompts)
			}
		})
	}
}

func TestDutyReportRendererFailurePreservesExistingArtifacts(t *testing.T) {
	args, output, _ := setupDutyReportTest(t)
	for _, ext := range []string{"json", "html", "pdf"} {
		if err := os.WriteFile(filepath.Join(output, "Dienstzeitnachweis-2026-05."+ext), []byte("original"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("PATH", t.TempDir())
	err := run(context.Background(), append(args, "-f"), io.Discard, strings.NewReader(""), time.Now)
	if err == nil || !strings.Contains(err.Error(), "WeasyPrint") {
		t.Fatalf("error = %v", err)
	}
	for _, ext := range []string{"json", "html", "pdf"} {
		if got := string(readDutyArtifact(t, output, "2026-05", ext)); got != "original" {
			t.Errorf("%s replaced on renderer failure", ext)
		}
	}
	entries, err := os.ReadDir(output)
	if err != nil || len(entries) != 3 {
		t.Fatalf("staging not cleaned: %v, %v", entries, err)
	}
}

func TestDutyReportEmptySessionFileAndOptionalSignature(t *testing.T) {
	args, output, configPath := setupDutyReportTest(t)
	inputPath := filepath.Join(t.TempDir(), "empty.json")
	if err := os.WriteFile(inputPath, []byte(`{"schemaVersion":2,"sessions":[]}`), 0o644); err != nil {
		t.Fatal(err)
	}
	config, err := readConfig(configPath)
	if err != nil {
		t.Fatal(err)
	}
	config.SignatureFile = ""
	writeTestConfig(t, configPath, config)
	args = append(args, "--input", inputPath)
	if err := run(context.Background(), args, io.Discard, strings.NewReader(""), time.Now); err != nil {
		t.Fatal(err)
	}
	var snapshot DutyReport
	if err := json.Unmarshal(readDutyArtifact(t, output, "2026-05", "json"), &snapshot); err != nil {
		t.Fatal(err)
	}
	if snapshot.Totals != (DutyReportTotals{CarryOver: 7200, CurrentYear: 7200}) {
		t.Fatalf("empty file totals = %+v", snapshot.Totals)
	}
	html := string(readDutyArtifact(t, output, "2026-05", "html"))
	if strings.Contains(html, "<img") || !strings.Contains(html, "Month 0:00, carry 120:00, year 120:00") {
		t.Fatalf("unsigned empty HTML = %s", html)
	}
	if _, err := readSessionFile(inputPath); err == nil {
		t.Error("invoice/validate reader must still reject empty session files")
	}
}

func TestDutyReportRejectsOutputDirectoryBeforeReplacingFiles(t *testing.T) {
	args, output, _ := setupDutyReportTest(t)
	jsonPath := filepath.Join(output, "Dienstzeitnachweis-2026-05.json")
	if err := os.WriteFile(jsonPath, []byte("original"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(output, "Dienstzeitnachweis-2026-05.pdf"), 0o755); err != nil {
		t.Fatal(err)
	}
	err := run(context.Background(), append(args, "-f"), io.Discard, strings.NewReader(""), time.Now)
	if err == nil || !strings.Contains(err.Error(), "not a regular file") {
		t.Fatalf("error = %v", err)
	}
	if got := string(readDutyArtifact(t, output, "2026-05", "json")); got != "original" {
		t.Errorf("JSON replaced on invalid output target: %s", got)
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
