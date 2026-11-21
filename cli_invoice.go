package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"path/filepath"
	"time"
)

func runGenerate(ctx context.Context, arguments []string, stdout io.Writer, stdin io.Reader, now func() time.Time) error {
	flags := flag.NewFlagSet("generate", flag.ContinueOnError)
	flags.SetOutput(stdout)
	flags.Usage = func() {
		fmt.Fprintln(stdout, "Usage: fitools generate --month YYYY-MM --number NUMBER [flags]")
		flags.PrintDefaults()
	}
	inputPath := flags.String("input", defaultInputPath, "session JSON file")
	configPath := flags.String("config", defaultConfigPath, "invoice configuration JSON file")
	month := flags.String("month", "", "invoice month in YYYY-MM format")
	number := flags.String("number", "", "invoice number")
	issueDateValue := flags.String("issue-date", "", "invoice issue date in YYYY-MM-DD format (default: today in configured timeZone)")
	outputDirectory := flags.String("output-dir", defaultOutputDirectory, "PDF output directory")
	var force bool
	flags.BoolVar(&force, "f", false, "force overwrite an existing PDF")
	flags.BoolVar(&force, "force", false, "force overwrite an existing PDF")
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

	input, err := readSessionFile(*inputPath)
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
	invoiceMonth, err := config.parseMonth(*month)
	if err != nil {
		return err
	}
	sessions, err := selectSessions(input.Sessions, invoiceMonth)
	if err != nil {
		return err
	}
	document, err := buildInvoiceDocument(sessions, config, *number, issueDate)
	if err != nil {
		return fmt.Errorf("build invoice: %w", err)
	}
	pdf, err := invoicePDF(ctx, document, config, *configPath)
	if err != nil {
		return err
	}
	return writePDF(filepath.Join(*outputDirectory, "Rechnung-"+*number+".pdf"), pdf, force, stdout, stdin)
}
