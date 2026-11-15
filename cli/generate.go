package main

import (
	"bufio"
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func runGenerate(ctx context.Context, arguments []string, stdout io.Writer, stdin io.Reader, now func() time.Time) error {
	flags := flag.NewFlagSet("generate", flag.ContinueOnError)
	flags.SetOutput(stdout)
	flags.Usage = func() {
		fmt.Fprintln(stdout, "Usage: fitools generate --input FILE --config FILE --month YYYY-MM --number NUMBER [flags]")
		flags.PrintDefaults()
	}
	inputPath := flags.String("input", "", "session JSON file")
	configPath := flags.String("config", "", "invoice configuration JSON file")
	month := flags.String("month", "", "invoice month in YYYY-MM format")
	number := flags.String("number", "", "invoice number")
	issueDateValue := flags.String("issue-date", "", "invoice issue date in YYYY-MM-DD format")
	outputDirectory := flags.String("output-dir", defaultOutputDirectory, "artifact output directory")
	var force bool
	flags.BoolVar(&force, "f", false, "force overwrite existing files")
	flags.BoolVar(&force, "force", false, "force overwrite existing files")
	if err := flags.Parse(arguments); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return nil
		}
		return fmt.Errorf("parse generate arguments: %w", err)
	}
	if flags.NArg() != 0 {
		return fmt.Errorf("unexpected positional arguments: %v", flags.Args())
	}
	requiredArguments := []struct {
		name  string
		value string
	}{
		{name: "input", value: *inputPath},
		{name: "config", value: *configPath},
		{name: "month", value: *month},
		{name: "number", value: *number},
		{name: "output-dir", value: *outputDirectory},
	}
	for _, argument := range requiredArguments {
		if argument.value == "" {
			return fmt.Errorf("--%s is required", argument.name)
		}
	}

	issueDate, err := resolveIssueDate(*issueDateValue, now)
	if err != nil {
		return err
	}
	input, err := readSessionFile(*inputPath)
	if err != nil {
		return err
	}
	config, err := readConfig(*configPath)
	if err != nil {
		return err
	}

	sessions, err := selectSessions(input.Sessions, *month)
	if err != nil {
		return err
	}

	document, err := buildInvoiceDocument(sessions, config, *number, issueDate)
	if err != nil {
		return fmt.Errorf("build fitools: %w", err)
	}
	var signaturePNG []byte
	if config.SignatureFile != "" {
		signaturePath := config.SignatureFile
		if !filepath.IsAbs(signaturePath) {
			signaturePath = filepath.Join(filepath.Dir(*configPath), signaturePath)
		}
		signaturePNG, err = os.ReadFile(signaturePath)
		if err != nil {
			return fmt.Errorf("read signature %q: %w", signaturePath, err)
		}
	}

	if err := os.MkdirAll(*outputDirectory, 0o755); err != nil {
		return fmt.Errorf("create output directory: %w", err)
	}
	baseName := "Rechnung-" + *number
	jsonPath := filepath.Join(*outputDirectory, baseName+".json")
	htmlPath := filepath.Join(*outputDirectory, baseName+".html")
	pdfPath := filepath.Join(*outputDirectory, baseName+".pdf")

	if !force {
		hasExistingOutputs := false
		for _, path := range []string{jsonPath, htmlPath, pdfPath} {
			_, err := os.Stat(path)
			if errors.Is(err, os.ErrNotExist) {
				continue
			}
			if err != nil {
				return fmt.Errorf("file stat %s error: %w", path, err)
			}

			hasExistingOutputs = true
		}
		if hasExistingOutputs {
			fmt.Fprintf(stdout, "Invoice %s has existing output files. Overwrite? [y/N] ", *number)
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
		}
	}

	if err := writeInvoiceSnapshot(jsonPath, document); err != nil {
		return err
	}
	if err := writeInvoiceHTML(htmlPath, document, signaturePNG); err != nil {
		return err
	}
	if err := writeInvoicePDF(ctx, htmlPath, pdfPath); err != nil {
		return err
	}

	fmt.Fprintf(stdout, "Wrote %s\nWrote %s\nWrote %s\n", jsonPath, htmlPath, pdfPath)
	return nil
}
