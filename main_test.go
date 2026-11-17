package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"testing"
	"testing/iotest"
	"time"
)

func setupGenerateTest(t *testing.T) (args []string, outputDir string) {
	t.Helper()

	if runtime.GOOS == "windows" {
		t.Skip("test uses a POSIX test executable")
	}

	binDirectory := t.TempDir()
	fakeRenderer := filepath.Join(binDirectory, weasyPrintExecutable)
	if err := os.WriteFile(fakeRenderer, []byte("#!/bin/sh\nprintf 'pdf' > \"$2\"\n"), 0o755); err != nil {
		t.Fatalf("write fake WeasyPrint: %v", err)
	}
	t.Setenv("PATH", binDirectory)

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

func TestRunGenerateWritesAllArtifactsAndResolvesIssueDate(t *testing.T) {
	args, outputDirectory := setupGenerateTest(t)

	var stdout bytes.Buffer
	fixedNow := time.Date(2026, time.June, 9, 12, 34, 56, 0, time.UTC)
	err := run(context.Background(), args, &stdout, strings.NewReader(""), func() time.Time { return fixedNow })
	if err != nil {
		t.Fatalf("run generate: %v", err)
	}

	for _, extension := range []string{"json", "html", "pdf"} {
		path := filepath.Join(outputDirectory, "Rechnung-2026-05."+extension)
		if _, err := os.Stat(path); err != nil {
			t.Errorf("stat %s artifact: %v", extension, err)
		}
		if !strings.Contains(stdout.String(), path) {
			t.Errorf("command output does not contain artifact path %q", path)
		}
	}

	snapshotPath := filepath.Join(outputDirectory, "Rechnung-2026-05.json")
	snapshot, err := os.ReadFile(snapshotPath)
	if err != nil {
		t.Fatalf("read generated snapshot: %v", err)
	}
	resolvedDate := fixedNow.In(time.Local).Format("2006-01-02")
	if expected := fmt.Sprintf(`"issueDate": %q`, resolvedDate); !bytes.Contains(snapshot, []byte(expected)) {
		t.Errorf("snapshot does not contain resolved local issue date %q:\n%s", resolvedDate, snapshot)
	}
	if !bytes.Contains(snapshot, []byte(`"grossCents": 4500`)) {
		t.Errorf("snapshot does not contain expected total:\n%s", snapshot)
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
	snapshot, err := os.ReadFile(filepath.Join(outputDirectory, "Rechnung-2026-05.json"))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(snapshot, []byte(`"grossCents": 4500`)) {
		t.Fatalf("invoice generated from default files has unexpected totals: %s", snapshot)
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
	config, err := readConfig("testdata/minimal-config.json")
	if err != nil {
		t.Fatal(err)
	}
	config.TimeZone = "Europe/Berlin"
	directory := t.TempDir()
	inputPath, configPath := filepath.Join(directory, "sessions.json"), filepath.Join(directory, "config.json")
	for _, file := range []struct {
		path  string
		value any
	}{{inputPath, input}, {configPath, config}} {
		contents, err := json.Marshal(file.value)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(file.path, contents, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	for _, test := range []struct {
		month, student, date string
	}{
		{"2026-05", "May Student", "2026-05-03"},
		{"2026-06", "Boundary Student", "2026-06-01"},
	} {
		t.Run(test.month, func(t *testing.T) {
			args, outputDirectory := setupGenerateTest(t)
			args = append(args, "--input", inputPath, "--config", configPath, "--month", test.month, "--issue-date", "2026-07-01")
			if err := run(context.Background(), args, io.Discard, strings.NewReader(""), time.Now); err != nil {
				t.Fatal(err)
			}
			var snapshot invoiceSnapshot
			if err := readJSONFile(filepath.Join(outputDirectory, "Rechnung-2026-05.json"), &snapshot); err != nil {
				t.Fatal(err)
			}
			if len(snapshot.Lines) != 1 {
				t.Fatalf("lines = %+v, want only %s", snapshot.Lines, test.student)
			}
			line := snapshot.Lines[0]
			if line.Description != test.student+" - Blockzeit" || line.Date != test.date || snapshot.Totals.GrossCents != 3000 {
				t.Fatalf("line = %+v, gross = %d; want %s on %s for 3000", line, snapshot.Totals.GrossCents, test.student, test.date)
			}
		})
	}
}

func TestRunGenerateSignature(t *testing.T) {
	signaturePath := filepath.Join(t.TempDir(), "signature.png")
	if err := os.WriteFile(signaturePath, []byte("signature"), 0o644); err != nil {
		t.Fatalf("write signature: %v", err)
	}
	fixture, err := os.ReadFile(filepath.Join("testdata", "minimal-config.json"))
	if err != nil {
		t.Fatalf("read config fixture: %v", err)
	}

	for _, test := range []struct {
		name              string
		signatureFileJSON string
		wantSignature     bool
		wantError         bool
	}{
		{name: "omitted"},
		{name: "empty", signatureFileJSON: `""`},
		{name: "absolute path", signatureFileJSON: fmt.Sprintf("%q", signaturePath), wantSignature: true},
		{name: "relative path", signatureFileJSON: `"signature.png"`, wantSignature: true},
		{name: "missing file", signatureFileJSON: `"missing.png"`, wantError: true},
		{name: "directory instead of file", signatureFileJSON: `"."`, wantError: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			args, outputDirectory := setupGenerateTest(t)
			configDirectory := t.TempDir()
			if err := os.WriteFile(filepath.Join(configDirectory, "signature.png"), []byte("signature"), 0o644); err != nil {
				t.Fatalf("write relative signature: %v", err)
			}
			var config map[string]json.RawMessage
			if err := json.Unmarshal(fixture, &config); err != nil {
				t.Fatalf("decode config fixture: %v", err)
			}
			if test.signatureFileJSON != "" {
				config["signatureFile"] = json.RawMessage(test.signatureFileJSON)
			}
			contents, err := json.Marshal(config)
			if err != nil {
				t.Fatalf("encode config: %v", err)
			}
			configPath := filepath.Join(configDirectory, "config.json")
			if err := os.WriteFile(configPath, contents, 0o644); err != nil {
				t.Fatalf("write config: %v", err)
			}
			args = append(args, "--config", configPath)

			var stdout bytes.Buffer
			err = run(context.Background(), args, &stdout, strings.NewReader(""), time.Now)
			if test.wantError {
				if err == nil || !strings.Contains(err.Error(), "read signature") || !strings.Contains(err.Error(), configDirectory) {
					t.Fatalf("error = %v, want signature read error with resolved path", err)
				}
				entries, err := os.ReadDir(outputDirectory)
				if err != nil {
					t.Fatalf("read output directory: %v", err)
				}
				if len(entries) != 0 {
					t.Errorf("generated artifacts despite signature error: %v", entries)
				}
				return
			}
			if err != nil {
				t.Fatalf("run generate: %v", err)
			}
			html, err := os.ReadFile(filepath.Join(outputDirectory, "Rechnung-2026-05.html"))
			if err != nil {
				t.Fatalf("read generated HTML: %v", err)
			}
			if !bytes.Contains(html, []byte("Rechnung Nr. 2026-05")) {
				t.Error("generated HTML does not contain invoice number")
			}
			if got := bytes.Contains(html, []byte(`class="signature"`)); got != test.wantSignature {
				t.Errorf("signature image present = %v, want %v", got, test.wantSignature)
			}
			if test.wantSignature && !bytes.Contains(html, []byte(`src="data:image/png;base64,c2lnbmF0dXJl"`)) {
				t.Error("generated HTML does not embed the supplied signature")
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

func TestRunGenerateOverwrite(t *testing.T) {
	for _, test := range []struct {
		name      string
		existing  []string
		input     string
		inputErr  bool
		force     string
		wantError string
	}{
		{name: "no existing outputs"},
		{name: "existing JSON", existing: []string{"json"}, input: "y\n"},
		{name: "existing HTML", existing: []string{"html"}, input: "y\n"},
		{name: "existing PDF", existing: []string{"pdf"}, input: "y\n"},
		{name: "one confirmation for all outputs", existing: []string{"json", "html", "pdf"}, input: "y\n"},
		{name: "case and whitespace", existing: []string{"json", "html", "pdf"}, input: " Y \n"},
		{name: "decline", existing: []string{"json", "html", "pdf"}, input: "n\n", wantError: "aborting: overwrite not confirmed"},
		{name: "blank response", existing: []string{"json"}, input: "\n", wantError: "aborting: overwrite not confirmed"},
		{name: "other response", existing: []string{"html"}, input: "yes\n", wantError: "aborting: overwrite not confirmed"},
		{name: "EOF", existing: []string{"pdf"}, wantError: "aborting: no confirmation received"},
		{name: "input read error", existing: []string{"html"}, inputErr: true, wantError: "read overwrite confirmation: input failed"},
		{name: "force overwrite", existing: []string{"json", "html", "pdf"}, input: "n\n", force: "--force"},
		{name: "force shorthand", existing: []string{"json", "html", "pdf"}, input: "n\n", force: "-f"},
	} {
		t.Run(test.name, func(t *testing.T) {
			args, outputDirectory := setupGenerateTest(t)
			for _, extension := range test.existing {
				path := filepath.Join(outputDirectory, "Rechnung-2026-05."+extension)
				if err := os.WriteFile(path, []byte("original "+extension), 0o644); err != nil {
					t.Fatalf("write existing artifact: %v", err)
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
					t.Errorf("error = %v, want %q", err, test.wantError)
				}
			} else if err != nil {
				t.Fatalf("generate: %v", err)
			}
			prompt := "Invoice 2026-05 has existing output files. Overwrite? [y/N] "
			wantPrompts := 0
			if len(test.existing) != 0 && test.force == "" {
				wantPrompts = 1
			}
			if got := strings.Count(stdout.String(), prompt); got != wantPrompts {
				t.Errorf("invoice prompts = %d, want %d; output: %q", got, wantPrompts, stdout.String())
			}
			if test.wantError != "" && stdout.String() != prompt {
				t.Errorf("unexpected output on refusal: %q", stdout.String())
			}

			for _, artifact := range []struct {
				extension string
				marker    string
			}{
				{"json", `"grossCents": 4500`},
				{"html", "Rechnung Nr. 2026-05"},
				{"pdf", "pdf"},
			} {
				path := filepath.Join(outputDirectory, "Rechnung-2026-05."+artifact.extension)
				content, err := os.ReadFile(path)
				if test.wantError != "" && !slices.Contains(test.existing, artifact.extension) {
					if !os.IsNotExist(err) {
						t.Errorf("%s should not be created; read error = %v", artifact.extension, err)
					}
					continue
				}
				if err != nil {
					t.Fatalf("read artifact: %v", err)
				}
				if test.wantError != "" {
					if string(content) != "original "+artifact.extension {
						t.Errorf("%s changed despite refusing overwrite", artifact.extension)
					}
				} else if !bytes.Contains(content, []byte(artifact.marker)) {
					t.Errorf("%s does not contain generated content %q", artifact.extension, artifact.marker)
				}
			}
		})
	}
}

func TestResolveExplicitIssueDateDoesNotReadClock(t *testing.T) {
	clockRead := false
	date, err := resolveIssueDate("2026-06-10", func() time.Time {
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
