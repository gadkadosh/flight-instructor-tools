package main

import "testing"

func TestReferenceDocumentLinesMatchNetTotal(t *testing.T) {
	document := ReferenceDocument()

	var total int
	for _, line := range document.Lines {
		total += line.TotalCents
	}

	if total != document.Totals.NetCents {
		t.Fatalf("line total = %d cents, net total = %d cents", total, document.Totals.NetCents)
	}
}
