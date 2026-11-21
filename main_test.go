package main

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/iotest"
	"time"
)

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
