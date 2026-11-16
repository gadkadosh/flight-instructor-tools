# Flight Instructor Tools

A local session viewer and Go CLI for my work as a flight instructor. Session
records and billing configuration drive monthly invoices and duty reports, with
JSON snapshots, HTML, and PDF output.

<a href="invoice-screenshot.png">
    <img src="invoice-screenshot.png"
        alt="Example invoice generated from anonymized data"
        width="300">
</a>

## Getting started

Requires Go 1.26.5+, Node.js 24.11+ on the 24.x line (see
[`web/package.json`](web/package.json) for other supported versions),
[pnpm](https://pnpm.io/installation), and Make. PDF generation also requires
[WeasyPrint](https://doc.courtbouillon.org/weasyprint/stable/first_steps.html) on `PATH`.

```sh
make build
./fitools
```

This opens a read-only session viewer in your browser. The frontend is embedded
in the binary, so running it does not require Node.js. Press Ctrl+C in the
terminal to stop the server.

Session and configuration paths default to `sessions.json` and `config.json` in
the current working directory. To use private files in the ignored `local/` directory:

```sh
./fitools --input local/sessions.json --config local/config.json
```

See the [session format](examples/README.md#session-format) and
[example configuration](examples/realistic-config.json) for input details.
The viewer uses the configured `timeZone`, falling back to UTC when omitted.
Keep private data, templates, and signature images in `local/`.

## Invoices and duty reports

Generate an invoice from the anonymized example data:

```sh
./fitools generate \
    --input examples/realistic-sessions.json \
    --config examples/realistic-config.json \
    --month 2026-05 \
    --number 2026-05 \
    --issue-date 2026-06-09
```

Writes `Rechnung-2026-05.json`, `.html`, and `.pdf` to `output/`.
Existing files require confirmation before overwriting; use `--force` in scripts.
Billing rates apply by effective date. An optional `signatureFile` adds a PNG
signature, with relative paths resolved from the config file's directory.

Validate session data without generating documents:

```sh
./fitools validate examples/realistic-sessions.json
```

Generate a duty report:

```sh
./fitools duty-report \
    --input local/sessions.json \
    --config local/config.json \
    --month 2026-05 \
    --carry-over-flight-duty 120:00
```

Duty reports require a private HTML template, an explicit reporting timezone,
and year-to-date flight-duty time before the requested month. See the
[duty-report reference](docs/duty-reports.md) for configuration, calculations,
and template fields. Run `./fitools <command> --help` for all command options.

The tools are tailored to EUR invoices, German formatting, and 0% VAT. Review
all generated documents before use.

## Development

Run `make build` once to install dependencies and build the frontend, then:

```sh
make dev
```

The UI runs at `http://127.0.0.1:5173` with React hot reload and proxies API
requests to Go on port 8080. Data paths are relative to the repository root;
restart after Go changes.

The frontend uses a locally installed [Vite+](https://viteplus.dev/) toolchain:

```sh
pnpm --dir web run check   # Formatting, linting, and TypeScript checks
pnpm --dir web run format  # Apply formatting
pnpm --dir web exec playwright install chromium  # Once, for frontend tests
pnpm --dir web test
go test ./...
```

Frontend tests run in headless Chromium, including native popover and layout checks.
Production builds run frontend checks automatically. Build the frontend before
direct Go commands on a fresh checkout, since Go embeds `web/dist/`.

## License

[MIT](LICENSE.md).
