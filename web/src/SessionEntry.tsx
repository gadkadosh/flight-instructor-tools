import { useEffect, useId, useRef, useState, type ComponentProps, type KeyboardEvent } from 'react';
import {
  activityKinds,
  clockPattern,
  dateInZone,
  durationPattern,
  flightColumns,
  formatDuration,
  normalizeDuration,
  parseClock,
  parseDuration,
  type Activity,
  type FlightType,
  type Session,
  type SessionView,
} from './sessions';

type FlightDraft = {
  id: string;
  type: FlightType;
  edited?: boolean;
  blockOff: string;
  blockOn: string;
  landings: string;
  departure: string;
  arrival: string;
  registration: string;
  takeoff: string;
  landing: string;
};
type FlightField = Exclude<keyof FlightDraft, 'id' | 'type' | 'edited'>;
type Carried = Pick<FlightDraft, 'arrival' | 'registration'>;
const clockHint = '24-hour time, for example 0930 or 9:30';
const durationHint = 'Hours and two digits for minutes, for example 1:30 or 130';
const airfieldPattern = /^[A-Za-z0-9]{4}$/;
const landingsPattern = /^[1-9]\d*$/;
const clockInput = {
  pattern: clockPattern.source,
  title: clockHint,
  inputMode: 'numeric',
} as const;
const airfieldInput = {
  pattern: airfieldPattern.source,
  maxLength: 4,
  title: 'Four-character ICAO identifier, for example EDFE',
  placeholder: 'EDFE',
};
const clock = (value: string) => parseClock(value) ?? value;

// The inputs after the type, in the order of flightColumns. Leaving applies `tidy`.
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

// Airfield and aircraft carry over from the previous flight, which usually ends where the next starts.
const newFlight = (previous?: Carried): FlightDraft => ({
  id: crypto.randomUUID(),
  type: 'dual',
  blockOff: '',
  blockOn: '',
  landings: '1',
  departure: previous?.arrival ?? '',
  arrival: previous?.arrival ?? '',
  registration: previous?.registration ?? '',
  takeoff: '',
  landing: '',
});

function lastFlight(sessions: Session[]): Carried | undefined {
  for (const session of sessions.toReversed()) {
    const flight = session.activities.findLast(
      (activity): activity is Exclude<Activity, { type: 'preparation' }> =>
        activity.type !== 'preparation',
    );
    if (flight) return flight;
  }
}
const endDateFormat = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'UTC',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

export default function SessionEntry({
  view,
  onSaved,
  onClose,
}: {
  view: SessionView;
  onSaved: (view: SessionView) => void;
  onClose: () => void;
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
  const [id, setId] = useState(() => crypto.randomUUID());
  const [date, setDate] = useState(() => dateInZone(view.timeZone));
  const [student, setStudent] = useState('');
  const [startInput, setStartInput] = useState('');
  const [endInput, setEndInput] = useState('');
  const [overnightHintDate, setOvernightHintDate] = useState<string>();
  const [preparation, setPreparation] = useState('');
  const [flights, setFlights] = useState<FlightDraft[]>(() => [
    newFlight(lastFlight(view.sessions)),
  ]);
  const [focusFlight, setFocusFlight] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const overnightDateLabel = overnightHintDate
    ? endDateFormat.format(new Date(`${overnightHintDate}T00:00:00Z`))
    : undefined;
  const start = parseClock(startInput);
  const end = parseClock(endInput);
  const overnight = Boolean(date && start && end && end < start);
  let endDate: string | undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const day = new Date(`${date}T00:00:00Z`);
    if (overnight) day.setUTCDate(day.getUTCDate() + 1);
    if (Number.isFinite(day.getTime()) && day.getUTCFullYear() <= 9999) {
      endDate = day.toISOString().slice(0, 10);
    }
  }
  const students = [
    ...new Set(
      view.sessions
        .map((session) => session.student)
        .filter((student): student is string => Boolean(student)),
    ),
  ].sort((a, b) => a.localeCompare(b));
  // Flight times share the session date; when duty runs past midnight, those before duty start fall on the next day.
  const nextDay = (clock: string) => overnight && clock < start!;
  const clockMinutes = (clock: string) => {
    const [hours, minutes] = clock.split(':').map(Number);
    return hours! * 60 + minutes! + (nextDay(clock) ? 24 * 60 : 0);
  };
  function blockMinutes(flight: FlightDraft) {
    const off = parseClock(flight.blockOff);
    const on = parseClock(flight.blockOn);
    if (off && on && clockMinutes(on) > clockMinutes(off))
      return clockMinutes(on) - clockMinutes(off);
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

  function setField(id: string, field: Partial<FlightDraft>) {
    setFlights((previous) =>
      previous.map((item) => (item.id === id ? { ...item, ...field } : item)),
    );
  }

  function addFlight() {
    const flight = newFlight(flights.at(-1) ?? lastFlight(view.sessions));
    setFlights((previous) => [...previous, flight]);
    setFocusFlight(`${flight.id}-blockOff`);
  }

  function shortcut(event: KeyboardEvent) {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      formRef.current?.requestSubmit(repeatRef.current!);
    }
  }

  function updateOvernightHint() {
    if (!saving && !savingRef.current) setOvernightHintDate(overnight ? endDate : undefined);
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
    const inDuty = (clock: string) =>
      clockMinutes(start) <= clockMinutes(clock) && clockMinutes(clock) <= clockMinutes(end);
    const activities: Activity[] =
      prep > 0 ? [{ id: `${id}-prep`, type: 'preparation', minutes: prep }] : [];
    for (const flight of flights) {
      // An untouched row is an unused flight, even with carried-over details.
      if (!flight.edited) continue;
      const field = (name: FlightField) => `${flight.id}-${name}`;
      // Input patterns block submission of malformed times, so undefined means blank.
      const [off, on, takeoff, landing] = [
        flight.blockOff,
        flight.blockOn,
        flight.takeoff,
        flight.landing,
      ].map(parseClock);
      if (!off)
        return invalid('Enter block off as a 24-hour time, such as 0930.', field('blockOff'));
      if (!on) return invalid('Enter block on as a 24-hour time, such as 1030.', field('blockOn'));
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
          clockMinutes(off) <= clockMinutes(takeoff) &&
          clockMinutes(takeoff) < clockMinutes(landing) &&
          clockMinutes(landing) <= clockMinutes(on)
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
      const stamp = (clock: string) => `${nextDay(clock) ? endDate : date}T${clock}`;
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
      const response = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          dutyStart: `${date}T${start}`,
          dutyEnd: `${endDate}T${end}`,
          student: student.trim(),
          activities,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Could not save session.');
      onSaved(body);
      if (another) {
        setStudent('');
        setStartInput('');
        setEndInput('');
        setOvernightHintDate(undefined);
        setId(crypto.randomUUID());
        setPreparation('');
        setFlights([newFlight(lastFlight(body.sessions))]);
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
          <span className="visually-hidden">New session</span>
        </td>
        <td>
          <input
            ref={dateRef}
            form={formId}
            name="date"
            type="date"
            aria-label="Session date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
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
            onChange={(event) => setStudent(event.target.value)}
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
            value={startInput}
            onChange={(event) => setStartInput(event.target.value)}
            onBlur={() => {
              setStartInput((value) => parseClock(value) ?? value);
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
              value={endInput}
              onChange={(event) => setEndInput(event.target.value)}
              onBlur={() => {
                setEndInput((value) => parseClock(value) ?? value);
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
            onChange={(event) => setPreparation(event.target.value)}
            onBlur={() => setPreparation(normalizeDuration)}
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
            aria-label="Add session"
            onSubmit={(event) => {
              event.preventDefault();
              const another = (event.nativeEvent as SubmitEvent).submitter === repeatRef.current;
              void save(another);
            }}
          >
            <fieldset disabled={saving}>
              <legend className="visually-hidden">Flights</legend>
              <table className="flight-table flight-entry-table" aria-label="New session flights">
                <thead>
                  <tr>
                    {flightColumns.map((column) => (
                      <th key={column.label} scope="col" className={column.className}>
                        {column.label}
                      </th>
                    ))}
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
                              edited: true,
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
                              setField(flight.id, { [name]: target.value, edited: true })
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
                          className="action-button secondary"
                          type="button"
                          aria-label={`Remove flight ${index + 1}`}
                          onClick={() => {
                            const remaining = flights.filter((item) => item.id !== flight.id);
                            setFlights(remaining);
                            if (remaining.length > 0)
                              setFocusFlight(
                                `${remaining[Math.min(index, remaining.length - 1)]!.id}-blockOff`,
                              );
                            else document.getElementById(`${formId}-add-flight`)?.focus();
                          }}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button
                className="action-button secondary"
                type="button"
                id={`${formId}-add-flight`}
                onClick={addFlight}
              >
                Add flight
              </button>
              {error && (
                <p role="alert" className="error">
                  {error}
                </p>
              )}
              <div className="entry-actions">
                <button type="submit" className="action-button">
                  {saving ? 'Saving…' : 'Save session'}
                </button>
                <button className="action-button secondary" ref={repeatRef} type="submit">
                  Save and add another
                </button>
                <button className="action-button text" type="button" onClick={onClose}>
                  Cancel
                </button>
                <span className="entry-hint">Ctrl/⌘ + Enter: save and add another</span>
              </div>
            </fieldset>
          </form>
        </td>
      </tr>
    </>
  );
}
