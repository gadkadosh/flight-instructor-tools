# Realistic anonymized example

These files model a small but realistic flight-instruction billing period without containing private data:

- `sessions.json` contains sessions around May 2026.
- `config.json` contains fictional issuer, customer, bank, and tax data, one
  hourly rate for preparation and one for block time, and the `timeZone` used
  for every date and month.

## Running it

From the repository root, [build the tool](../README.md#getting-started), then
validate the example sessions:

```sh
./fitools validate examples/sessions.json
```

Generate the May invoice (requires [WeasyPrint](https://doc.courtbouillon.org/weasyprint/stable/first_steps.html) on `PATH`):

```sh
./fitools generate \
  --input examples/sessions.json \
  --config examples/config.json \
  --month 2026-05 \
  --number 2026-05 \
  --issue-date 2026-06-09
```

Writes `output/Rechnung-2026-05.pdf`. An existing PDF requires confirmation
before it is overwritten; use `--force` in scripts.
Invoice output is tailored to EUR, German formatting, and 0% VAT. Review generated
documents before use.

Keep real invoice data outside the repository, for example under `local/`, which is ignored by Git.

## Example coverage

The data deliberately exercises:

- sessions immediately outside the selected month;
- multiple sessions for one student on one day;
- multiple flights in one session;
- a preparation-only session;
- a block-only session;
- an unnamed Rundflug;
- German characters; and
- a June preparation duration whose amount requires cent rounding.

## Session format

Sessions use `schemaVersion: 3`. Each session has an `activities` array with at least one entry. Every activity requires an `id`, a `type`, and positive integer `minutes`:

```json
"activities": [
  { "id": "briefing-1", "type": "preparation", "minutes": 30 },
  { "id": "flight-1", "type": "dual", "minutes": 60 },
  { "id": "flight-2", "type": "soloSupervision", "minutes": 45 }
]
```

- `preparation`: pre/post-flight briefing and preparation, billed at the preparation rate.
- `dual`: flight block minutes, billed at the block-time rate.
- `soloSupervision`: the supervised student's solo block minutes, billed at the same block-time rate.
- `rundflug`: sightseeing flight block minutes, billed at the same block-time rate.
- `schnupperflug`: introductory flight block minutes, billed at the same block-time rate.

`student` is required for sessions containing `dual` or `soloSupervision`, and for preparation-only sessions. It is optional for sessions whose flights are all `rundflug` or `schnupperflug`, including those with preparation. The session `description` field is not supported. For example, an unnamed Rundflug is recorded as:

```json
{
  "id": "rundflug-1",
  "dutyStart": "2026-05-24T10:00:00Z",
  "dutyEnd": "2026-05-24T11:00:00Z",
  "activities": [
    { "id": "flight-1", "type": "rundflug", "minutes": 45 }
  ]
}
```

Types are required; unsupported values are rejected. Activities are grouped into one preparation charge and one combined block-time charge within each session before rounding, regardless of activity order or flight type. All flight types use the block rate. Preparation uses `Flugvorbereitung`; block labels come from the flight types: `Blockzeit` for Dual/solo supervision, `Rundflug`, or `Schnupperflug`. Mixed sessions join their distinct block labels with ` / ` in alphabetical order, retaining a single block charge. A student name prefixes either charge when present, for example `Alex - Schnupperflug`. No grouping occurs across sessions. Session `dutyStart` and `dutyEnd` remain independent of activity durations.

The viewer's **Block time** column includes Dual, Rundflug, and Schnupperflug; **Solo supervision** remains separate. The expanded flight rows show each activity's type.

### Updating existing files

Only version 3 is supported; there is no legacy loader or automatic migration. Back up existing files before updating them manually:

1. Review flight types explicitly. Reclassify sightseeing or introductory flights as `rundflug` or `schnupperflug` based on your records, never by guessing from description strings. Preserve IDs, timestamps, durations, and activity order.
2. Supply a student for training and preparation-only sessions, then remove every session `description`. Extra wording such as `45°` is no longer part of generated invoice labels.
3. Set `schemaVersion` to `3` and run `fitools validate` on the updated file.

For version 1 files, first replace `preparationMinutes` with a `preparation` activity, replace `flights` with the remaining activities, rename each flight's `blockMinutes` to `minutes`, and assign every activity a type and ID. Preserve existing flight IDs and identify solo supervision explicitly; the old format cannot distinguish it from dual flying.

Existing generated invoices are not modified. Regenerating equivalent session data preserves rates, durations, charge grouping, rounding, and amounts, while special-flight labels use the standardized type names.

## Expected May 2026 invoice

At preparation and block rates of EUR 25.00 and EUR 30.00 per hour, respectively, May should produce these grouped lines:

| Date | Description | Duration | Amount |
| --- | --- | ---: | ---: |
| 03.05.26 | Alex Beispiel - Flugvorbereitung | 0:30 | 12.50 EUR |
| 03.05.26 | Alex Beispiel - Blockzeit | 2:15 | 67.50 EUR |
| 03.05.26 | Robin Muster - Flugvorbereitung | 1:00 | 25.00 EUR |
| 03.05.26 | Robin Muster - Blockzeit | 1:20 | 40.00 EUR |
| 10.05.26 | Taylor Test - Flugvorbereitung | 0:30 | 12.50 EUR |
| 10.05.26 | Taylor Test - Blockzeit | 0:30 | 15.00 EUR |
| 10.05.26 | Chris Beispiel - Flugvorbereitung | 0:30 | 12.50 EUR |
| 10.05.26 | Chris Beispiel - Blockzeit | 2:02 | 61.00 EUR |
| 10.05.26 | Robin Muster - Flugvorbereitung | 0:30 | 12.50 EUR |
| 10.05.26 | Robin Muster - Blockzeit | 1:28 | 44.00 EUR |
| 24.05.26 | Rundflug | 0:45 | 22.50 EUR |
| 24.05.26 | Sam Muster - Flugvorbereitung | 1:00 | 25.00 EUR |
| 24.05.26 | Sam Muster - Blockzeit | 1:46 | 53.00 EUR |
| 24.05.26 | Dana Beispiel - Flugvorbereitung | 0:30 | 12.50 EUR |
| 24.05.26 | Dana Beispiel - Blockzeit | 2:19 | 69.50 EUR |

The expected net and gross total is **EUR 485.00**, with EUR 0.00 VAT.

Multiple sessions and multiple activities per session are supported. Grouping across session boundaries is not implemented yet, so the current output contains separate lines for otherwise matching activities from different sessions.

## Duty reports

Open **Generate duty report…** in the session viewer, fill in the form, and click
**Download PDF**. For CLI options, run `./fitools duty-report --help`.

Set `dutyReportTemplateFile` in your config. Add
`signatureFile` for an optional PNG signature. See the fields and helpers in the
[sample template](../testdata/duty-report.html.tmpl).

Enter the year-to-date flight-duty total before the report month as `H:MM` (use
`0:00` in January). Reports include every session in the chosen month, regardless
of the viewer selection. Daily flight-duty time spans the earliest duty start to
the latest duty end, including gaps.
