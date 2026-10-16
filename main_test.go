package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"testing"
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
	err := run(context.Background(), args, &stdout, func() time.Time { return fixedNow })
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
			err = run(context.Background(), args, &stdout, time.Now)
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
			err := run(context.Background(), []string{"generate", argument}, &stdout, time.Now)
			if err != nil {
				t.Fatalf("run generate help: %v", err)
			}
			for _, text := range []string{
				"Usage: fitools generate --input FILE --config FILE --month YYYY-MM --number NUMBER [flags]",
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
		name     string
		existing []string
		force    string
	}{
		{name: "existing JSON", existing: []string{"json"}},
		{name: "existing HTML", existing: []string{"html"}},
		{name: "existing PDF", existing: []string{"pdf"}},
		{name: "all existing", existing: []string{"json", "html", "pdf"}},
		{name: "force overwrite", existing: []string{"json", "html", "pdf"}, force: "--force"},
		{name: "force shorthand", existing: []string{"json", "html", "pdf"}, force: "-f"},
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

			var stdout bytes.Buffer
			err := run(context.Background(), args, &stdout, time.Now)
			if test.force == "" {
				path := filepath.Join(outputDirectory, "Rechnung-2026-05."+test.existing[0])
				want := fmt.Sprintf("output file %q already exists; use --force to overwrite", path)
				if err == nil || err.Error() != want {
					t.Errorf("error = %v, want %q", err, want)
				}
				if stdout.Len() != 0 {
					t.Errorf("unexpected output when refusing overwrite: %q", stdout.String())
				}
			} else if err != nil {
				t.Fatalf("force overwrite: %v", err)
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
				if test.force == "" && !slices.Contains(test.existing, artifact.extension) {
					if !os.IsNotExist(err) {
						t.Errorf("%s should not be created; read error = %v", artifact.extension, err)
					}
					continue
				}
				if err != nil {
					t.Fatalf("read artifact: %v", err)
				}
				if test.force == "" {
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

func TestRunRequiresCommand(t *testing.T) {
	var stdout bytes.Buffer
	err := run(context.Background(), nil, &stdout, time.Now)
	if err == nil || !strings.Contains(err.Error(), "must provide a command") {
		t.Fatalf("error = %v, want missing command error", err)
	}
	if !strings.Contains(stdout.String(), "Usage: fitools <command>") {
		t.Fatalf("output %q does not contain command usage", stdout.String())
	}
}
