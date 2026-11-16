# Flight Instructor Tools

A Go CLI that automates monthly invoicing and duty reports for my work as a flight instructor.

I built this to replace manual calculations and document preparation with a reproducible workflow. Session records and billing configuration serve as a single source of truth
for JSON snapshots, HTML invoices, and PDF documents.

Running `fitools` without arguments starts a local web server and opens the UI in
your browser. The React/TypeScript frontend in `web/` displays a read-only session
table backed by the existing Go model and validation. Editing, document generation,
and photo-assisted input will be added incrementally.

## Features

- Calculates preparation and block-time charges.
- Applies billing rates based on their effective dates.
- Generates invoices for a given month from HTML templates, with PDF conversion through WeasyPrint.
- Generates separate monthly duty reports using a private HTML template and an explicit reporting timezone.

<a href="invoice-screenshot.png">
    <img src="invoice-screenshot.png"
        alt="Example invoice generated from anonymized data"
        width="300">
</a>

## Getting Started

Building from source requires Go 1.26.5 or newer, Node.js 22.12 or newer,
[pnpm](https://pnpm.io/installation), and Make. The pnpm version is pinned in
`web/package.json` and used by CI:

```sh
make build
./fitools
```

The frontend is built first and embedded in the Go executable. The resulting
`fitools` binary can run from any directory without Node.js or frontend files.
The server binds to `127.0.0.1` on an available port and prints its URL; press
Ctrl+C in the terminal to stop it. Closing the browser tab does not stop the server.
If opening the browser fails, open the printed URL manually.
Requests must address `127.0.0.1` or `localhost`; other hostnames receive HTTP 403
to protect local session data from DNS rebinding.

For an explicit port or to keep the browser closed:

```sh
./fitools serve --port 8080 --no-open
```

### Session viewer and data paths

The viewer, invoice generation, and duty reports default to `sessions.json` and
`config.json` in the **current working directory**. Validation also defaults to
`sessions.json`. Paths are not resolved relative to the executable or searched for
in parent directories.

With private data in this repository's ignored `local/` directory, either launch
from that directory:

```sh
cd local
../fitools
```

Or supply paths from the repository root:

```sh
./fitools --input local/sessions.json --config local/config.json
```

The same `--input` and `--config` overrides work with `serve`, `generate`, and
`duty-report`. Validation accepts an optional positional path:
`fitools validate [FILE]`.

The table preserves file order, with one row per session and activity totals for
preparation, dual flying, and solo supervision. Click anywhere on a flight session
row, or use the caret button at the start of the row with the keyboard, to expand
its flights. Keyboard focus outlines the whole row. All rows start collapsed.
Expanded details use a compact table with Flight, Type, and Block columns,
without preparation entries or IDs. Preparation-only sessions do not expand.
Student and description are both shown when present. There are no
editing, sorting, filtering, or row-selection controls.
Reload the page to pick up file changes.

Dates and duty times use the configured `timeZone`, including daylight-saving
changes, with clock times shown as `HH:MM LT` for local time or `HH:MM Z` for UTC.
A session that crosses midnight also shows its end date. Activity durations use
`H:MM` and are not timezone-dependent. Flight clock timestamps are not recorded.
The active timezone is displayed below the table.

The viewer reads `config.json` automatically and uses UTC if that default file is
missing or `timeZone` is empty. An explicitly supplied `--config` file must exist.
Malformed configuration, invalid timezone names, and `Local` produce an error.
Only session viewing permits this UTC fallback; duty reports still require an
explicit timezone. Viewing does not require billing fields, a private template,
signatures, or WeasyPrint. Valid empty version-2 session files show an empty state;
unreadable or invalid files show an error with the relevant path or field.

Existing CLI commands remain available. PDF generation additionally requires
[WeasyPrint](https://doc.courtbouillon.org/weasyprint/stable/first_steps.html) on `PATH`;
the UI and session validation do not require it.

### Development

After `pnpm --dir web install --frozen-lockfile`, start Go and Vite together:

```sh
make dev
```

This builds the frontend once so Go can embed it, then serves the UI through Vite
at `http://127.0.0.1:5173` (or the next available port) with React hot reload and
opens the browser. The Go server runs at `http://127.0.0.1:8080`; Vite proxies
`/api` there for the sessions endpoint. The Go process reads data from the
repository root.
Port 8080 must be available. Ctrl+C stops both processes, and either process
exiting stops the other. Restart this command after Go changes.

To use private data in `local/` during development, run
`go run . serve --port 8080 --no-open --input local/sessions.json --config local/config.json`
and `pnpm --dir web exec vite --open` in separate terminals instead of `make dev`.
Stop each process with Ctrl+C in its terminal.

`pnpm --dir web run build` type-checks TypeScript and builds the production UI.
Run it before direct `go build`, `go run`, `go vet`, or `go test` commands on a fresh
checkout, since Go embeds the generated `web/dist/` directory. Rebuild the binary
after changing the frontend to update its embedded UI.

### Example

From the repository root, using the anonymized example data:

```sh
go run . generate \
    --input examples/realistic-sessions.json \
    --config examples/realistic-config.json \
    --month 2026-05 \
    --number 2026-05 \
    --issue-date 2026-06-09
```

Writes `Rechnung-2026-05.json`, `Rechnung-2026-05.html` and `Rechnung-2026-05.pdf` to `output/`.
Session files use schema version 2 with typed activities (`preparation`, `dual`, and `soloSupervision`). See [examples](examples/#session-format) for input details, version-1 migration instructions, and expected results. Keep private data and signature images in `local/`, which is ignored by Git.

### Validate sessions

Check a sessions file without generating invoice artifacts (WeasyPrint is not needed):

```sh
go run . validate examples/realistic-sessions.json
```

Omit the path to validate `sessions.json` in the current directory. Returns a
nonzero exit status if the file cannot be read or fails validation.

### Generate usage

| Flag                      | Purpose                           | Default            |
| ------------------------- | --------------------------------- | ------------------ |
| `--input FILE`            | Sessions file (JSON)              | `sessions.json`    |
| `--config FILE`           | Billing configuration file (JSON) | `config.json`      |
| `--month YYYY-MM`         | Billing month                     | Required           |
| `--number NUMBER`         | Invoice number                    | Required           |
| `--issue-date YYYY-MM-DD` | Invoice date of issue             | Today (local time) |
| `--output-dir DIR`        | Output directory                  | `output/`          |
| `--force`, `-f`           | Overwrite without confirmation    | `false`            |

If any output file already exists, generation asks once for confirmation to overwrite the invoice's output files. Only `y` (case-insensitive, with surrounding whitespace ignored) confirms; any other response or no input aborts without changing or creating invoice files. Use `--force` (or `-f`) to skip confirmation, including in scripts.

### Billing configuration

The `--config` JSON file contains issuer and customer details, bank and tax information, invoice text, and hourly rates with effective dates. See the [example configuration](examples/realistic-config.json).

Optional `signatureFile` adds a PNG signature; relative paths resolve from the config file's directory.

### Monthly duty reports

Duty reports are a separate command; they do not require an invoice number or alter billing:

```sh
go run . duty-report \
    --input local/sessions.json \
    --config local/config.json \
    --month 2026-05 \
    --carry-over-flight-duty 120:00
```

Writes `Dienstzeitnachweis-2026-05.json`, `.html`, and `.pdf` to `output/`. Uses the same `--output-dir`, `--force` / `-f`, and once-per-report overwrite confirmation as invoices. Optional `--issue-date YYYY-MM-DD` defaults to today in the reporting timezone.

Add these settings to the existing config:

```json
"dutyReportTemplateFile": "flight_duty_report.html.tmpl",
"timeZone": "Europe/Berlin",
"signatureFile": "signature.png"
```

`dutyReportTemplateFile` and an explicit IANA `timeZone` are required **only for duty reports**. There is no computer-timezone fallback; `Local` is rejected. Template and signature paths resolve from the config file's directory (absolute paths also work). A configured signature is automatically embedded; a missing, unreadable, or invalid PNG fails generation. Without `signatureFile`, the report is unsigned. Keep templates, configuration, sessions, signatures, and private verification output in ignored `local/`; the school's form is intentionally not distributed.

`--carry-over-flight-duty H:MM` is required, including `0:00` in January. Hours may exceed 24; minutes must be two digits from `00` to `59`. It is year-to-date flight-duty time **before** the requested month. Year total = this input + the current month's total, regardless of which other months are in the sessions file. There are no working-time or block-time carry-over inputs.

For each local day, working time and flight-duty time are the elapsed span from earliest duty start to latest duty end, including gaps. Personal block time includes only `dual` activities. Solo supervision contributes its duty interval, but not personal block time; invoicing still bills both flying activity types. Overlaps are allowed, and block time is neither capped nor deduplicated. Required rest-until is duty end plus 12 elapsed hours, shown as local time only (`HH:MM`), including when it falls on the next day. The JSON retains the full timestamp. Neutral time and rest-time cells stay blank.

Reports always contain 31 row slots. Non-working days have blank time cells; nonexistent dates have blank rows. Empty requested months (including an empty schema-version-2 sessions file) produce an empty report. Sessions crossing local midnight in or into the requested month fail with the session ID; this restriction does not apply to invoices. Invoice month selection still rejects empty months.

These calculations automate a reporting practice, not legal compliance. They do not certify limits, infer breaks, or include outside-school activity. Historical activities migrated from the old schema were classified as `dual`; correct solo-supervision classifications manually if needed. Review reports before use.

#### Private duty-report template

Use Go `html/template` syntax. The template receives these fields; it may omit any of them, and unsupported field references produce an error during rendering:

- `IssueDate` (time), `Month` (`YYYY-MM`), `TimeZone`, `Issuer` (the configured party).
- `Lines`: 31 calendar slots, each with `Day` (1–31 for existing dates, zero for nonexistent dates), `Start`, `End`, `DutyOffUntil` (local times, zero on non-working days), `DutyMinutes` (both working and flight-duty minutes), and `BlockMinutes` (personal block minutes).
- `Totals`: `CurrentMonth`, `CarryOver`, `CurrentYear` (flight-duty minutes), and `BlockMinutes` (current month only). The current month's working-time total also equals `CurrentMonth`. The private school form displays summaries only in the flight-duty column; its working/block summary cells remain blank.
- `SignatureBase64`: PNG image data, empty when no signature is configured. Embed as `<img src="data:image/png;base64,{{.SignatureBase64}}">`, guarded by `{{if .SignatureBase64}}`.

Helpers: `formatDuration` (minutes to `H:MM`), `formatTime` and `formatRestUntil` (`HH:MM`, blank for zero), `formatLongDate` (`DD.MM.YYYY`), and `formatMonth` (`YYYY-MM` to a German month name, for example `September`). Guard durations with `{{if not .Start.IsZero}}` so non-working days stay blank. Iterate with `{{range .Lines}}`; use `{{if .Day}}{{printf "%02d." .Day}}{{end}}` for calendar labels. The independently written [test template](testdata/duty-report.html.tmpl) is a minimal example, not the school's document.

Template parsing, rendering, and signature loading happen before output is written. Duty-report PDF conversion is staged so a renderer failure leaves existing reports intact.

### Tests

```sh
pnpm --dir web install --frozen-lockfile
pnpm --dir web run build
pnpm --dir web test
go test .
```

## Limitations

Currently this is tailored to my own workflow: EUR invoices, German formatting, and 0% VAT. Matching activities are combined within a session, but not across sessions. Review generated invoices before sending them.

## License

Licensed under the [MIT License](LICENSE.md).
