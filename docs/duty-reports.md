# Duty reports

Duty reports are available through **Generate duty report** in the session viewer
and through a separate CLI command. Both include every session in the requested
month; the viewer's session selection only affects invoices. Reports do not require
an invoice number or alter billing. The viewer downloads a PDF without retaining
artifacts; the CLI also writes HTML and JSON:

```sh
./fitools duty-report \
    --input local/sessions.json \
    --config local/config.json \
    --month 2026-05 \
    --carry-over-flight-duty 120:00
```

Writes `Dienstzeitnachweis-2026-05.json`, `.html`, and `.pdf` to `output/`. Uses the same `--output-dir`, `--force` / `-f`, and once-per-report overwrite confirmation as invoices. Optional `--issue-date YYYY-MM-DD` defaults to today in the reporting timezone.

Add these settings to the existing config:

```json
{
  "dutyReportTemplateFile": "flight_duty_report.html.tmpl",
  "timeZone": "Europe/Berlin",
  "signatureFile": "signature.png"
}
```

`dutyReportTemplateFile` and an explicit IANA `timeZone` are required **only for duty reports**. There is no computer-timezone fallback; `Local` is rejected. Template and signature paths resolve from the config file's directory (absolute paths also work). A configured signature is automatically embedded; a missing, unreadable, or invalid PNG fails generation. Without `signatureFile`, the report is unsigned. Keep templates, configuration, sessions, signatures, and private verification output in ignored `local/`; the school's form is intentionally not distributed.

`--carry-over-flight-duty H:MM` is required, including `0:00` in January. Hours may exceed 24; minutes must be two digits from `00` to `59`. It is year-to-date flight-duty time **before** the requested month. Year total = this input + the current month's total, regardless of which other months are in the sessions file. There are no working-time or block-time carry-over inputs.

For each local day, working time and flight-duty time are the elapsed span from earliest duty start to latest duty end, including gaps. Personal block time includes only `dual` activities. Solo supervision contributes its duty interval, but not personal block time; invoicing still bills both flying activity types. Overlaps are allowed, and block time is neither capped nor deduplicated. Required rest-until is duty end plus 12 elapsed hours, shown as local time only (`HH:MM`), including when it falls on the next day. The JSON retains the full timestamp. Neutral time and rest-time cells stay blank.

Reports always contain 31 row slots. Non-working days have blank time cells; nonexistent dates have blank rows. Empty requested months (including an empty schema-version-2 sessions file) produce an empty report. Sessions crossing local midnight in or into the requested month fail with the session ID; this restriction does not apply to invoices. Invoice month selection still rejects empty months.

These calculations automate a reporting practice, not legal compliance. They do not certify limits, infer breaks, or include outside-school activity. Historical activities migrated from the old schema were classified as `dual`; correct solo-supervision classifications manually if needed. Review reports before use.

## Private template

Use Go `html/template` syntax. The template receives these fields; it may omit any of them, and unsupported field references produce an error during rendering:

- `IssueDate` (time), `Month` (`YYYY-MM`), `TimeZone`, `Issuer` (the configured party).
- `Lines`: 31 calendar slots, each with `Day` (1–31 for existing dates, zero for nonexistent dates), `Start`, `End`, `DutyOffUntil` (local times, zero on non-working days), `DutyMinutes` (both working and flight-duty minutes), and `BlockMinutes` (personal block minutes).
- `Totals`: `CurrentMonth`, `CarryOver`, `CurrentYear` (flight-duty minutes), and `BlockMinutes` (current month only). The current month's working-time total also equals `CurrentMonth`. The private school form displays summaries only in the flight-duty column; its working/block summary cells remain blank.
- `SignatureBase64`: PNG image data, empty when no signature is configured. Embed as `<img src="data:image/png;base64,{{.SignatureBase64}}">`, guarded by `{{if .SignatureBase64}}`.

Helpers: `formatDuration` (minutes to `H:MM`), `formatTime` and `formatRestUntil` (`HH:MM`, blank for zero), `formatLongDate` (`DD.MM.YYYY`), and `formatMonth` (`YYYY-MM` to a German month name, for example `September`). Guard durations with `{{if not .Start.IsZero}}` so non-working days stay blank. Iterate with `{{range .Lines}}`; use `{{if .Day}}{{printf "%02d." .Day}}{{end}}` for calendar labels. The independently written [test template](../testdata/duty-report.html.tmpl) is a minimal example, not the school's document.

Template parsing, rendering, and signature loading happen before output is written. Duty-report PDF conversion is staged so a renderer failure leaves existing reports intact.
