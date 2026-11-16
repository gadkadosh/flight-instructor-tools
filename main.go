package main

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/signal"
	"syscall"
	"time"
)

const defaultOutputDirectory = "output"

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := run(ctx, os.Args[1:], os.Stdout, os.Stdin, time.Now); err != nil {
		fmt.Fprintf(os.Stderr, "fitools: %v\n", err)
		os.Exit(1)
	}
}

func usage(w io.Writer) {
	fmt.Fprint(w, `Usage: fitools [command] [flags]

Without a command, start the local web UI and open it in your browser.

Commands:
    serve       Start the local web UI
    generate    Generate invoice artifacts
    duty-report Generate monthly duty-report artifacts
    validate    Validate a sessions file (JSON)

Run fitools <command> --help for command options.
`)
}

func run(ctx context.Context, arguments []string, stdout io.Writer, stdin io.Reader, now func() time.Time) error {
	if len(arguments) == 0 {
		return runServe(ctx, nil, stdout)
	}

	switch arguments[0] {
	case "-h", "--help":
		usage(stdout)
		return nil
	case "serve":
		return runServe(ctx, arguments[1:], stdout)
	case "generate":
		return runGenerate(ctx, arguments[1:], stdout, stdin, now)
	case "duty-report":
		return runDutyReport(ctx, arguments[1:], stdout, stdin, now)
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
