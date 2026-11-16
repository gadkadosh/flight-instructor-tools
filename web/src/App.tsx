import { useEffect, useId, useState } from 'react';
import SelectionMenu from './SelectionMenu';
import InvoiceControls from './InvoiceControls';

type ActivityType = 'preparation' | 'dual' | 'soloSupervision';

interface Activity {
  id: string;
  type: ActivityType;
  minutes: number;
}

interface Session {
  id: string;
  dutyStart: string;
  dutyEnd: string;
  student?: string;
  description?: string;
  activities: Activity[];
}

interface SessionView {
  sessions: Session[];
  timeZone: string;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; view: SessionView }
  | { status: 'error'; message: string };

const activityLabels: Record<ActivityType, string> = {
  preparation: 'Preparation',
  dual: 'Dual',
  soloSupervision: 'Solo supervision',
};

function formatDuration(minutes: number) {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}

function SessionRow({
  session,
  dateFormat,
  timeFormat,
  selected,
  onSelect,
}: {
  session: Session;
  dateFormat: Intl.DateTimeFormat;
  timeFormat: Intl.DateTimeFormat;
  selected: boolean;
  onSelect: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const start = new Date(session.dutyStart);
  const end = new Date(session.dutyEnd);
  const startDate = dateFormat.format(start);
  const endDate = dateFormat.format(end);
  const timeSuffix = timeFormat.resolvedOptions().timeZone === 'UTC' ? 'Z' : 'LT';
  const flights = session.activities.filter((activity) => activity.type !== 'preparation');
  const totals: Record<ActivityType, number> = { preparation: 0, dual: 0, soloSupervision: 0 };
  for (const activity of session.activities) {
    totals[activity.type] += activity.minutes;
  }
  return (
    <>
      <tr
        className={flights.length > 0 ? 'session-row' : undefined}
        data-selected={selected}
        onClick={() => {
          if (flights.length > 0) setExpanded(!expanded);
        }}
      >
        <td className="select-cell" onClick={(event) => event.stopPropagation()}>
          <input
            type="checkbox"
            aria-label={`Select session for ${session.student || session.description} on ${startDate}`}
            checked={selected}
            onChange={onSelect}
          />
        </td>
        <td className="expand-cell">
          {flights.length > 0 && (
            <button
              type="button"
              className="row-toggle"
              aria-expanded={expanded}
              aria-controls={detailsId}
              aria-label={`${expanded ? 'Hide' : 'Show'} flights for ${session.student || session.description} on ${startDate}`}
            >
              <svg
                className="chevron"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                focusable="false"
              >
                <path d="m9 6 6 6-6 6" />
              </svg>
            </button>
          )}
        </td>
        <td>
          <time dateTime={session.dutyStart}>{startDate}</time>
        </td>
        <th scope="row" className="session-subject">
          {session.student || session.description}
          {session.student && session.description && (
            <span className="description">{session.description}</span>
          )}
        </th>
        <td className="numeric">
          <time dateTime={session.dutyStart}>
            {timeFormat.format(start)} <span className="time-zone">{timeSuffix}</span>
          </time>
        </td>
        <td className="numeric">
          <time dateTime={session.dutyEnd}>
            {timeFormat.format(end)} <span className="time-zone">{timeSuffix}</span>
            {endDate !== startDate && <span className="description">{endDate}</span>}
          </time>
        </td>
        <td className="numeric">{formatDuration(totals.preparation)}</td>
        <td className="numeric">{formatDuration(totals.dual)}</td>
        <td className="numeric">{formatDuration(totals.soloSupervision)}</td>
      </tr>
      <tr id={detailsId} hidden={!expanded} className="activity-details">
        <td colSpan={9}>
          <table
            className="flight-table"
            aria-label={`Flights for ${session.student || session.description} on ${startDate}`}
          >
            <thead>
              <tr>
                <th scope="col">Flight</th>
                <th scope="col">Type</th>
                <th scope="col" className="numeric">
                  Block
                </th>
              </tr>
            </thead>
            <tbody>
              {flights.map((activity, index) => (
                <tr key={index}>
                  <th scope="row" className="flight-number">
                    {index + 1}
                  </th>
                  <td>{activityLabels[activity.type]}</td>
                  <td className="numeric">{formatDuration(activity.minutes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </td>
      </tr>
    </>
  );
}

function SessionTable({ view }: { view: SessionView }) {
  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(() => new Set());
  const dateFormat = new Intl.DateTimeFormat('de-DE', {
    timeZone: view.timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  const timeFormat = new Intl.DateTimeFormat('en-GB', {
    timeZone: view.timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });

  return (
    <>
      {view.sessions.length === 0 ? (
        <p role="status">No sessions yet.</p>
      ) : (
        <>
          <InvoiceControls
            selectedSessionIds={[...selectedSessionIds]}
            sessionCount={view.sessions.length}
            timeZone={view.timeZone}
          />
          <div className="table-scroll" role="region" aria-label="Sessions table" tabIndex={0}>
            <table className="sessions-table">
              <colgroup>
                <col className="select-column" />
                <col className="expand-column" />
                <col className="date-column" />
                <col />
                <col className="time-column" span={5} />
              </colgroup>
              <caption className="visually-hidden">Sessions in file order</caption>
              <thead>
                <tr>
                  <th scope="col" className="select-cell">
                    <SelectionMenu
                      sessions={view.sessions}
                      timeZone={view.timeZone}
                      selectedCount={selectedSessionIds.size}
                      onSelect={(sessions) => {
                        setSelectedSessionIds(new Set(sessions.map((session) => session.id)));
                      }}
                    />
                  </th>
                  <th scope="col" className="expand-cell">
                    <span className="visually-hidden">Details</span>
                  </th>
                  <th scope="col">Date</th>
                  <th scope="col">Student / description</th>
                  <th scope="col" className="numeric">
                    Duty start
                  </th>
                  <th scope="col" className="numeric">
                    Duty end
                  </th>
                  <th scope="col" className="numeric">
                    Preparation
                  </th>
                  <th scope="col" className="numeric">
                    Dual
                  </th>
                  <th scope="col" className="numeric">
                    Solo supervision
                  </th>
                </tr>
              </thead>
              <tbody>
                {view.sessions.map((session) => (
                  <SessionRow
                    key={session.id}
                    session={session}
                    dateFormat={dateFormat}
                    timeFormat={timeFormat}
                    selected={selectedSessionIds.has(session.id)}
                    onSelect={() => {
                      setSelectedSessionIds((previous) => {
                        const next = new Set(previous);
                        if (next.has(session.id)) next.delete(session.id);
                        else next.add(session.id);
                        return next;
                      });
                    }}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <p className="time-note">
        Duty times: <span>{view.timeZone}</span> · Durations H:MM
      </p>
    </>
  );
}

export default function App() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch('/api/sessions', { signal: controller.signal });
        const body = await response.json();
        if (!response.ok) {
          throw new Error(body.error || 'Could not load sessions.');
        }
        if (!controller.signal.aborted) {
          setState({ status: 'ready', view: body });
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setState({
            status: 'error',
            message: error instanceof Error ? error.message : 'Could not load sessions.',
          });
        }
      }
    }
    void load();
    return () => controller.abort();
  }, []);

  return (
    <main>
      <header>
        <p className="app-name">Flight Instructor Tools</p>
        <h1>Sessions</h1>
      </header>
      {state.status === 'loading' && <p role="status">Loading sessions…</p>}
      {state.status === 'error' && (
        <p role="alert" className="error">
          {state.message}
        </p>
      )}
      {state.status === 'ready' && <SessionTable view={state.view} />}
    </main>
  );
}
