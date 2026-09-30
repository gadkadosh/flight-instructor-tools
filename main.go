package main

import (
	"context"
	"fmt"
	"io"
	"os"
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

func usage(w io.Writer) {
	fmt.Fprint(w, `Usage: fitools <command> [flags]

Commands:
    generate    Generate invoice artifacts
    validate    Validate a sessions file (JSON)

Run fitools <command> --help for command options.
`)
}

func run(ctx context.Context, arguments []string, stdout io.Writer, stdin io.Reader, now func() time.Time) error {
	if len(arguments) == 0 {
		usage(stdout)
		return fmt.Errorf("must provide a command")
	}

	switch arguments[0] {
	case "-h", "--help":
		usage(stdout)
		return nil
	case "generate":
		return runGenerate(ctx, arguments[1:], stdout, stdin, now)
	case "validate":
		return runValidate(arguments[1:], stdout)
	default:
		usage(stdout)
		return fmt.Errorf("unknown command: %q", arguments[0])
	}
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
