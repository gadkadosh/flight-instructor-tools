# Photo-entry workspace

A local Next.js app for turning photos of handwritten flight-school sheets into reviewed teaching records. Upload → review beside the originals → save/reopen → explicitly confirm. Independent of the [Go CLI](../cli/).

## Start

Requires **Node 26 LTS** and npm. Storage uses built-in `node:sqlite`; no database installation is needed.

```sh
cd app
npm install
cp .env.example .env.local
npm run dev
```

Open [127.0.0.1:3000](http://127.0.0.1:3000). Development and production commands bind to `127.0.0.1`. For production:

```sh
npm run build
npm start
```

The Next.js server owns storage, validation, image preparation, and extraction. Sharp prepares upright image copies. ChatGPT integration uses the OpenAI SDK, JOSE for signed identity validation, and a filesystem lock to serialize rotating credentials across workers. Stored originals remain unchanged. Storage, validation, image serving, and extraction run in the Next.js Node server. The review editor runs in the browser, using plain CSS.

## Local extraction with Ollama

The example configuration selects `qwen3.5:4b`, already installed on the development machine and reporting vision support. Start Ollama if needed (open its application or run `ollama serve`). Check models with `ollama list`. On another machine, install this model explicitly with `ollama pull qwen3.5:4b`.

```dotenv
OLLAMA_MODEL=qwen3.5:4b
OLLAMA_BASE_URL=http://127.0.0.1:11434
```

Use **Read / replace draft with Ollama** in the review workspace. It first asks the local `/api/chat` endpoint for a plain transcription, then sends that transcription in a separate text-only request with the output schema included in the prompt. Successful drafts retain the source transcription, available under **Source transcription · AI, unreviewed** beside the photos. No SDK or agent framework is used. Only HTTP loopback endpoints are accepted; redirects are rejected. Save edits before extraction. A successful reading replaces draft fields and resets identity and review acknowledgements. A result arriving after another tab saves changes is discarded.

Leave `OLLAMA_MODEL` unset/empty for manual entry. Unconfigured extraction, an offline server, an incompatible model, invalid output, or a three-minute timeout retains the existing draft and photos with an explanatory message. Uploading never inserts sample data or starts extraction. There is no automatic model download. Select **Use local Ollama** in extraction settings if ChatGPT was previously selected. Restart after environment changes.

Requests explicitly allocate a 16,384-token context window, including space for image tokens and up to 4,096 generated tokens per request. A shared three-minute deadline covers both steps. Transcription uses temperature zero and disables the model's default repetition penalty for previously used text. This avoids relying on Ollama's small default context for full-resolution photos. Larger contexts use more memory. If a request still fails, the extraction message includes Ollama's error details (for example, a context limit) while retaining the existing draft.

This is an **extraction experiment**, not evidence of handwriting accuracy. Evaluation on a real sheet exposed errors in names, registrations, times, and grouping; a larger installed MLX model also timed out. Inspect the raw transcription to distinguish reading errors from interpretation errors. Check every result against the originals; model output cannot confirm identities or records.

## Extraction with your ChatGPT plan

1. Open **Extraction settings** from the home page or review panel, at `/settings/chatgpt`.
2. Choose **Continue with ChatGPT**, sign in, and authorize ChatGPT plan usage. Eligible Plus/Pro accounts can use their allowance without configuring an API key. Availability and limits depend on the account and workspace.
3. Select an image-capable model from the account's model list and choose **Use ChatGPT for extraction**.
4. Reopen a session, save any edits, and choose **Read with ChatGPT**. This sends all linked photos to OpenAI and replaces the draft only after a completed, valid reading. Uploading alone never starts cloud extraction.

The request returns literal transcription plus structured sheet data. Application code normalizes times, groups circuits, and validates the draft. Source transcription remains beside the originals; successful extraction clears identity/review acknowledgements. Failed, incomplete, interrupted, or usage-limited requests preserve the saved draft. Inference is not automatically retried and never switches to API-key billing.

ChatGPT image copies retain full resolution (up to 40 megapixels per photo) with camera orientation applied. Photos are embedded in the request; the Files upload API is not used. Originals and reviewed records remain local. Requests use OpenAI's supported subscription-authorized Responses route with `store: false` and `stream: true`; this flag does not promise zero provider-side retention. See [OpenAI's ChatGPT plan integration](https://developers.openai.com/siwc/token-sharing-open-source) for availability and data handling.

Sign-in requires opening the app using **127.0.0.1**, rather than `localhost`, because OAuth callbacks must use that host. The app stores installation identity, account registrations, model selection, and renewable credentials in `local/chatgpt/connection.json` (owner-only directory/file permissions). Credentials never enter React props, browser storage, evaluation output, or Git. Preserve the directory across restarts; backups of it contain credentials. Account selection and reconnect reuse the issued registration. Disconnect clears local tokens and attempts remote revocation; if remote revocation cannot be confirmed, disconnect the app in ChatGPT settings too. **Manage usage** opens ChatGPT's usage controls.

This integration is intended for this local personal tool. Paid or remotely hosted distribution requires checking OpenAI's access requirements.

## Review workflow

1. Choose or drop JPEG, PNG, or WebP photos: up to eight files / 20 MiB per upload. Convert HEIC or PDF first. Vision inputs are limited to 40 megapixels per photo; camera rotation metadata is applied to the model copy. Ollama copies are capped at 2560 pixels on the long edge; ChatGPT copies retain full resolution. Stored originals remain unchanged. Group pages from **one student, date, and aircraft session**. Upload unrelated sessions separately.
2. Compare the original pages with the editor. Change page, zoom, rotate, or open the original. Add further pages from a saved session using **Add pages to this session**; this invalidates confirmation and review acknowledgement. Independently uploaded sessions are not automatically merged.
3. Preserve the written student name. Select the actual student or create an identity with their confirmed full name. Explicitly acknowledge identity. Same-name identities remain separate, identified by a short ID in the selector.
4. Enter each distinct off/on-block period from the fourth column once, with all its flights. Consecutive circuits at the same airfield and with the same activity are grouped as one flight, with several takeoff/landing intervals and a landing count. Intervals remain individually editable; flight totals add airborne intervals and exclude ground gaps. The block period can span circuits and a later departure without being counted twice. Extraction counts landings from the timing entries. Select dual instruction or supervised solo for **each flight**; absence of SOLO does not imply dual. Instructor is the app owner and is not an input. Flight remarks, weather and exercises are not extracted.
5. Enter preparation minutes explicitly. Blank means unknown, not zero. Written flight/block totals are optional cross-checks across grouped pages, never additional activities. Preserve charter information verbatim in the field labelled **LOCAL**.
6. Save incomplete drafts at any time. Resolve the listed confirmation issues, acknowledge review, and explicitly choose **Confirm record**. Further edits require renewed confirmation. Saving an unchanged confirmed record preserves confirmation.

Flight/block times use `HH:MM` in UTC. For an explicitly established overnight interval, append `+1` to next-day times, e.g. off `23:50`, on `00:20+1`. Minute-only readings may remain in draft fields or uncertainty notes but cannot be confirmed as clock times. Compact written clocks such as `1037` normalize to `10:37`. Two-digit clock shorthand inherits the most recently established hour within its block, following off-block, takeoff/landing intervals, and on-block in order. For example, `15:01 → 08 → 14` becomes `15:01 → 15:08 → 15:14`. A full written clock must establish an hour or day change. Missing/unreadable cells, decreasing shorthand minutes, and contradictions with the next full clock stop expansion; unresolved values still need manual review. The raw transcription remains available. Dates use the explicit convention `DD.MM.YY` → `20YY-MM-DD`, so a written `26` becomes 2026 regardless of the computer's current year. Extraction instructions ask the model to recheck the handwritten year across page headers and mark ambiguous digits with `?`; confident misreadings still require human correction. The current year is never substituted for an extracted year. Missing years, midnight, duty times, and local-to-UTC conversions are never inferred.

Confirmation requires a real selected student and identity acknowledgement; written name; valid date; aircraft; explicit preparation; at least one complete block and flight; airfields, positive landing counts, and an explicit flight activity. Flights must be ordered, non-overlapping, and inside non-overlapping block periods. Written totals, when present, must match calculated durations. The reviewer acknowledges grouping, uncertainties, and SOLO scope. Notes can retain original uncertainty and its resolution.

Optionally remember an exact written name as an unambiguous alias **on confirmation**. Aliases only suggest a student; they never confirm identity. Conflicting aliases cannot be reassigned. If the same alias is confirmed for another person without remembering it, it is permanently marked ambiguous and stops suggesting either identity. Changing the written name or student selection clears identity acknowledgement.

## Storage and reliability

Private runtime data lives in Git-ignored **`app/local/`**:

- `records.sqlite` and SQLite WAL/SHM sidecars: drafts, identities, aliases, current revision/status, and historical confirmation snapshots.
- `chatgpt/connection.json`: protected ChatGPT registrations, renewable credentials, and extraction settings.
- `photos/<sha256>`: original image bytes addressed by content hash. Filenames and media types are kept in SQLite. The private image route disables caching and fixes the media type.

SQLite uses parameterized SQL, foreign keys, WAL, transactions, and numbered migrations via `PRAGMA user_version`. Hot reloads reuse the process connection. `node:sqlite` is verified in the running production app on Node 26. Its release-candidate API remains a compatibility risk across Node upgrades; use Node 26 and rerun checks after upgrading.

Identical saves do not create revisions. Repeated confirmation keeps the original timestamp and one snapshot. Uploads hash actual bytes: identical files reopen the existing session even when renamed. Add mixes of existing/new pages from the existing session; photos belonging to another session are flagged. Adding the same page again creates no extra link. Different crops/encodings are different files and need human review. Each image belongs to one session in this scaffold.

Revision checks reject stale overwrites. Confirmation validation and alias updates are atomic on the server. A browser warning protects unsaved edits when closing the tab; save before navigating away. Nothing is automatically saved or confirmed.

Open a draft and choose **Delete draft** in the Teaching record header to remove it and its uploaded photo copies, after confirming. Unsaved edits are discarded too. Originals in Photos, saved student identities, and separate evaluation files are unaffected. Records that have ever been confirmed are protected, including a currently unconfirmed edit of a previously confirmed record. Deletion checks the saved revision so another tab cannot delete newer changes. Repeated deletion is safe, and uploading a deleted photo creates a new draft. Photo cleanup is recorded in SQLite so an interrupted cleanup can finish when deletion is retried.

Back up the entire `app/local/` directory with the server stopped, preserving the database and photos together. Keep student sheets, extracted readings, backups, and `.env.local` out of Git. The app has no authentication and is for one user on a trusted local machine; retain the loopback binding. There is no record-splitting or recovery UI yet. Interrupted uploads may leave an unreferenced hashed image; retrying the upload is safe.

## Verify

```sh
npm test
npm run typecheck
npm run build
npm run test:app
```

Tests use Node's built-in runner and explicitly synthetic fixtures in temporary directories. Behavioral tests cover persistence across reopened database connections, rejected/renewed confirmations, shared blocks, explicit midnight, totals, ambiguous identities/aliases, stale writes, repeated uploads/saves/confirmation, and extraction errors. ChatGPT tests use synthetic signed identities and mocked inference to verify OAuth checks, credential persistence/refresh, image transmission, completed-stream requirements, and normalized unconfirmed drafts. `test:app` requires a current production build; it starts the built app on a temporary loopback port, exercises uploads and server actions over HTTP, checks the rendered record and original photo route, and removes its isolated data. It does not control a browser or prove client interaction/visual layout.

## Repeatable private extraction evaluation

```sh
npm run evaluate -- <session-id> [installed-model|chatgpt] [expected-json-path]
```

Use the session ID from its URL. Pass `chatgpt` to use the connected account and selected model; otherwise select an installed Ollama model. This command reads originals through a read-only SQLite connection and never changes drafts or confirmations. It writes model settings, prompts, raw responses, source transcription, resulting draft, timing, and any expected-value differences under ignored `local/evaluation/`. The expected JSON is compared **after** inference and is never included in the model prompt. Keep expected real names and sheet readings in that ignored directory, not in tests or source files.

The optional expected JSON is a subset of draft fields plus `flights`, a flattened array across blocks. Each flight has departure, arrival, landing count, activity, and `movements` with takeoff/landing pairs. Inspect the saved source transcription and raw structured response to distinguish reading errors from interpretation errors. A structurally valid response is not a successful recognition result.

## Deferred

Invoices, exports (including ForeFlight), duty reports, FlightCenterPlus, deployment, application user accounts, and broader handwriting-quality evaluation beyond the current real-sheet experiment. The model preserves block/flight distinctions and flight activity for later outputs; it does not allocate mixed dual/solo block time to personal logbooks, calculate duties, or certify regulatory compliance. Ground-only sessions and multiple sessions sharing one source image need a later extension. Earlier saved drafts with one timing pair per flight remain readable; they are converted to one-interval flights when opened.
