# Adding sessions

- Click **Add session** to enter a session inline. Tab through the fields; duty
  times accept `0900`, `900`, or `09:00` (and `9` for `09:00`). Durations accept
  minutes or `H:MM`. Enter each flight separately; block and solo supervision totals update
  automatically. Blank flight rows are skipped, allowing preparation-only sessions.
- Flight types include Dual, Solo supervision, Rundflug, and Schnupperflug. A
  student is required for training and preparation-only sessions, and optional
  when all flights are Rundflug or Schnupperflug.
- Student suggestions come from existing sessions. Duty times use the configured
  timezone, shown below the table. An end time earlier than the start is treated
  as the next day; the inferred end date appears below the time. Nonexistent or ambiguous
  duty times during daylight-saving clock changes are rejected.
- **Save session** (or Enter from a text field) saves and closes the entry.
  **Save and add another**, also available with **Ctrl/⌘ + Enter**, retains the
  date and focuses the student field for the next session. Failed saves preserve
  the entry for retrying.
