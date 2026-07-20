package main

import (
	"fmt"
	"os"
	"path/filepath"
)

const (
	referenceOutputDirectory = "output"
	referenceSignaturePath   = "signature.png"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "invoice: %v\n", err)
		os.Exit(1)
	}
}

func run() error {
	if err := os.MkdirAll(referenceOutputDirectory, 0o755); err != nil {
		return fmt.Errorf("create output directory: %w", err)
	}

	signaturePNG, err := os.ReadFile(referenceSignaturePath)
	if err != nil {
		return fmt.Errorf("read signature: %w", err)
	}

	path := filepath.Join(referenceOutputDirectory, "Rechnung-2026-05.html")
	if err := writeInvoiceHTML(path, ReferenceDocument(), signaturePNG); err != nil {
		return err
	}

	fmt.Printf("Wrote %s\n", path)
	return nil
}
