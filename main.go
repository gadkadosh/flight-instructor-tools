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

const (
	defaultOutputDirectory = "output"
	defaultSignaturePath   = "signature.png"
)

func main() {
	if err := run(context.Background(), os.Args[1:], os.Stdout, os.Stdin, time.Now); err != nil {
		fmt.Fprintf(os.Stderr, "fitools: %v\n", err)
		os.Exit(1)
	}
}

func run(ctx context.Context, arguments []string, stdout io.Writer, stdin io.Reader, now func() time.Time) error {
	if len(arguments) == 0 || arguments[0] != "generate" {
		return fmt.Errorf("usage: fitools generate --input FILE --config FILE --month YYYY-MM --number NUMBER [--issue-date YYYY-MM-DD] [--output-dir DIR] [--signature FILE] [-f|--force]")
	}

	flags := flag.NewFlagSet("generate", flag.ContinueOnError)
	inputPath := flags.String("input", "", "session JSON file")
	configPath := flags.String("config", "", "invoice configuration JSON file")
	month := flags.String("month", "", "invoice month in YYYY-MM format")
	number := flags.String("number", "", "invoice number")
	issueDateValue := flags.String("issue-date", "", "invoice issue date in YYYY-MM-DD format")
	outputDirectory := flags.String("output-dir", defaultOutputDirectory, "artifact output directory")
	signaturePath := flags.String("signature", defaultSignaturePath, "signature PNG file")
	var force bool
	flags.BoolVar(&force, "f", false, "force overwrite existing files")
	flags.BoolVar(&force, "force", false, "force overwrite existing files")
	if err := flags.Parse(arguments[1:]); err != nil {
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
		{name: "signature", value: *signaturePath},
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
	signaturePNG, err := os.ReadFile(*signaturePath)
	if err != nil {
		return fmt.Errorf("read signature %q: %w", *signaturePath, err)
	}

	if err := os.MkdirAll(*outputDirectory, 0o755); err != nil {
		return fmt.Errorf("create output directory: %w", err)
	}
	baseName := "Rechnung-" + *number
	jsonPath := filepath.Join(*outputDirectory, baseName+".json")
	htmlPath := filepath.Join(*outputDirectory, baseName+".html")
	pdfPath := filepath.Join(*outputDirectory, baseName+".pdf")

	if !force {
		scanner := bufio.NewScanner(stdin)

		for _, path := range []string{jsonPath, htmlPath, pdfPath} {
			_, err := os.Stat(path)
			if errors.Is(err, os.ErrNotExist) {
				continue
			}
			if err != nil {
				return fmt.Errorf("file stat %s error: %w", path, err)
			}

			// File exists already
			fmt.Fprintf(stdout, "%s already exists. Overwrite? [y/N] ", path)
			if !scanner.Scan() {
				if err := scanner.Err(); err != nil {
					return fmt.Errorf("read overwrite confirmation: %w", err)
				}
				return fmt.Errorf("aborting: no confirmation received")
			}

			input := scanner.Text()
			if !strings.EqualFold(strings.TrimSpace(input), "y") {
				return fmt.Errorf("aborting")
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

func resolveIssueDate(value string, now func() time.Time) (time.Time, error) {
	if value != "" {
		date, err := parseDate(value)
		if err != nil {
			return time.Time{}, fmt.Errorf("issue date: %w", err)
		}
		return date, nil
	}

	current := now().In(time.Local)
	return time.Date(current.Year(), current.Month(), current.Day(), 0, 0, 0, 0, time.Local), nil
}
