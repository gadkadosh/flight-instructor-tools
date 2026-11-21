package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/iotest"
	"time"
)

func setupGenerateTest(t *testing.T) (args []string, outputDir string) {
	t.Helper()
	stubWeasyPrint(t, "exec /bin/cat")
	outputDirectory := t.TempDir()

	args = []string{
		"generate",
		"--input", filepath.Join("testdata", "minimal-sessions.json"),
		"--config", filepath.Join("testdata", "minimal-config.json"),
		"--month", "2026-05",
		"--number", "2026-05",
		"--output-dir", outputDirectory,
	}

	return args, outputDirectory
}

func readFile(t *testing.T, path string) string {
	t.Helper()
	contents, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(contents)
}

// documentCommands are the CLI commands that write one document PDF. With the
// stub converter, content appears in the PDF of the minimal fixtures.
var documentCommands = []struct {
	name, pdf, content string
	setup              func(t *testing.T) []string
}{
	{"generate", "Rechnung-2026-05.pdf", "Rechnung Nr. 2026-05", func(t *testing.T) []string {
		args, _ := setupGenerateTest(t)
		return args
	}},
	{"duty-report", "Dienstzeitnachweis-2026-05.pdf", "Month 3:00, carry 120:00, year 123:00, block 1:05", func(t *testing.T) []string {
		args, _, _ := setupDutyReportTest(t)
		return args
	}},
}

func TestDocumentCommandsWriteOnlyThePDF(t *testing.T) {
	for _, command := range documentCommands {
		t.Run(command.name, func(t *testing.T) {
			directory := filepath.Join(t.TempDir(), "not-yet-created")
			args := append(command.setup(t), "--output-dir", directory)
			var stdout bytes.Buffer
			if err := run(context.Background(), args, &stdout, strings.NewReader(""), time.Now); err != nil {
				t.Fatal(err)
			}
			entries, err := os.ReadDir(directory)
			if err != nil || len(entries) != 1 || entries[0].Name() != command.pdf {
				t.Fatalf("output directory = %v, %v; want only %s", entries, err, command.pdf)
			}
			path := filepath.Join(directory, command.pdf)
			if got := stdout.String(); got != "Wrote "+path+"\n" {
				t.Errorf("output = %q", got)
			}
			if pdf := readFile(t, path); !strings.Contains(pdf, command.content) {
				t.Errorf("PDF does not contain %q:\n%s", command.content, pdf)
			}
		})
	}
}

func TestDocumentCommandsOverwrite(t *testing.T) {
	for _, command := range documentCommands {
		for _, test := range []struct {
			name      string
			existing  bool
			input     string
			inputErr  bool
			force     string
			wantError string
		}{
			{name: "no existing PDF"},
			{name: "confirm", existing: true, input: "y\n"},
			{name: "case and whitespace", existing: true, input: " Y \n"},
			{name: "decline", existing: true, input: "n\n", wantError: "aborting: overwrite not confirmed"},
			{name: "blank response", existing: true, input: "\n", wantError: "aborting: overwrite not confirmed"},
			{name: "other response", existing: true, input: "yes\n", wantError: "aborting: overwrite not confirmed"},
			{name: "EOF", existing: true, wantError: "aborting: no confirmation received"},
			{name: "input read error", existing: true, inputErr: true, wantError: "read overwrite confirmation: input failed"},
			{name: "force", existing: true, input: "n\n", force: "--force"},
			{name: "force shorthand", existing: true, input: "n\n", force: "-f"},
		} {
			t.Run(command.name+"/"+test.name, func(t *testing.T) {
				directory := t.TempDir()
				args := append(command.setup(t), "--output-dir", directory)
				path := filepath.Join(directory, command.pdf)
				if test.existing {
					if err := os.WriteFile(path, []byte("original"), 0o644); err != nil {
						t.Fatal(err)
					}
				}
				if test.force != "" {
					args = append(args, test.force)
				}
				var stdin io.Reader = strings.NewReader(test.input)
				if test.inputErr {
					stdin = iotest.ErrReader(fmt.Errorf("input failed"))
				}
				var stdout bytes.Buffer
				err := run(context.Background(), args, &stdout, stdin, time.Now)
				if test.wantError != "" {
					if err == nil || err.Error() != test.wantError {
						t.Fatalf("error = %v, want %q", err, test.wantError)
					}
				} else if err != nil {
					t.Fatal(err)
				}

				prompt := path + " exists. Overwrite? [y/N] "
				wantPrompts := 0
				if test.existing && test.force == "" {
					wantPrompts = 1
				}
				if got := strings.Count(stdout.String(), prompt); got != wantPrompts {
					t.Errorf("prompts = %d, want %d; output: %q", got, wantPrompts, stdout.String())
				}
				pdf := readFile(t, path)
				if test.wantError != "" {
					if pdf != "original" || stdout.String() != prompt {
						t.Errorf("PDF = %q, output = %q; want the original PDF and only the prompt", pdf, stdout.String())
					}
				} else if !strings.Contains(pdf, command.content) {
					t.Errorf("PDF does not contain %q", command.content)
				}
				if entries, err := os.ReadDir(directory); err != nil || len(entries) != 1 {
					t.Errorf("output directory = %v, %v; want only the PDF", entries, err)
				}
			})
		}
	}
}

func TestDocumentCommandsConversionFailureKeepsExistingPDF(t *testing.T) {
	for _, command := range documentCommands {
		t.Run(command.name, func(t *testing.T) {
			directory := t.TempDir()
			args := append(command.setup(t), "--output-dir", directory, "--force")
			path := filepath.Join(directory, command.pdf)
			if err := os.WriteFile(path, []byte("original"), 0o644); err != nil {
				t.Fatal(err)
			}
			stubWeasyPrint(t, "printf 'partial'; exit 1")
			err := run(context.Background(), args, io.Discard, strings.NewReader(""), time.Now)
			if err == nil || !strings.Contains(err.Error(), "WeasyPrint") {
				t.Fatalf("error = %v, want WeasyPrint failure", err)
			}
			if pdf := readFile(t, path); pdf != "original" {
				t.Errorf("PDF = %q, want the original", pdf)
			}
			if entries, err := os.ReadDir(directory); err != nil || len(entries) != 1 {
				t.Errorf("output directory = %v, %v; want only the original PDF", entries, err)
			}
		})
	}
}

func TestRunGenerateResolvesIssueDateInConfiguredTimeZone(t *testing.T) {
	args, outputDirectory := setupGenerateTest(t)
	// Still June 9 in UTC, but already June 10 in the configured Europe/Berlin.
	fixedNow := time.Date(2026, time.June, 9, 22, 34, 56, 0, time.UTC)
	if err := run(context.Background(), args, io.Discard, strings.NewReader(""), func() time.Time { return fixedNow }); err != nil {
		t.Fatalf("run generate: %v", err)
	}
	if pdf := readFile(t, filepath.Join(outputDirectory, "Rechnung-2026-05.pdf")); !strings.Contains(pdf, ">10.06.2026<") {
		t.Errorf("invoice does not use the issue date in the configured timezone:\n%s", pdf)
	}
}

func TestRunGenerateUsesWorkingDirectoryDefaults(t *testing.T) {
	_, outputDirectory := setupGenerateTest(t)
	directory := t.TempDir()
	for _, file := range []struct{ source, destination string }{
		{"testdata/minimal-sessions.json", "sessions.json"},
		{"testdata/minimal-config.json", "config.json"},
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
	args := []string{"generate", "--month", "2026-05", "--number", "2026-05", "--output-dir", outputDirectory}
	if err := run(context.Background(), args, io.Discard, strings.NewReader(""), time.Now); err != nil {
		t.Fatal(err)
	}
	if pdf := readFile(t, filepath.Join(outputDirectory, "Rechnung-2026-05.pdf")); !strings.Contains(pdf, ">45,00 €<") {
		t.Fatalf("invoice generated from default files has unexpected totals: %s", pdf)
	}
}

func TestRunGenerateUsesConfiguredMonth(t *testing.T) {
	input, err := readSessionFile("testdata/minimal-sessions.json")
	if err != nil {
		t.Fatal(err)
	}
	may := input.Sessions[0]
	may.Student = "May Student"
	may.Activities = []Activity{{ID: "flight", Type: ActivityDual, Minutes: 60}}
	boundary := may
	boundary.ID, boundary.Student = "boundary", "Boundary Student"
	boundary.DutyStart = mustTimestamp(t, "2026-05-31T22:30:00Z")
	boundary.DutyEnd = boundary.DutyStart.Add(time.Hour)
	input.Sessions = []Session{may, boundary}
	contents, err := json.Marshal(input)
	if err != nil {
		t.Fatal(err)
	}
	inputPath := filepath.Join(t.TempDir(), "sessions.json")
	if err := os.WriteFile(inputPath, contents, 0o600); err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		month, student, other, date string
	}{
		{"2026-05", "May Student", "Boundary Student", "03.05.26"},
		{"2026-06", "Boundary Student", "May Student", "01.06.26"},
	} {
		t.Run(test.month, func(t *testing.T) {
			args, outputDirectory := setupGenerateTest(t)
			args = append(args, "--input", inputPath, "--month", test.month, "--issue-date", "2026-07-01")
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

func TestRunGenerateHelp(t *testing.T) {
	for _, argument := range []string{"-h", "--help"} {
		t.Run(argument, func(t *testing.T) {
			var stdout bytes.Buffer
			err := run(context.Background(), []string{"generate", argument}, &stdout, strings.NewReader(""), time.Now)
			if err != nil {
				t.Fatalf("run generate help: %v", err)
			}
			for _, text := range []string{
				"Usage: fitools generate --month YYYY-MM --number NUMBER [flags]",
				"-input", "-config", "-month", "-number", "-issue-date", "-output-dir", "-force",
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
	config, err := readConfig(filepath.Join("testdata", "minimal-config.json"))
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

func TestRunGenerateRejectsInvalidNumber(t *testing.T) {
	args, outputDirectory := setupGenerateTest(t)
	err := run(context.Background(), append(args, "--number", "2026/05"), io.Discard, strings.NewReader(""), time.Now)
	if err == nil || !strings.Contains(err.Error(), "invoice number") {
		t.Fatalf("error = %v, want invalid invoice number", err)
	}
	if entries, err := os.ReadDir(outputDirectory); err != nil || len(entries) != 0 {
		t.Fatalf("output directory = %v, %v; want it empty", entries, err)
	}
}
