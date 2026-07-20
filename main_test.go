package main

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestRunGenerateWritesAllArtifactsAndResolvesIssueDate(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("test uses a POSIX test executable")
	}

	binDirectory := t.TempDir()
	fakeRenderer := filepath.Join(binDirectory, weasyPrintExecutable)
	if err := os.WriteFile(fakeRenderer, []byte("#!/bin/sh\nprintf 'pdf' > \"$2\"\n"), 0o755); err != nil {
		t.Fatalf("write fake WeasyPrint: %v", err)
	}
	t.Setenv("PATH", binDirectory)

	signaturePath := filepath.Join(t.TempDir(), "signature.png")
	if err := os.WriteFile(signaturePath, []byte("signature"), 0o644); err != nil {
		t.Fatalf("write signature: %v", err)
	}
	outputDirectory := t.TempDir()
	fixedNow := time.Date(2026, time.June, 9, 12, 34, 56, 0, time.UTC)
	var stdout bytes.Buffer

	err := run(context.Background(), []string{
		"generate",
		"--input", filepath.Join("testdata", "minimal-sessions.json"),
		"--config", filepath.Join("testdata", "minimal-config.json"),
		"--month", "2026-05",
		"--number", "2026-05",
		"--output-dir", outputDirectory,
		"--signature", signaturePath,
	}, &stdout, func() time.Time { return fixedNow })
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

func TestRunRequiresGenerateCommand(t *testing.T) {
	err := run(context.Background(), nil, &bytes.Buffer{}, time.Now)
	if err == nil {
		t.Fatal("run unexpectedly succeeded")
	}
	if !strings.Contains(err.Error(), "invoice generate") {
		t.Fatalf("error %q does not contain command usage", err)
	}
}
