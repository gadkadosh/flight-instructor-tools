# Flight Instructor Invoice CLI — Implementation Plan

## Purpose

Build a small command-line application that generates monthly flight-instruction invoices from structured session data.

The application will:

1. Read and validate session and configuration JSON.
2. Select sessions for an invoice period.
3. Convert sessions and flights into billable activities.
4. Render an HTML invoice from a template.
5. Convert the HTML to PDF and retain a JSON snapshot, HTML document, and PDF as invoice artifacts.

The initial implementation targets one issuer, one flight school, EUR, German formatting, and the current flight-instruction billing model.

## Scope

### In scope

- Nested sessions containing zero or more individual flights
- Session-level flight preparation time
- Flight-level block time
- Training sessions identified by student
- Other flights identified by a free-form description, such as `Rundflug 45°`
- Ground/preparation-only sessions represented by an empty flights array
- Effective-dated preparation and block-time rates
- Explicit invoice number
- Invoice issue date defaulting to the local current date, with an explicit override
- Monthly selection, with a later path for selecting individual sessions
- Grouping by date, subject, activity type, and rate
- Commercial half-up rounding per invoice line
- Zero-percent VAT and the current §19 UStG statement
- HTML, PDF, and JSON snapshot output
- Refusal to overwrite an existing invoice unless explicitly requested

### Out of scope for the first version

- Populating or editing the session JSON
- Multiple customers or issuer profiles
- Programming and musician invoice inputs
- A plugin architecture or universal invoice-input schema
- General accounting or invoice-number allocation
- Sending invoices by email
- Tracking payments
- Credit notes and invoice corrections
- Deciding the applicable legal or tax treatment

## Decisions

### Implementation stack

- Go
- Go standard library wherever practical
- `encoding/json` with explicit semantic validation
- `html/template` for context-aware HTML escaping
- HTML and CSS for document layout
- WeasyPrint CLI as the initial PDF renderer
- Go's built-in `testing` package
- No Go application dependencies initially

### Rendering boundary

HTML generation and PDF conversion are separate internal stages:

```text
Invoice model → HTML file → PDF renderer
```

The CLI will normally orchestrate both stages. The HTML is retained as an invoice artifact rather than treated as a temporary file.

If WeasyPrint is unsuitable, possible replacements include headless Chromium, a Playwright subprocess/CLI, or another HTML-to-PDF executable. Billing and HTML generation must not depend on WeasyPrint-specific application code.

### Domain boundary

Flight data describes what happened. Pricing describes how work is charged. The generated invoice snapshot records what was billed.

```text
Sessions → Billable activities → Invoice lines → Invoice document
```

Invoice grouping is independent of session boundaries.

### Future invoice types

The flight-specific builder will produce a modest general invoice document model before rendering. This is useful for testing and separation of concerns. No plugin system or generalized input framework will be built now.

If programming or musician invoices are added later, their concrete requirements will determine which code is genuinely reusable.

## Provisional input model

### Sessions

```json
{
  "schemaVersion": 1,
  "sessions": [
    {
      "id": "2026-05-03-example-1",
      "date": "2026-05-03",
      "student": "Alex Beispiel",
      "preparationMinutes": 30,
      "flights": [
        {
          "id": "flight-1",
          "blockMinutes": 65
        },
        {
          "id": "flight-2",
          "blockMinutes": 70
        }
      ]
    },
    {
      "id": "2026-05-24-sightseeing-1",
      "date": "2026-05-24",
      "description": "Rundflug 45°",
      "flights": [
        {
          "id": "flight-3",
          "blockMinutes": 45
        }
      ]
    },
    {
      "id": "2026-05-31-ground-1",
      "date": "2026-05-31",
      "student": "Max Mustermann",
      "preparationMinutes": 45,
      "flights": []
    }
  ]
}
```

### Session validation rules

- `schemaVersion` must be supported.
- IDs must be non-empty and unique in their relevant scope.
- Dates must use the strict `YYYY-MM-DD` format and represent real calendar dates.
- A session must contain at least one of `student` or `description`.
- `preparationMinutes`, when present, must be a positive integer.
- `blockMinutes` must be a positive integer.
- A session must contain preparation time or at least one flight.
- Unknown JSON fields should be rejected to catch input mistakes.
- Absent durations should be omitted rather than represented as zero.

### Configuration

The configuration will contain:

- Issuer name, address, email, tax number, and bank details
- Customer name and address
- Currency (`EUR` initially)
- VAT rate and statement
- Effective-dated preparation and block rates
- Static payment and closing text used by the current invoice

Provisional rate representation:

```json
{
  "currency": "EUR",
  "rates": [
    {
      "effectiveFrom": "2026-01-01",
      "preparationCentsPerHour": 2500,
      "blockCentsPerHour": 3000
    }
  ]
}
```

The applicable rate is the latest rate whose `effectiveFrom` date is on or before the session date.

## Billing rules

Each session produces zero or one preparation activity and one block activity per flight.

Activities are grouped by:

```text
date + student/description + activity type + hourly rate
```

Therefore, multiple flights or sessions for the same student, date, activity, and rate produce one invoice line. A rate change prevents otherwise similar activities from being combined.

Suggested descriptions:

- Student preparation: `Max Mustermann – Flugvorbereitung`
- Student block time: `Max Mustermann – Blockzeit`
- Free-form flight description: shown verbatim, for example `Rundflug 45°`

Durations are stored and calculated as integer minutes and displayed as `H:MM`.

Money is stored as integer cents. Each grouped line is calculated and rounded independently:

```text
line amount = round-half-up(total minutes × hourly rate in cents ÷ 60)
```

Only rounded line amounts are summed into the invoice subtotal. At the initial 0% VAT rate, VAT is zero and the gross total equals the net total.

## Provisional CLI

```sh
invoice generate \
  --input sessions.json \
  --config invoice-config.json \
  --month 2026-05 \
  --number 2026-05
```

Optional arguments:

```sh
--issue-date 2026-06-09
--output-dir output
--force
```

If `--issue-date` is omitted, the local current date is resolved once and recorded in the snapshot.

Expected artifacts:

```text
output/Rechnung-2026-05.json
output/Rechnung-2026-05.html
output/Rechnung-2026-05.pdf
```

Output filenames must sanitize invoice numbers without altering the invoice number displayed in the document.

## Implementation slices

Each slice crosses the relevant application layers and ends with something runnable or directly inspectable. Later slices deepen correctness and resilience without replacing the path established by the first working slice.

### Slice 1 — Prove the rendering path

Use hardcoded invoice data to test the largest technical uncertainty before building the application around it.

- [x] Initialize the Go module and a minimal executable.
- [x] Represent the supplied example invoice as hardcoded Go data.
- [x] Recreate the supplied invoice using `html/template` and CSS.
- [x] Write a standalone HTML artifact.
- [x] Locate and invoke WeasyPrint without shell interpolation.
- [x] Report a useful error when WeasyPrint is unavailable.
- [x] Generate an A4 PDF and compare it visually with `example.pdf`.
- [x] Confirm that fonts, table alignment, footer placement, and print backgrounds are reliable.

**Runnable check:** one command generates inspectable HTML and PDF for the hardcoded reference invoice.

**Exit criterion:** the hardcoded example produces acceptable HTML and PDF, or a concrete renderer limitation has been identified and a renderer replacement chosen.

### Slice 2 — Build the minimal end-to-end invoice

Replace hardcoded values with the thinnest complete path for one valid training session and one applicable rate. Favor a sound path over broad feature coverage.

- [x] Add minimal session and configuration Go structs.
- [x] Read a valid session file and configuration file from JSON.
- [x] Perform the basic validation needed to trust the supported fields.
- [x] Select one session in the requested month.
- [x] Calculate preparation and block lines using integer minutes and cents.
- [x] Define the renderer-facing invoice model.
- [x] Render the calculated model through the existing template.
- [x] Write a minimal deterministic JSON snapshot.
- [x] Add the `generate` command with input, config, month, number, issue-date, and output arguments.
- [x] Default an omitted issue date to the local current date and record the resolved value.
- [x] Generate the JSON, HTML, and PDF artifacts from the CLI.
- [x] Add focused tests for the first calculation and command path.

**Runnable check:** a small valid JSON fixture passes through the real CLI and produces all three artifacts with the expected lines and total.

**Exit criterion:** the application has a complete `JSON → calculation → snapshot/HTML → PDF` path, even though it supports only the simplest valid invoice.

### Slice 3 — Reproduce the reference invoice

Deepen the working path until representative session data reproduces the supplied invoice.

- [ ] Support multiple sessions and multiple flights per session.
- [ ] Support preparation-only sessions with an empty flights array.
- [ ] Support student names and free-form descriptions.
- [ ] Resolve effective-dated preparation and block rates.
- [ ] Convert sessions into billable activities.
- [ ] Group by date, subject, activity type, and rate across session boundaries.
- [ ] Sort invoice lines deterministically.
- [ ] Implement exact positive-integer half-up rounding per line.
- [ ] Calculate net, VAT, and gross totals.
- [ ] Record selected session IDs, applied rates, lines, and totals in the snapshot.
- [ ] Add representative input files based on the supplied invoice.
- [ ] Add table-driven tests for rate selection, grouping, rounding, and totals.

**Runnable check:** representative JSON generates an invoice with the reference line structure and a total of €485.00.

**Exit criterion:** no invoice-specific values are hardcoded in the template, and the generated HTML/PDF is an acceptable reproduction of `example.pdf`.

### Slice 4 — Fail safely and explain input problems

Make the already-working invoice path dependable when inputs, output state, or external tools are wrong.

- [ ] Reject unknown JSON fields and trailing JSON values.
- [ ] Implement strict calendar-date parsing and month validation.
- [ ] Enforce all session and configuration domain rules.
- [ ] Detect duplicate session and flight IDs.
- [ ] Report missing applicable rates clearly.
- [ ] Include useful JSON paths or identifiers in validation errors.
- [ ] Sanitize output filenames without changing the displayed invoice number.
- [ ] Refuse to overwrite any existing artifact unless `--force` is supplied.
- [ ] Preserve completed snapshot and HTML artifacts if PDF conversion fails.
- [ ] Return useful non-zero exit codes.
- [ ] Add table-driven invalid-input tests and command-level failure tests.

**Runnable check:** invalid fixtures and simulated renderer failures produce actionable errors, no silent overwrite, and no misleading successful invoice.

**Exit criterion:** likely user mistakes and operational failures are handled predictably without corrupting existing artifacts.

### Slice 5 — Make the document robust

Exercise the same end-to-end command with content that stresses document rendering and formatting.

- [ ] Preserve automatic HTML escaping for all input-derived text.
- [ ] Format dates, durations, and money using fixed German invoice conventions.
- [ ] Verify German characters and hostile HTML-like descriptions.
- [ ] Decide whether to embed CSS so HTML artifacts are self-contained.
- [ ] Add a long fixture that spans multiple pages.
- [ ] Verify repeated table headings, page breaks, totals, and footer placement.
- [ ] Refine fonts, spacing, and alignment against the supplied PDF.
- [ ] Keep PDF generation as a smoke/visual test rather than a byte comparison.

**Runnable check:** both short and multi-page fixtures generate readable snapshots, HTML, and PDFs through the normal CLI.

**Exit criterion:** realistic short and long invoices render correctly, safely, and consistently.

### Slice 6 — Make the tool operationally complete

Finish the workflow needed to use and maintain the application month after month.

- [ ] Print a concise generation summary with selected sessions, invoice number, issue date, and totals.
- [ ] Finalize artifact naming and output-directory behavior.
- [ ] Add a snapshot schema version if it is useful for future interpretation or regeneration.
- [ ] Add a README with installation, WeasyPrint setup, input examples, and CLI usage.
- [ ] Document invoice-number and issue-date behavior.
- [ ] Document grouping, rate selection, and rounding rules.
- [ ] Document how to preview HTML and rerun PDF generation.
- [ ] Run all tests and perform one final visual comparison against the reference.

**Runnable check:** follow the README from a clean checkout to generate the example artifacts.

**Exit criterion:** a future user—or the author after several months—can install and use the tool from the repository documentation alone.

## Test strategy

Prioritize behavior that could change billed amounts or produce an invalid document:

- JSON type, required-field, unknown-field, and semantic validation
- Strict dates and month boundaries
- Duplicate IDs
- Effective-date rate selection
- Grouping across flights and sessions
- Separation by date, subject, activity, and rate
- Per-line half-up rounding
- Total calculations
- German duration, date, and currency formatting
- HTML escaping of names and descriptions
- Overwrite protection
- PDF renderer failure behavior

Do not rely on byte-for-byte PDF comparison because PDF metadata and renderer output may vary. Test calculations and the invoice model directly, use targeted HTML assertions, and keep PDF generation as a smoke/visual test.

## Open questions

These do not block the rendering spike:

- Exact font family and final CSS measurements
- Whether CSS should be embedded to make each HTML artifact self-contained
- Exact CLI syntax for selecting a subset of sessions when creating multiple invoices for one month
- Whether exceptional per-session or per-flight rate overrides are needed
- Whether a free-form session with preparation should append `– Flugvorbereitung` automatically
- Final output naming convention

## Plan maintenance

This is a living plan. Check off completed items, record material changes in the Decisions section, and update later slices when implementation reveals concrete constraints. Avoid expanding the scope merely to anticipate other professions; revisit generalization when a second invoice type has real requirements.
