import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type ComponentProps,
  type KeyboardEvent,
} from 'react';
import FlightHeaderCells from './FlightHeaderCells';
import { request } from './request';
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
// A problem shows under the flights; `name` is its input, and `flight` numbers the message.
type Problem = { name: string; message: string; flight?: string };
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
  const savingRef = useRef(false);
  const focusStudent = useRef(false);
  const [draft, setDraft] = useState(initial);
  const [overnightHintDate, setOvernightHintDate] = useState(() => duty(initial).nextDay);
  const [focusFlight, setFocusFlight] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // As found by the last save, minus those whose input has changed since.
  const [problems, setProblems] = useState<Problem[]>([]);
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

  function saveAnother() {
    void save(true);
  }

  function shortcut(event: KeyboardEvent) {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      if (etag) formRef.current?.requestSubmit();
      else saveAnother();
    }
  }

  function clearProblem({ target }: ChangeEvent) {
    const { name } = target as HTMLInputElement;
    setProblems((previous) => previous.filter((problem) => problem.name !== name));
  }

  // Marks an input with problems and points it to their messages.
  function invalidProps(name: string) {
    const ids = problems.flatMap((problem, index) =>
      problem.name === name ? [`${formId}-problem-${index}`] : [],
    );
    return ids.length > 0 ? { 'aria-invalid': true, 'aria-describedby': ids.join(' ') } : {};
  }

  function updateOvernightHint() {
    if (!saving && !savingRef.current) setOvernightHintDate(nextDay);
  }

  // Every problem with the draft, in the order of the fields, and the activities to save when
  // there are none.
  function check() {
    const problems: Problem[] = [];
    const activities: Activity[] = [];
    const problem = (name: string, message: string, flight?: string) =>
      problems.push({ name, message, flight });
    if (!endDate) {
      problem('date', 'Enter a valid session date and duty end within years 0001–9999.');
    }
    const entered = flights.filter((flight) => !flight.untouched);
    if (
      !student.trim() &&
      (entered.length === 0 || entered.some((flight) => activityKinds[flight.type].studentRequired))
    ) {
      problem('student', 'Enter a student for training or preparation-only sessions.');
    }
    if (!start) problem('start', 'Enter duty start as a 24-hour time, such as 0900.');
    if (!end) problem('end', 'Enter duty end as a 24-hour time, such as 1730.');
    else if (start === end) problem('end', 'Duty end must differ from duty start.');
    const prep = preparation.trim() ? parseDuration(preparation) : 0;
    if (prep === undefined) {
      problem('preparation', 'Enter preparation as H:MM, such as 1:30 or 130.');
    } else if (prep > 0) {
      activities.push({ id: draft.preparationId, type: 'preparation', minutes: prep });
    } else if (entered.length === 0) {
      problem('preparation', 'Enter preparation time or at least one flight.');
    }
    const utcClock = (instant: number) => new Date(instant).toISOString().slice(11, 16);
    for (const flight of entered) {
      const found = problems.length;
      const field = (name: FlightField, message: string) =>
        problem(`${flight.id}-${name}`, message, flight.id);
      if (!flight.registration.trim()) field('registration', 'Enter the aircraft registration.');
      for (const name of ['departure', 'arrival'] as const) {
        if (!airfieldPattern.test(flight[name])) {
          field(name, `Enter the ${name} airfield as a four-character ICAO code, such as EDFE.`);
        }
      }
      const [off, on, takeoff, landing] = [
        flight.blockOff,
        flight.blockOn,
        flight.takeoff,
        flight.landing,
      ].map(parseClock);
      const malformed = (value: string, clock?: string) => Boolean(value.trim()) && !clock;
      // Each time check needs the ones before it to pass, so only the first problem shows.
      if (!off) field('blockOff', 'Enter block off in UTC as a 24-hour time, such as 0930.');
      else if (malformed(flight.takeoff, takeoff)) {
        field('takeoff', 'Enter takeoff in UTC as a 24-hour time, such as 0940.');
      } else if (malformed(flight.landing, landing)) {
        field('landing', 'Enter landing in UTC as a 24-hour time, such as 1020.');
      } else if (!on) field('blockOn', 'Enter block on in UTC as a 24-hour time, such as 1030.');
      else if (dutyStart !== undefined && dutyEnd !== undefined) {
        const inDuty = (clock: string) => flightInstant(clock) <= dutyEnd;
        const dutyWindow = `${utcClock(dutyStart)}–${utcClock(dutyEnd)} UTC`;
        if (!inDuty(off)) field('blockOff', `Block off must be within duty, ${dutyWindow}.`);
        else if (!inDuty(on)) field('blockOn', `Block on must be within duty, ${dutyWindow}.`);
        else if (!blockMinutes(flight)) field('blockOn', 'Block on must be after block off.');
        else if (!takeoff !== !landing) {
          field('takeoff', 'Enter both takeoff and landing times, or neither.');
        } else if (
          takeoff &&
          landing &&
          !(
            flightInstant(off) <= flightInstant(takeoff) &&
            flightInstant(takeoff) < flightInstant(landing) &&
            flightInstant(landing) <= flightInstant(on)
          )
        ) {
          field('takeoff', 'Takeoff and landing must be within the block, takeoff first.');
        }
      }
      if (!landingsPattern.test(flight.landings.trim())) {
        field('landings', 'Enter landings as a positive whole number.');
      }
      if (problems.length > found || !off || !on) continue;
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
    return { problems, activities };
  }

  async function save(another: boolean) {
    if (savingRef.current) return;
    updateOvernightHint();
    setError('');
    const { problems, activities } = check();
    setProblems(problems);
    if (problems.length > 0) {
      const names = new Set(problems.map(({ name }) => name));
      const first = [...(formRef.current?.elements ?? [])].find((element) =>
        names.has((element as HTMLInputElement).name),
      );
      (first as HTMLElement | undefined)?.focus();
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      const response = await request(
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
        'Could not save session.',
      );
      const body = await response.json();
      onSaved(body);
      if (another) {
        setDraft(newSessionDraft(body, date));
        setProblems([]);
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
      <tr className="entry-row" onKeyDown={shortcut} onChange={clearProblem}>
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
            {...invalidProps('date')}
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
            {...invalidProps('student')}
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
            {...invalidProps('start')}
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
              {...invalidProps('end')}
              aria-describedby={
                [overnightHintDate && overnightHintId, invalidProps('end')['aria-describedby']]
                  .filter(Boolean)
                  .join(' ') || undefined
              }
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
            {...invalidProps('preparation')}
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
      <tr className="activity-details entry-details" onKeyDown={shortcut} onChange={clearProblem}>
        <td colSpan={10}>
          <form
            id={formId}
            ref={formRef}
            aria-label={title}
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void save(false);
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
                            {...invalidProps(`${flight.id}-${name}`)}
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
                            setProblems((previous) =>
                              previous.filter((problem) => problem.flight !== flight.id),
                            );
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
              {problems.length > 0 && (
                <ul role="alert" className="error problems">
                  {problems.map((problem, index) => {
                    const number = flights.findIndex(({ id }) => id === problem.flight) + 1;
                    return (
                      <li key={index} id={`${formId}-problem-${index}`}>
                        {number > 0 && flights.length > 1 && `Flight ${number}: `}
                        {problem.message}
                      </li>
                    );
                  })}
                </ul>
              )}
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
                {/* Save session is the only submit button, so Enter saves wherever it sits. */}
                <div className="entry-submit">
                  <button className="action-button text" type="button" onClick={onClose}>
                    Cancel
                  </button>
                  {!etag && (
                    <button
                      className="action-button secondary"
                      type="button"
                      aria-keyshortcuts="Control+Enter Meta+Enter"
                      onClick={saveAnother}
                    >
                      Save and add another
                      <kbd aria-hidden="true">{saveAnotherKeys}</kbd>
                    </button>
                  )}
                  <button type="submit" className="action-button">
                    {saving ? 'Saving…' : 'Save session'}
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
