package main

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestRenderMinimalInvoiceSnapshot(t *testing.T) {
	document := buildMinimalDocumentForSnapshotTest(t)

	var output bytes.Buffer
	if err := renderInvoiceSnapshot(&output, document); err != nil {
		t.Fatalf("render invoice snapshot: %v", err)
	}

	expected, err := os.ReadFile(filepath.Join("testdata", "minimal-snapshot.json"))
	if err != nil {
		t.Fatalf("read expected snapshot: %v", err)
	}
	if !bytes.Equal(output.Bytes(), expected) {
		t.Errorf("rendered snapshot does not match testdata/minimal-snapshot.json\ngot:\n%s", output.Bytes())
	}
}

func buildMinimalDocumentForSnapshotTest(t *testing.T) Document {
	t.Helper()

	input, err := readSessionFile(filepath.Join("testdata", "minimal-sessions.json"))
	if err != nil {
		t.Fatalf("read sessions: %v", err)
	}
	config, err := readConfig(filepath.Join("testdata", "minimal-config.json"))
	if err != nil {
		t.Fatalf("read config: %v", err)
	}
	issueDate := time.Date(2026, time.June, 9, 0, 0, 0, 0, time.Local)

	sessions, err := selectSessions(input.Sessions, "2026-05")
	if err != nil {
		t.Fatalf("select sessions: %v", err)
	}

	document, err := buildInvoiceDocument(sessions, config, "2026-05", issueDate)
	if err != nil {
		t.Fatalf("build invoice document: %v", err)
	}
	return document
}
