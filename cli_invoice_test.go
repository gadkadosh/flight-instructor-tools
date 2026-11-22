package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func setupInvoiceTest(t *testing.T) (args []string, outputDir string) {
	t.Helper()
	stubWeasyPrint(t, "exec /bin/cat")
	outputDirectory := t.TempDir()

	args = []string{
		"invoice",
		"--sessions", filepath.Join("testdata", "minimal-sessions.json"),
		"--config", filepath.Join("examples", "config.json"),
		"--month", "2026-05",
		"--number", "2026-05",
		"--output-dir", outputDirectory,
	}

	return args, outputDirectory
}

func TestRunInvoiceResolvesIssueDateInConfiguredTimeZone(t *testing.T) {
	args, outputDirectory := setupInvoiceTest(t)
	// Still June 9 in UTC, but already June 10 in the configured Europe/Berlin.
	fixedNow := time.Date(2026, time.June, 9, 22, 34, 56, 0, time.UTC)
	if err := run(context.Background(), args, io.Discard, strings.NewReader(""), func() time.Time { return fixedNow }); err != nil {
		t.Fatalf("run invoice: %v", err)
	}
	if pdf := readFile(t, filepath.Join(outputDirectory, "Rechnung-2026-05.pdf")); !strings.Contains(pdf, ">10.06.2026<") {
		t.Errorf("invoice does not use the issue date in the configured timezone:\n%s", pdf)
	}
}

func TestRunInvoiceUsesWorkingDirectoryDefaults(t *testing.T) {
	_, outputDirectory := setupInvoiceTest(t)
	directory := t.TempDir()
	for _, file := range []struct{ source, destination string }{
		{"testdata/minimal-sessions.json", "sessions.json"},
		{"examples/config.json", "config.json"},
	} {
		contents, err := os.ReadFile(file.source)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(directory, file.destination), contents, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	t.Chdir(directory)
	args := []string{"invoice", "--month", "2026-05", "--number", "2026-05", "--output-dir", outputDirectory}
	if err := run(context.Background(), args, io.Discard, strings.NewReader(""), time.Now); err != nil {
		t.Fatal(err)
	}
	if pdf := readFile(t, filepath.Join(outputDirectory, "Rechnung-2026-05.pdf")); !strings.Contains(pdf, ">45,00 €<") {
		t.Fatalf("invoice generated from default files has unexpected totals: %s", pdf)
	}
}

func TestRunInvoiceUsesConfiguredMonth(t *testing.T) {
	input, err := readSessionFile("testdata/minimal-sessions.json")
	if err != nil {
		t.Fatal(err)
	}
	may := input.Sessions[0]
	may.Student = "May Student"
	may.Activities = []Activity{testFlight("flight", ActivityDual, 60)}
	boundary := shiftSession(may, mustTimestamp(t, "2026-05-31T22:30:00Z").Sub(may.DutyStart))
	boundary.ID, boundary.Student = "boundary", "Boundary Student"
	boundary.DutyEnd = boundary.DutyStart.Add(time.Hour)
	input.Sessions = []Session{may, boundary}
	contents, err := json.Marshal(input)
	if err != nil {
		t.Fatal(err)
	}
	sessionsPath := filepath.Join(t.TempDir(), "sessions.json")
	if err := os.WriteFile(sessionsPath, contents, 0o600); err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		month, student, other, date string
	}{
		{"2026-05", "May Student", "Boundary Student", "03.05.26"},
		{"2026-06", "Boundary Student", "May Student", "01.06.26"},
	} {
		t.Run(test.month, func(t *testing.T) {
			args, outputDirectory := setupInvoiceTest(t)
			args = append(args, "--sessions", sessionsPath, "--month", test.month, "--issue-date", "2026-07-01")
			if err := run(context.Background(), args, io.Discard, strings.NewReader(""), time.Now); err != nil {
				t.Fatal(err)
			}
			pdf := readFile(t, filepath.Join(outputDirectory, "Rechnung-2026-05.pdf"))
			for _, want := range []string{test.student + " - Blockzeit", ">" + test.date + "<", ">30,00 €<"} {
				if !strings.Contains(pdf, want) {
					t.Errorf("invoice missing %q", want)
				}
			}
			if strings.Contains(pdf, test.other) {
				t.Errorf("invoice includes %s from another month", test.other)
			}
		})
	}
}

func TestRunInvoiceHelp(t *testing.T) {
	for _, argument := range []string{"-h", "--help"} {
		t.Run(argument, func(t *testing.T) {
			var stdout bytes.Buffer
			err := run(context.Background(), []string{"invoice", argument}, &stdout, strings.NewReader(""), time.Now)
			if err != nil {
				t.Fatalf("run invoice help: %v", err)
			}
			for _, text := range []string{
				"Usage: fitools invoice --month YYYY-MM --number NUMBER [flags]",
				"-sessions", "-config", "-month", "-number", "-issue-date", "-output-dir", "-force",
			} {
				if !strings.Contains(stdout.String(), text) {
					t.Errorf("help output does not contain %q", text)
				}
			}
			if strings.Contains(stdout.String(), "-signature") {
				t.Error("help output still advertises the removed signature flag")
			}
		})
	}
}

func TestExplicitIssueDateDoesNotReadClock(t *testing.T) {
	config, err := readConfig(filepath.Join("examples", "config.json"))
	if err != nil {
		t.Fatal(err)
	}
	clockRead := false
	date, err := config.issueDate("2026-06-10", func() time.Time {
		clockRead = true
		return time.Time{}
	})
	if err != nil {
		t.Fatalf("resolve issue date: %v", err)
	}
	if clockRead {
		t.Error("clock was read for an explicit issue date")
	}
	if got, want := date.Format("2006-01-02"), "2026-06-10"; got != want {
		t.Errorf("issue date = %q, want %q", got, want)
	}
}

func TestRunInvoiceRejectsInvalidNumber(t *testing.T) {
	args, outputDirectory := setupInvoiceTest(t)
	err := run(context.Background(), append(args, "--number", "2026/05"), io.Discard, strings.NewReader(""), time.Now)
	if err == nil || !strings.Contains(err.Error(), "invoice number") {
		t.Fatalf("error = %v, want invalid invoice number", err)
	}
	if entries, err := os.ReadDir(outputDirectory); err != nil || len(entries) != 0 {
		t.Fatalf("output directory = %v, %v; want it empty", entries, err)
	}
}
