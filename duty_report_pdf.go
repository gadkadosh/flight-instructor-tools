package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"html/template"
	"io"
	"os"
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
