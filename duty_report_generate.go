package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"flag"
	"fmt"
	"html/template"
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
	formatTime := func(value time.Time) string {
		if value.IsZero() {
			return ""
		}
		return value.Format("15:04")
	}
	tmpl, err := template.New("duty-report").Option("missingkey=error").Funcs(template.FuncMap{
		"formatDuration":  formatDuration,
		"formatTime":      formatTime,
		"formatRestUntil": formatTime,
		"formatMonth": func(value string) (string, error) {
			month, err := time.Parse("2006-01", value)
			if err != nil {
				return "", err
			}
			return [...]string{
				"Januar", "Februar", "März", "April", "Mai", "Juni",
				"Juli", "August", "September", "Oktober", "November", "Dezember",
			}[month.Month()-1], nil
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

// dutyReportPDF renders report with the configured template and signature as
// a PDF.
func dutyReportPDF(ctx context.Context, report DutyReport, config Config, configPath string) ([]byte, error) {
	if config.DutyReportTemplateFile == "" {
		return nil, fmt.Errorf("dutyReportTemplateFile: required for duty reports")
	}
	signaturePNG, err := readSignature(config, configPath)
	if err != nil {
		return nil, err
	}
	var html bytes.Buffer
	if err := renderDutyReportHTML(&html, report, configRelativePath(configPath, config.DutyReportTemplateFile), signaturePNG); err != nil {
		return nil, err
	}
	return convertHTMLToPDF(ctx, html.Bytes())
}

func runDutyReport(ctx context.Context, arguments []string, stdout io.Writer, stdin io.Reader, now func() time.Time) error {
	flags := flag.NewFlagSet("duty-report", flag.ContinueOnError)
	flags.SetOutput(stdout)
	flags.Usage = func() {
		fmt.Fprintln(stdout, "Usage: fitools duty-report --month YYYY-MM --carry-over-flight-duty H:MM [flags]")
		flags.PrintDefaults()
	}
	inputPath := flags.String("input", defaultInputPath, "session JSON file")
	configPath := flags.String("config", defaultConfigPath, "configuration JSON file")
	month := flags.String("month", "", "report month in YYYY-MM format")
	carryOverValue := flags.String("carry-over-flight-duty", "", "year-to-date flight-duty hours:minutes before this month (required, including 0:00)")
	issueDateValue := flags.String("issue-date", "", "issue date in YYYY-MM-DD format (default: today in configured timeZone)")
	outputDirectory := flags.String("output-dir", defaultOutputDirectory, "PDF output directory")
	var force bool
	flags.BoolVar(&force, "f", false, "force overwrite an existing PDF")
	flags.BoolVar(&force, "force", false, "force overwrite an existing PDF")
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
	issueDate, err := config.issueDate(*issueDateValue, now)
	if err != nil {
		return err
	}
	reportMonth, err := config.parseMonth(*month)
	if err != nil {
		return err
	}
	input, err := readSessionFile(*inputPath)
	if err != nil {
		return err
	}
	report, err := buildDutyReport(input.Sessions, config, reportMonth, issueDate, carryOver)
	if err != nil {
		return err
	}
	pdf, err := dutyReportPDF(ctx, report, config, *configPath)
	if err != nil {
		return err
	}
	return writePDF(filepath.Join(*outputDirectory, "Dienstzeitnachweis-"+*month+".pdf"), pdf, force, stdout, stdin)
}
