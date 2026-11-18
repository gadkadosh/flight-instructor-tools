import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import {
  activityKinds,
  dateInZone,
  formatDuration,
  parseClock,
  parseDuration,
  type Activity,
  type ActivityType,
  type SessionView,
} from './sessions';

type FlightDraft = { id: string; type: Exclude<ActivityType, 'preparation'>; duration: string };
const newFlight = (): FlightDraft => ({ id: crypto.randomUUID(), type: 'dual', duration: '' });
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
  const [startInput, setStartInput] = useState('');
  const [endInput, setEndInput] = useState('');
  const [preparation, setPreparation] = useState('');
  const [flights, setFlights] = useState<FlightDraft[]>(() => [newFlight()]);
  const [focusFlight, setFocusFlight] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
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
  const overnightEnd = overnight ? endDate : undefined;
  const students = [
    ...new Set(
      view.sessions
        .map((session) => session.student)
        .filter((student): student is string => Boolean(student)),
    ),
  ].sort((a, b) => a.localeCompare(b));
  const totals = { preparation: 0, block: 0, soloSupervision: 0 };
  for (const flight of flights) {
    totals[activityKinds[flight.type].summary] += parseDuration(flight.duration) ?? 0;
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

  function addFlight() {
    const flight = newFlight();
    setFlights((previous) => [...previous, flight]);
    setFocusFlight(flight.id);
  }

  function shortcut(event: KeyboardEvent) {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      formRef.current?.requestSubmit(repeatRef.current!);
    }
  }

  async function save(form: HTMLFormElement, another: boolean) {
    if (savingRef.current) return;
    setError('');
    const data = new FormData(form);
    const text = (name: string) => {
      const value = data.get(name);
      return typeof value === 'string' ? value.trim() : '';
    };
    function invalid(message: string, name: string) {
      setError(message);
      (form.elements.namedItem(name) as HTMLElement | null)?.focus();
    }
    if (!endDate) {
      return invalid('Enter a valid session date and duty end within years 0001–9999.', 'date');
    }
    if (!start) return invalid('Enter a duty start such as 0900 or 09:00.', 'start');
    if (!end) return invalid('Enter a duty end such as 1730 or 17:30.', 'end');
    if (start === end) return invalid('Duty end must differ from duty start.', 'end');
    const prep = parseDuration(preparation);
    if (prep === undefined) return invalid('Enter preparation in minutes or H:MM.', 'preparation');
    const activities: Activity[] =
      prep > 0 ? [{ id: `${id}-prep`, type: 'preparation', minutes: prep }] : [];
    for (const flight of flights) {
      if (!flight.duration.trim()) continue;
      const minutes = parseDuration(flight.duration);
      if (minutes === undefined || minutes <= 0) {
        return invalid('Enter a positive flight duration in minutes or H:MM.', flight.id);
      }
      activities.push({ id: flight.id, type: flight.type, minutes });
    }
    if (activities.length === 0) {
      return invalid('Enter preparation time or at least one flight.', 'preparation');
    }
    const hasFlight = activities.some((activity) => activity.type !== 'preparation');
    if (
      !text('student') &&
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
          dutyStart: `${text('date')}T${start}`,
          dutyEnd: `${endDate}T${end}`,
          student: text('student'),
          activities,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Could not save session.');
      onSaved(body);
      if (another) {
        form.reset();
        setStartInput('');
        setEndInput('');
        setId(crypto.randomUUID());
        setPreparation('');
        setFlights([newFlight()]);
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
            inputMode="numeric"
            required
            value={startInput}
            onChange={(event) => setStartInput(event.target.value)}
            onBlur={() => setStartInput(start ?? startInput)}
            disabled={saving}
          />
        </td>
        <td>
          <input
            form={formId}
            name="end"
            aria-label="Duty end"
            aria-describedby={overnightEnd ? overnightHintId : undefined}
            placeholder="1730"
            inputMode="numeric"
            required
            value={endInput}
            onChange={(event) => setEndInput(event.target.value)}
            onBlur={() => setEndInput(end ?? endInput)}
            disabled={saving}
          />
        </td>
        <td>
          <input
            form={formId}
            name="preparation"
            aria-label="Preparation duration"
            placeholder="Minutes"
            inputMode="numeric"
            value={preparation}
            onChange={(event) => setPreparation(event.target.value)}
            disabled={saving}
          />
        </td>
        <td className="numeric">
          <span aria-label="Block time total">{formatDuration(totals.block)}</span>
        </td>
        <td className="numeric">
          <span aria-label="Solo supervision total">{formatDuration(totals.soloSupervision)}</span>
        </td>
      </tr>
      <tr className="activity-details entry-details" onKeyDown={shortcut}>
        <td colSpan={9}>
          <form
            id={formId}
            ref={formRef}
            aria-label="Add session"
            onSubmit={(event) => {
              event.preventDefault();
              const another = (event.nativeEvent as SubmitEvent).submitter === repeatRef.current;
              void save(event.currentTarget, another);
            }}
          >
            <div aria-live="polite">
              {overnightEnd && (
                <p id={overnightHintId} className="entry-overnight">
                  Duty ends the next day (
                  <time dateTime={overnightEnd}>
                    {endDateFormat.format(new Date(`${overnightEnd}T00:00:00Z`))}
                  </time>
                  ).
                </p>
              )}
            </div>
            <fieldset disabled={saving}>
              <legend className="visually-hidden">Flights</legend>
              <table className="flight-table flight-entry-table" aria-label="New session flights">
                <thead>
                  <tr>
                    <th scope="col">Flight</th>
                    <th scope="col">Type</th>
                    <th scope="col" className="numeric">
                      Block
                    </th>
                    <th scope="col">
                      <span className="visually-hidden">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {flights.map((flight, index) => (
                    <tr key={flight.id}>
                      <th scope="row" className="flight-number">
                        {index + 1}
                      </th>
                      <td>
                        <select
                          aria-label={`Flight ${index + 1} type`}
                          value={flight.type}
                          onChange={(event) => {
                            const type = event.target.value as FlightDraft['type'];
                            setFlights((previous) =>
                              previous.map((item) =>
                                item.id === flight.id ? { ...item, type } : item,
                              ),
                            );
                          }}
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
                      <td className="numeric">
                        <input
                          id={flight.id}
                          name={flight.id}
                          aria-label={`Flight ${index + 1} duration`}
                          placeholder="Minutes / H:MM"
                          inputMode="numeric"
                          value={flight.duration}
                          onChange={(event) => {
                            const duration = event.target.value;
                            setFlights((previous) =>
                              previous.map((item) =>
                                item.id === flight.id ? { ...item, duration } : item,
                              ),
                            );
                          }}
                        />
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
                              setFocusFlight(remaining[Math.min(index, remaining.length - 1)]!.id);
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
