# Flight Instructor Tools

A local session manager and Go CLI for my work as a flight instructor. Session
records and billing configuration drive monthly invoices and duty reports, with
JSON snapshots, HTML, and PDF output.

[![Sessions grouped by month with an expanded flight type and duration summary and buttons to generate invoices and duty reports](sessions-screenshot.png)](sessions-screenshot.png)

## Getting started

Requires Go 1.26.5+, Node.js 24.11+ on the 24.x line (see
[`web/package.json`](web/package.json) for other supported versions),
[pnpm](https://pnpm.io/installation), and Make.

```sh
make build
./fitools --input examples/sessions.json --config examples/config.json
```

This opens the session UI with the example data in your browser. Adding or
deleting a session writes to the file selected by `--input`, including the
example file when using the command above. Press Ctrl+C in the terminal to stop
the server.


Without path overrides, the tools use `sessions.json` and `config.json` in the
current working directory. Keep private data, templates, and signature images
in the ignored `local/` directory.

To run `fitools` from any directory, use `make install` and put Go's binary
directory (`~/go/bin` by default) on your `PATH`.

## Usage

- [Invoice example and session validation](examples/README.md#running-it)
- [Session format](examples/README.md#session-format) and [example configuration](examples/config.json)
- [Duty reports](examples/README.md#duty-reports)

Select sessions and click **Generate invoice…** above the table to open the
invoice form. Enter an invoice number, confirm the issue date (which defaults to
today in the configured timezone), and click **Download PDF**. The invoice uses
the configured billing details and rates and includes only the selected sessions.
No invoice artifacts are kept on the server; invoice numbers and billing status
are not tracked.

Invoice session dates and CLI month selection use the configured `timeZone`,
falling back to UTC when omitted.

Run `./fitools <command> --help` for command options. PDF generation requires
[WeasyPrint](https://doc.courtbouillon.org/weasyprint/stable/first_steps.html) on `PATH`.

## Development

After `make build`, start development mode:

```sh
make dev
```

The UI runs at `http://127.0.0.1:5173` with React hot reload. Go uses port 8080
and reads the bundled `examples/sessions.json` and `examples/config.json`;
restart after Go changes.

Run checks and tests:

```sh
pnpm --dir web run check   # Formatting, linting, and TypeScript checks
pnpm --dir web exec playwright install chromium  # Once, for frontend tests
pnpm --dir web test
go test ./...
```

## License

[MIT](LICENSE.md).
