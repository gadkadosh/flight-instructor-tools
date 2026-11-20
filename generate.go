package main

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
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
	signaturePNG, err := readSignature(config, *configPath)
	if err != nil {
		return err
	}
	var snapshot, html bytes.Buffer
	if err := renderInvoiceSnapshot(&snapshot, document); err != nil {
		return err
	}
	if err := renderInvoiceHTML(&html, document, signaturePNG); err != nil {
		return fmt.Errorf("render invoice HTML: %w", err)
	}

	paths := documentPaths(*outputDirectory, "Rechnung-"+*number)
	if err := confirmOverwrite(paths, "Invoice "+*number, force, stdout, stdin); err != nil {
		return err
	}
	if err := writeDocumentFiles(ctx, paths, snapshot.Bytes(), html.Bytes()); err != nil {
		return err
	}
	for _, path := range paths {
		fmt.Fprintf(stdout, "Wrote %s\n", path)
	}
	return nil
}

func confirmOverwrite(paths []string, label string, force bool, stdout io.Writer, stdin io.Reader) error {
	hasExistingOutputs := false
	for _, path := range paths {
		info, err := os.Stat(path)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return fmt.Errorf("stat output file: %w", err)
		}
		if !info.Mode().IsRegular() {
			return fmt.Errorf("output %q is not a regular file", path)
		}
		hasExistingOutputs = true
	}
	if !hasExistingOutputs || force {
		return nil
	}
	fmt.Fprintf(stdout, "%s has existing output files. Overwrite? [y/N] ", label)
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
	return nil
}

// documentPaths returns the JSON snapshot, HTML, and PDF paths of a document.
func documentPaths(directory, baseName string) []string {
	return []string{
		filepath.Join(directory, baseName+".json"),
		filepath.Join(directory, baseName+".html"),
		filepath.Join(directory, baseName+".pdf"),
	}
}

// writeDocumentFiles writes snapshot, html, and the PDF converted from html to
// paths from documentPaths. Files are staged and moved into place only after
// the PDF conversion succeeds, so a failed render or conversion leaves
// existing files untouched.
func writeDocumentFiles(ctx context.Context, paths []string, snapshot, html []byte) error {
	// Ctrl-C stops the conversion instead of the process, so the staging folder
	// is still removed.
	ctx, stop := signal.NotifyContext(ctx, os.Interrupt, syscall.SIGTERM)
	defer stop()
	directory := filepath.Dir(paths[0])
	if err := os.MkdirAll(directory, 0o755); err != nil {
		return fmt.Errorf("create output directory: %w", err)
	}
	staging, err := os.MkdirTemp(directory, ".fitools-*")
	if err != nil {
		return fmt.Errorf("stage output files: %w", err)
	}
	defer os.RemoveAll(staging)
	staged := make([]string, len(paths))
	for i, path := range paths {
		staged[i] = filepath.Join(staging, filepath.Base(path))
	}
	if err := os.WriteFile(staged[0], snapshot, 0o644); err != nil {
		return fmt.Errorf("write JSON snapshot: %w", err)
	}
	if err := os.WriteFile(staged[1], html, 0o644); err != nil {
		return fmt.Errorf("write HTML: %w", err)
	}
	if err := convertHTMLToPDF(ctx, staged[1], staged[2]); err != nil {
		return err
	}
	for i, path := range paths {
		if err := os.Rename(staged[i], path); err != nil {
			return fmt.Errorf("move output file into place: %w", err)
		}
	}
	return nil
}
