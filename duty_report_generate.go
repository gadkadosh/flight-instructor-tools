package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"html/template"
	"image/png"
	"io"
	"os"
	"path/filepath"
	"time"
)

type dutyReportTemplateData struct {
	DutyReport
	SignatureBase64 string
}

func renderDutyReportHTML(writer io.Writer, report DutyReport, templatePath string, signaturePNG []byte) error {
	source, err := os.ReadFile(templatePath)
	if err != nil {
		return fmt.Errorf("read duty report template %q: %w", templatePath, err)
	}
	tmpl, err := template.New("duty-report").Option("missingkey=error").Funcs(template.FuncMap{
		"formatDuration": formatDuration,
		"formatTime": func(value time.Time) string {
			if value.IsZero() {
				return ""
			}
			return value.Format("15:04")
		},
		"formatRestUntil": func(value time.Time) string {
			if value.IsZero() {
				return ""
			}
			return value.Format("02.01.2006 15:04")
		},
		"formatLongDate": func(value time.Time) string { return value.Format("02.01.2006") },
	}).Parse(string(source))
	if err != nil {
		return fmt.Errorf("parse duty report template %q: %w", templatePath, err)
	}
	data := dutyReportTemplateData{DutyReport: report, SignatureBase64: base64.StdEncoding.EncodeToString(signaturePNG)}
	if err := tmpl.Execute(writer, data); err != nil {
		return fmt.Errorf("render duty report template %q: %w", templatePath, err)
	}
	return nil
}

func configRelativePath(configPath, path string) string {
	if filepath.IsAbs(path) {
		return path
	}
	return filepath.Join(filepath.Dir(configPath), path)
}

func runDutyReport(ctx context.Context, arguments []string, stdout io.Writer, stdin io.Reader, now func() time.Time) error {
	flags := flag.NewFlagSet("duty-report", flag.ContinueOnError)
	flags.SetOutput(stdout)
	flags.Usage = func() {
		fmt.Fprintln(stdout, "Usage: fitools duty-report --input FILE --config FILE --month YYYY-MM --carry-over-flight-duty H:MM [flags]")
		flags.PrintDefaults()
	}
	inputPath := flags.String("input", "", "session JSON file")
	configPath := flags.String("config", "", "configuration JSON file")
	month := flags.String("month", "", "report month in YYYY-MM format")
	carryOverValue := flags.String("carry-over-flight-duty", "", "year-to-date flight-duty hours:minutes before this month (required, including 0:00)")
	issueDateValue := flags.String("issue-date", "", "issue date in YYYY-MM-DD format (default: today in configured timeZone)")
	outputDirectory := flags.String("output-dir", defaultOutputDirectory, "artifact output directory")
	var force bool
	flags.BoolVar(&force, "f", false, "force overwrite existing files")
	flags.BoolVar(&force, "force", false, "force overwrite existing files")
	if err := flags.Parse(arguments); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return nil
		}
		return fmt.Errorf("parse duty-report arguments: %w", err)
	}
	if flags.NArg() != 0 {
		return fmt.Errorf("unexpected positional arguments: %v", flags.Args())
	}
	for _, argument := range []struct{ name, value string }{
		{"input", *inputPath}, {"config", *configPath}, {"month", *month},
		{"carry-over-flight-duty", *carryOverValue}, {"output-dir", *outputDirectory},
	} {
		if argument.value == "" {
			return fmt.Errorf("--%s is required", argument.name)
		}
	}
	carryOver, err := parseCarryOver(*carryOverValue)
	if err != nil {
		return err
	}
	config, err := readConfig(*configPath)
	if err != nil {
		return err
	}
	location, err := dutyReportLocation(config)
	if err != nil {
		return err
	}
	if config.DutyReportTemplateFile == "" {
		return fmt.Errorf("dutyReportTemplateFile: required for duty reports")
	}
	var issueDate time.Time
	if *issueDateValue == "" {
		current := now().In(location)
		issueDate = time.Date(current.Year(), current.Month(), current.Day(), 0, 0, 0, 0, location)
	} else {
		issueDate, err = time.ParseInLocation("2006-01-02", *issueDateValue, location)
		if err != nil || issueDate.Format("2006-01-02") != *issueDateValue {
			return fmt.Errorf("issue date must use YYYY-MM-DD format: %q", *issueDateValue)
		}
	}
	var input SessionFile
	if err := readJSONFile(*inputPath, &input); err != nil {
		return fmt.Errorf("read sessions: %w", err)
	}
	if err := validateSessionRecords(input); err != nil {
		return fmt.Errorf("validate sessions: %w", err)
	}
	report, err := buildDutyReport(input.Sessions, config, *month, issueDate, carryOver)
	if err != nil {
		return err
	}
	var signaturePNG []byte
	if config.SignatureFile != "" {
		path := configRelativePath(*configPath, config.SignatureFile)
		signaturePNG, err = os.ReadFile(path)
		if err != nil {
			return fmt.Errorf("read signature %q: %w", path, err)
		}
		if _, err := png.Decode(bytes.NewReader(signaturePNG)); err != nil {
			return fmt.Errorf("load signature %q as PNG: %w", path, err)
		}
	}
	// Resolve all configuration and render in memory before touching outputs.
	var html bytes.Buffer
	if err := renderDutyReportHTML(&html, report, configRelativePath(*configPath, config.DutyReportTemplateFile), signaturePNG); err != nil {
		return err
	}
	snapshot, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return fmt.Errorf("encode duty report JSON: %w", err)
	}
	snapshot = append(snapshot, '\n')
	baseName := "Dienstzeitnachweis-" + *month
	paths := make([]string, 0, 3)
	for _, extension := range []string{"json", "html", "pdf"} {
		path := filepath.Join(*outputDirectory, baseName+"."+extension)
		info, err := os.Stat(path)
		if err != nil && !errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("stat duty report artifact %q: %w", path, err)
		}
		if err == nil && !info.Mode().IsRegular() {
			return fmt.Errorf("duty report artifact %q is not a regular file", path)
		}
		paths = append(paths, path)
	}
	if err := confirmOverwrite(paths, "Duty report "+*month, force, stdout, stdin); err != nil {
		return err
	}
	if err := os.MkdirAll(*outputDirectory, 0o755); err != nil {
		return fmt.Errorf("create output directory: %w", err)
	}
	// Stage conversion too: a renderer failure must not replace an existing report.
	staging, err := os.MkdirTemp(*outputDirectory, ".duty-report-*")
	if err != nil {
		return fmt.Errorf("stage duty report: %w", err)
	}
	defer os.RemoveAll(staging)
	stagedJSON := filepath.Join(staging, baseName+".json")
	stagedHTML := filepath.Join(staging, baseName+".html")
	stagedPDF := filepath.Join(staging, baseName+".pdf")
	for _, artifact := range []struct {
		path string
		data []byte
	}{{stagedJSON, snapshot}, {stagedHTML, html.Bytes()}} {
		if err := os.WriteFile(artifact.path, artifact.data, 0o644); err != nil {
			return fmt.Errorf("write duty report artifact: %w", err)
		}
	}
	if err := writeInvoicePDF(ctx, stagedHTML, stagedPDF); err != nil {
		return err
	}
	for i, staged := range []string{stagedJSON, stagedHTML, stagedPDF} {
		if err := os.Rename(staged, paths[i]); err != nil {
			return fmt.Errorf("publish duty report artifact %q: %w", paths[i], err)
		}
	}
	for _, path := range paths {
		fmt.Fprintf(stdout, "Wrote %s\n", path)
	}
	return nil
}
