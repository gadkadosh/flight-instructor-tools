import { useEffect, useId, useRef, useState, type ComponentProps, type KeyboardEvent } from 'react';
import FlightHeaderCells from './FlightHeaderCells';
import { newFlight, newSessionDraft, type FlightDraft, type SessionDraft } from './sessionDraft';
import {
  activityKinds,
  clockPattern,
  durationPattern,
  formatDuration,
  normalizeDuration,
  parseClock,
  parseDuration,
  type Activity,
  type FlightType,
  type SessionView,
  zonedInstant,
} from './sessions';

type FlightField = Exclude<keyof FlightDraft, 'id' | 'type' | 'untouched'>;
const clockHint = '24-hour time, for example 0930 or 9:30';
const dayMs = 24 * 60 * 60_000;
const durationHint = 'Hours and two digits for minutes, for example 1:30 or 130';
const airfieldPattern = /^[A-Za-z0-9]{4}$/;
const landingsPattern = /^[1-9]\d*$/;
const clockInput = {
  pattern: clockPattern.source,
  title: `UTC, ${clockHint}`,
  inputMode: 'numeric',
} as const;
const airfieldInput = {
  pattern: airfieldPattern.source,
  maxLength: 4,
  title: 'Four-character ICAO identifier, for example EDFE',
  placeholder: 'EDFE',
};
const clock = (value: string) => parseClock(value) ?? value;
const saveAnotherKeys = /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘↵' : 'Ctrl ↵';

// The inputs after the type, in the order of FlightHeaderCells. Leaving applies `tidy`.
const flightFields: {
  name: FlightField;
  label: string;
  input: ComponentProps<'input'>;
  tidy?: (value: string) => string;
}[] = [
  { name: 'registration', label: 'registration', input: { placeholder: 'D-EABC' } },
  { name: 'departure', label: 'departure', input: airfieldInput },
  { name: 'arrival', label: 'arrival', input: airfieldInput },
  {
    name: 'blockOff',
    label: 'block off',
    input: { ...clockInput, placeholder: '0930' },
    tidy: clock,
  },
  {
    name: 'takeoff',
    label: 'takeoff time',
    input: { ...clockInput, placeholder: 'Optional' },
    tidy: clock,
  },
  {
    name: 'landing',
    label: 'landing time',
    input: { ...clockInput, placeholder: 'Optional' },
    tidy: clock,
  },
  {
    name: 'blockOn',
    label: 'block on',
    input: { ...clockInput, placeholder: '1030' },
    tidy: clock,
  },
  {
    name: 'landings',
    label: 'landings',
    input: {
      inputMode: 'numeric',
      pattern: landingsPattern.source,
      title: 'A positive whole number',
    },
  },
];

// A duty end before its start is on the next day.
function duty({ date, dutyStart, dutyEnd }: SessionDraft) {
  const start = parseClock(dutyStart);
  const end = parseClock(dutyEnd);
  const overnight = Boolean(date && start && end && end < start);
  let endDate: string | undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const day = new Date(`${date}T00:00:00Z`);
    if (overnight) day.setUTCDate(day.getUTCDate() + 1);
    if (Number.isFinite(day.getTime()) && day.getUTCFullYear() <= 9999) {
      endDate = day.toISOString().slice(0, 10);
    }
  }
  return { start, end, endDate, nextDay: overnight ? endDate : undefined };
}

const endDateFormat = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'UTC',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

// Adds a session, or with the etag of a stored session, replaces or deletes it.
export default function SessionEntry({
  view,
  initial,
  etag,
  onSaved,
  onClose,
  onDelete,
}: {
  view: SessionView;
  initial: SessionDraft;
  etag?: string;
  onSaved: (view: SessionView) => void;
  onClose: () => void;
  onDelete?: (trigger: HTMLButtonElement) => void;
}) {
  const formId = useId();
  const suggestionsId = useId();
  const overnightHintId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const studentRef = useRef<HTMLInputElement>(null);
  const repeatRef = useRef<HTMLButtonElement>(null);
  const savingRef = useRef(false);
  const focusStudent = useRef(false);
  const [draft, setDraft] = useState(initial);
  const [overnightHintDate, setOvernightHintDate] = useState(() => duty(initial).nextDay);
  const [focusFlight, setFocusFlight] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const overnightDateLabel = overnightHintDate
    ? endDateFormat.format(new Date(`${overnightHintDate}T00:00:00Z`))
    : undefined;
  const { date, student, preparation, flights } = draft;
  const { start, end, endDate, nextDay } = duty(draft);
  const title = etag ? 'Edit session' : 'New session';
  const students = [
    ...new Set(
      view.sessions
        .map((session) => session.student)
        .filter((student): student is string => Boolean(student)),
    ),
  ].sort((a, b) => a.localeCompare(b));
  const dutyStart = endDate && start ? zonedInstant(view.timeZone, date, start) : undefined;
  const dutyEnd = endDate && end ? zonedInstant(view.timeZone, endDate, end) : undefined;
  // A UTC flight time is its first occurrence from duty start. Flights lie within duty, which
  // is shorter than a day, so that is the only occurrence that can be valid.
  const flightInstant = (clock: string) => {
    const from = dutyStart ?? 0;
    const [hours, minutes] = clock.split(':').map(Number);
    const instant = Math.floor(from / dayMs) * dayMs + (hours! * 60 + minutes!) * 60_000;
    return instant < from ? instant + dayMs : instant;
  };
  function blockMinutes(flight: FlightDraft) {
    const off = parseClock(flight.blockOff);
    const on = parseClock(flight.blockOn);
    const minutes = off && on && (flightInstant(on) - flightInstant(off)) / 60_000;
    if (minutes && minutes > 0) return minutes;
  }
  const totals = { preparation: 0, block: 0, soloSupervision: 0 };
  for (const flight of flights) {
    totals[activityKinds[flight.type].summary] += blockMinutes(flight) ?? 0;
  }

  useEffect(() => {
    dateRef.current?.focus();
  }, []);

  useEffect(() => {
    if (focusFlight) document.getElementById(focusFlight)?.focus();
  }, [focusFlight, flights.length]);

  useEffect(() => {
    if (!saving && focusStudent.current) {
      studentRef.current?.focus();
      focusStudent.current = false;
    }
  }, [saving]);

  function set(fields: Partial<SessionDraft>) {
    setDraft((previous) => ({ ...previous, ...fields }));
  }

  // Blur can follow a reset by save-and-add, so tidy the current value, not the rendered one.
  function tidyDraft(
    name: 'dutyStart' | 'dutyEnd' | 'preparation',
    clean: (value: string) => string,
  ) {
    setDraft((previous) => ({ ...previous, [name]: clean(previous[name]) }));
  }

  function setFlights(update: (flights: FlightDraft[]) => FlightDraft[]) {
    setDraft((previous) => ({ ...previous, flights: update(previous.flights) }));
  }

  function setField(id: string, field: Partial<FlightDraft>) {
    setFlights((previous) =>
      previous.map((item) => (item.id === id ? { ...item, ...field } : item)),
    );
  }

  function addFlight() {
    const flight = newFlight(flights.at(-1));
    setFlights((previous) => [...previous, flight]);
    setFocusFlight(`${flight.id}-blockOff`);
  }

  function shortcut(event: KeyboardEvent) {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      formRef.current?.requestSubmit(repeatRef.current);
    }
  }

  function updateOvernightHint() {
    if (!saving && !savingRef.current) setOvernightHintDate(nextDay);
  }

  async function save(another: boolean) {
    if (savingRef.current) return;
    updateOvernightHint();
    setError('');
    function invalid(message: string, name: string) {
      setError(message);
      (formRef.current?.elements.namedItem(name) as HTMLElement | null)?.focus();
    }
    if (!endDate) {
      return invalid('Enter a valid session date and duty end within years 0001–9999.', 'date');
    }
    // The inputs' pattern blocks submission before either can be missing.
    if (!start || !end) return;
    if (start === end) return invalid('Duty end must differ from duty start.', 'end');
    const prep = preparation.trim() ? parseDuration(preparation) : 0;
    if (prep === undefined) {
      return invalid('Enter preparation as H:MM, such as 1:30 or 130.', 'preparation');
    }
    const inDuty = (clock: string) => flightInstant(clock) <= dutyEnd!;
    const activities: Activity[] =
      prep > 0 ? [{ id: draft.preparationId, type: 'preparation', minutes: prep }] : [];
    for (const flight of flights) {
      if (flight.untouched) continue;
      const field = (name: FlightField) => `${flight.id}-${name}`;
      // Input patterns block submission of malformed times, so undefined means blank.
      const [off, on, takeoff, landing] = [
        flight.blockOff,
        flight.blockOn,
        flight.takeoff,
        flight.landing,
      ].map(parseClock);
      if (!off)
        return invalid(
          'Enter block off in UTC as a 24-hour time, such as 0930.',
          field('blockOff'),
        );
      if (!on)
        return invalid('Enter block on in UTC as a 24-hour time, such as 1030.', field('blockOn'));
      if (!inDuty(off)) return invalid('Block off must be within duty time.', field('blockOff'));
      if (!inDuty(on)) return invalid('Block on must be within duty time.', field('blockOn'));
      if (!blockMinutes(flight))
        return invalid('Block on must be after block off.', field('blockOn'));
      if (!takeoff !== !landing) {
        return invalid('Enter both takeoff and landing times, or neither.', field('takeoff'));
      }
      if (
        takeoff &&
        landing &&
        !(
          flightInstant(off) <= flightInstant(takeoff) &&
          flightInstant(takeoff) < flightInstant(landing) &&
          flightInstant(landing) <= flightInstant(on)
        )
      ) {
        return invalid(
          'Takeoff and landing must be within the block, takeoff first.',
          field('takeoff'),
        );
      }
      if (!landingsPattern.test(flight.landings.trim())) {
        return invalid('Enter landings as a positive whole number.', field('landings'));
      }
      for (const name of ['departure', 'arrival'] as const) {
        if (!airfieldPattern.test(flight[name])) {
          return invalid(
            'Enter airfields as four-character ICAO identifiers, such as EDFE.',
            field(name),
          );
        }
      }
      if (!flight.registration.trim()) {
        return invalid('Enter the aircraft registration.', field('registration'));
      }
      const stamp = (clock: string) => new Date(flightInstant(clock)).toISOString();
      activities.push({
        id: flight.id,
        type: flight.type,
        blockOff: stamp(off),
        blockOn: stamp(on),
        ...(takeoff && landing
          ? { firstTakeoff: stamp(takeoff), lastLanding: stamp(landing) }
          : {}),
        departure: flight.departure.toUpperCase(),
        arrival: flight.arrival.toUpperCase(),
        registration: flight.registration.trim().toUpperCase(),
        landings: Number(flight.landings),
      });
    }
    if (activities.length === 0) {
      return invalid('Enter preparation time or at least one flight.', 'preparation');
    }
    const hasFlight = activities.some((activity) => activity.type !== 'preparation');
    if (
      !student.trim() &&
      (!hasFlight || activities.some((activity) => activityKinds[activity.type].studentRequired))
    ) {
      return invalid('Enter a student for training or preparation-only sessions.', 'student');
    }
    savingRef.current = true;
    setSaving(true);
    try {
      const response = await fetch(
        etag ? `/api/sessions/${encodeURIComponent(draft.id)}` : '/api/sessions',
        {
          method: etag ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json', ...(etag ? { 'If-Match': etag } : {}) },
          body: JSON.stringify({
            id: draft.id,
            dutyStart: `${date}T${start}`,
            dutyEnd: `${endDate}T${end}`,
            student: student.trim(),
            activities,
          }),
        },
      );
      // The host check and the router can answer with plain text.
      const body = await response.json().catch(() => null);
      if (!response.ok || !body) throw new Error(body?.error || 'Could not save session.');
      onSaved(body);
      if (another) {
        setDraft(newSessionDraft(body, date));
        setOvernightHintDate(undefined);
        setFocusFlight(undefined);
        focusStudent.current = true;
      } else {
        onClose();
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not save session.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <>
      <tr className="entry-row" onKeyDown={shortcut}>
        <td colSpan={2}>
          <span className="visually-hidden">{title}</span>
        </td>
        <td>
          <input
            ref={dateRef}
            form={formId}
            name="date"
            type="date"
            aria-label="Session date"
            value={date}
            onChange={(event) => set({ date: event.target.value })}
            onBlur={updateOvernightHint}
            required
            disabled={saving}
          />
        </td>
        <td>
          <input
            ref={studentRef}
            form={formId}
            name="student"
            aria-label="Student"
            list={suggestionsId}
            placeholder="Student"
            autoComplete="off"
            value={student}
            onChange={(event) => set({ student: event.target.value })}
            disabled={saving}
          />
          <datalist id={suggestionsId}>
            {students.map((student) => (
              <option key={student} value={student} />
            ))}
          </datalist>
        </td>
        <td>
          <input
            form={formId}
            name="start"
            aria-label="Duty start"
            placeholder="0900"
            pattern={clockPattern.source}
            title={clockHint}
            inputMode="numeric"
            required
            value={draft.dutyStart}
            onChange={(event) => set({ dutyStart: event.target.value })}
            onBlur={() => {
              tidyDraft('dutyStart', clock);
              updateOvernightHint();
            }}
            disabled={saving}
          />
        </td>
        <td>
          <label className="entry-duty-end">
            <span id={overnightHintId} className="entry-next-day" aria-live="polite">
              {overnightHintDate && (
                <>
                  <span aria-hidden="true" title={overnightDateLabel}>
                    +1 day
                  </span>
                  <span className="visually-hidden">
                    Duty ends the next day (
                    <time dateTime={overnightHintDate}>{overnightDateLabel}</time>).
                  </span>
                </>
              )}
            </span>
            <input
              form={formId}
              name="end"
              aria-label="Duty end"
              aria-describedby={overnightHintDate ? overnightHintId : undefined}
              placeholder="1730"
              pattern={clockPattern.source}
              title={clockHint}
              inputMode="numeric"
              required
              value={draft.dutyEnd}
              onChange={(event) => set({ dutyEnd: event.target.value })}
              onBlur={() => {
                tidyDraft('dutyEnd', clock);
                updateOvernightHint();
              }}
              disabled={saving}
            />
          </label>
        </td>
        <td>
          <input
            form={formId}
            name="preparation"
            aria-label="Preparation duration"
            placeholder="H:MM"
            pattern={durationPattern.source}
            title={durationHint}
            inputMode="numeric"
            value={preparation}
            onChange={(event) => set({ preparation: event.target.value })}
            onBlur={() => tidyDraft('preparation', normalizeDuration)}
            disabled={saving}
          />
        </td>
        <td className="numeric">
          <span aria-label="Block time total">{formatDuration(totals.block)}</span>
        </td>
        <td className="numeric">
          <span aria-label="Solo supervision total">{formatDuration(totals.soloSupervision)}</span>
        </td>
        <td />
      </tr>
      <tr className="activity-details entry-details" onKeyDown={shortcut}>
        <td colSpan={10}>
          <form
            id={formId}
            ref={formRef}
            aria-label={title}
            onSubmit={(event) => {
              event.preventDefault();
              const { submitter } = event.nativeEvent as SubmitEvent;
              const another = Boolean(submitter) && submitter === repeatRef.current;
              void save(another);
            }}
          >
            <fieldset disabled={saving}>
              <legend className="visually-hidden">Flights</legend>
              <table className="flight-table flight-entry-table" aria-label={`${title} flights`}>
                <thead>
                  <tr>
                    <FlightHeaderCells />
                    <th scope="col">
                      <span className="visually-hidden">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {flights.map((flight, index) => (
                    <tr key={flight.id}>
                      <td>
                        <select
                          aria-label={`Flight ${index + 1} type`}
                          value={flight.type}
                          onChange={(event) =>
                            setField(flight.id, {
                              type: event.target.value as FlightType,
                              untouched: false,
                            })
                          }
                        >
                          {Object.entries(activityKinds)
                            .filter(([type]) => type !== 'preparation')
                            .map(([type, kind]) => (
                              <option key={type} value={type}>
                                {kind.label}
                              </option>
                            ))}
                        </select>
                      </td>
                      {flightFields.map(({ name, label, input, tidy }) => (
                        <td key={name}>
                          <input
                            {...input}
                            id={`${flight.id}-${name}`}
                            name={`${flight.id}-${name}`}
                            aria-label={`Flight ${index + 1} ${label}`}
                            value={flight[name]}
                            onChange={({ target }) =>
                              setField(flight.id, { [name]: target.value, untouched: false })
                            }
                            onBlur={() =>
                              tidy && setField(flight.id, { [name]: tidy(flight[name]) })
                            }
                          />
                        </td>
                      ))}
                      <td className="numeric">
                        <span aria-label={`Flight ${index + 1} block time`}>
                          {formatDuration(blockMinutes(flight) ?? 0)}
                        </span>
                      </td>
                      <td>
                        <button
                          className="action-button text icon"
                          type="button"
                          aria-label={`Remove flight ${index + 1}`}
                          title="Remove flight"
                          onClick={() => {
                            const remaining = flights.filter((item) => item.id !== flight.id);
                            setFlights(() => remaining);
                            if (remaining.length > 0)
                              setFocusFlight(
                                `${remaining[Math.min(index, remaining.length - 1)]!.id}-blockOff`,
                              );
                            else document.getElementById(`${formId}-add-flight`)?.focus();
                          }}
                        >
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                            focusable="false"
                          >
                            <path d="M18 6 6 18" />
                            <path d="m6 6 12 12" />
                          </svg>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={11}>
                      <button
                        className="action-button link add-flight"
                        type="button"
                        id={`${formId}-add-flight`}
                        onClick={addFlight}
                      >
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                          focusable="false"
                        >
                          <path d="M12 5v14" />
                          <path d="M5 12h14" />
                        </svg>
                        Add flight
                      </button>
                    </td>
                  </tr>
                </tfoot>
              </table>
              {error && (
                <p role="alert" className="error">
                  {error}
                </p>
              )}
              <div className="entry-actions">
                {onDelete && (
                  <button
                    className="action-button text danger"
                    type="button"
                    aria-haspopup="dialog"
                    onClick={(event) => onDelete(event.currentTarget)}
                  >
                    Delete session…
                  </button>
                )}
                {/* Enter submits with the first submit button, so Save session comes first and
                    the row shows it last. */}
                <div className="entry-submit">
                  <button type="submit" className="action-button">
                    {saving ? 'Saving…' : 'Save session'}
                  </button>
                  {!etag && (
                    <button
                      className="action-button secondary"
                      ref={repeatRef}
                      type="submit"
                      aria-keyshortcuts="Control+Enter Meta+Enter"
                    >
                      Save and add another
                      <kbd aria-hidden="true">{saveAnotherKeys}</kbd>
                    </button>
                  )}
                  <button className="action-button text" type="button" onClick={onClose}>
                    Cancel
                  </button>
                </div>
              </div>
            </fieldset>
          </form>
        </td>
      </tr>
    </>
  );
}
