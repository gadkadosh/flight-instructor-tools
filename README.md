# Flight Instructor Tools

A local session manager and Go CLI for my work as a flight instructor. Session
records and billing configuration drive monthly invoice and duty report PDFs.

[![Sessions grouped by month with an expanded flight logbook table and buttons to generate invoices and duty reports](sessions-screenshot.png)](sessions-screenshot.png)

## Getting started

Requires Go 1.26.5+, Node.js 24.11+ on the 24.x line (see
[`web/package.json`](web/package.json) for other supported versions),
[pnpm](https://pnpm.io/installation), and Make. PDF generation requires
[WeasyPrint](https://doc.courtbouillon.org/weasyprint/stable/first_steps.html) on `PATH`.

```sh
make build
./fitools --sessions examples/sessions.json --config examples/config.json
```

This opens the session UI with the [example data](examples/) in your browser.
Adding or deleting a session writes to the file selected by `--sessions`,
including the example file when using the command above. Press Ctrl+C in the
terminal to stop the server.

To use your own data, run `make install` and put Go's binary directory
(`~/go/bin` by default) on your `PATH`. Keep `sessions.json` and `config.json`
in a folder outside the repository, starting from the
[example config](examples/config.json), and run `fitools` from there. Template
and signature paths in the config are relative to the config file.

## Usage

Create sessions and generate invoices and duty reports in the browser, or see `fitools --help` for the CLI.
The [examples](examples/) show the config and data formats. An optional `signatureFile` adds a PNG signature.
Output is tailored to EUR, German formatting and 0% VAT, so review documents before use.

## Development

After `make build`, start development mode:

```sh
make dev
```

Open `http://127.0.0.1:5173` for the UI with React hot reload; the tab
reconnects when you restart. Go uses port 8080 and `examples/config.json`, and
writes session changes to `.dev-sessions.json`, an ignored copy of
`examples/sessions.json` that is reset on every start. Restart after Go changes.

Run checks and tests:

```sh
pnpm --dir web run check   # Formatting, linting, and TypeScript checks
pnpm --dir web exec playwright install chromium  # Once, for frontend tests
pnpm --dir web test
go test ./...
pnpm --dir web run test:e2e  # End-to-end smoke test, after make build
```

## License

[MIT](LICENSE.md).
