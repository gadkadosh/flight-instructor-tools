import { useEffect, useId, useMemo, useRef, useState } from 'react';
import SessionToolbar from './SessionToolbar';
import SessionEntry from './SessionEntry';
import SessionDelete from './SessionDelete';
import {
  activityKinds,
  dateInZone,
  formatDuration,
  groupSessionsByMonth,
  type Session,
  type SessionView,
} from './sessions';

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; view: SessionView }
  | { status: 'error'; message: string };

type DeleteTarget = {
  session: Session;
  description: string;
  trigger: HTMLButtonElement;
};

function SessionRow({
  session,
  dateFormat,
  timeFormat,
  selected,
  onSelect,
  onDelete,
}: {
  session: Session;
  dateFormat: Intl.DateTimeFormat;
  timeFormat: Intl.DateTimeFormat;
  selected: boolean;
  onSelect: () => void;
  onDelete: (target: DeleteTarget) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const endDateId = useId();
  const start = new Date(session.dutyStart);
  const end = new Date(session.dutyEnd);
  const startDate = dateFormat.format(start);
  const endDate = dateFormat.format(end);
  const { timeZone } = timeFormat.resolvedOptions();
  const timeSuffix = timeZone === 'UTC' ? 'Z' : 'LT';
  // Comparing local dates as UTC midnights keeps clock changes out of the day count.
  const endsNextDay =
    endDate !== startDate &&
    Date.parse(dateInZone(timeZone, end)) - Date.parse(dateInZone(timeZone, start)) ===
      24 * 60 * 60 * 1000;
  const flights = session.activities.filter((activity) => activity.type !== 'preparation');
  const subject =
    session.student?.trim() ||
    [...new Set(flights.map((activity) => activityKinds[activity.type].label))].sort().join(' / ');
  const startTime = timeFormat.format(start);
  const description = `${subject} · ${startDate}, ${startTime} ${timeSuffix}`;
  const totals = { preparation: 0, block: 0, soloSupervision: 0 };
  for (const activity of session.activities) {
    totals[activityKinds[activity.type].summary] += activity.minutes;
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
          <label>
            <input
              type="checkbox"
              aria-label={`Select session for ${subject} on ${startDate}`}
              checked={selected}
              onChange={onSelect}
            />
          </label>
        </td>
        <td className="expand-cell">
          {flights.length > 0 && (
            <button
              type="button"
              className="row-toggle"
              aria-expanded={expanded}
              aria-controls={detailsId}
              aria-label={`${expanded ? 'Hide' : 'Show'} flights for ${subject} on ${startDate}`}
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
          {subject}
        </th>
        <td className="numeric">
          <time dateTime={session.dutyStart}>
            {startTime} <span className="time-zone">{timeSuffix}</span>
          </time>
        </td>
        <td className="numeric">
          <time dateTime={session.dutyEnd}>
            {timeFormat.format(end)} <span className="time-zone">{timeSuffix}</span>
            {!endsNextDay && endDate !== startDate && (
              <span className="description">{endDate}</span>
            )}
          </time>
          {endsNextDay && (
            <>
              {' '}
              <button
                type="button"
                className="next-day"
                popoverTarget={endDateId}
                aria-describedby={endDateId}
                title={endDate}
                onClick={(event) => event.stopPropagation()}
              >
                +1 day
              </button>
              <span
                id={endDateId}
                className="next-day-date"
                popover="auto"
                onClick={(event) => event.stopPropagation()}
              >
                End date {endDate}
              </span>
            </>
          )}
        </td>
        <td className="numeric">{formatDuration(totals.preparation)}</td>
        <td className="numeric">{formatDuration(totals.block)}</td>
        <td className="numeric">{formatDuration(totals.soloSupervision)}</td>
        <td className="row-actions" onClick={(event) => event.stopPropagation()}>
          <button
            className="action-button icon danger"
            type="button"
            aria-label={`Delete session for ${description}`}
            aria-haspopup="dialog"
            title="Delete session"
            onClick={(event) => onDelete({ session, description, trigger: event.currentTarget })}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M10 11v6" />
              <path d="M14 11v6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
              <path d="M3 6h18" />
              <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
          </button>
        </td>
      </tr>
      <tr id={detailsId} hidden={!expanded} className="activity-details">
        <td colSpan={10}>
          <table className="flight-table" aria-label={`Flights for ${subject} on ${startDate}`}>
            <thead>
              <tr>
                <th scope="col">Type</th>
                <th scope="col" className="numeric">
                  Duration
                </th>
              </tr>
            </thead>
            <tbody>
              {flights.map((activity, index) => (
                <tr key={index}>
                  <th scope="row">{activityKinds[activity.type].label}</th>
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

function SessionTable({
  view: initialView,
  adding,
  onCloseEntry,
  onFocusAdd,
}: {
  view: SessionView;
  adding: boolean;
  onCloseEntry: () => void;
  onFocusAdd: () => void;
}) {
  const [view, setView] = useState(initialView);
  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(() => new Set());
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [deleteNotice, setDeleteNotice] = useState('');
  const tableRegion = useRef<HTMLDivElement>(null);
  const monthGroups = useMemo(
    () => groupSessionsByMonth(view.sessions, view.timeZone),
    [view.sessions, view.timeZone],
  );
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

  function toggleSessions(sessions: Session[]) {
    setSelectedSessionIds((previous) => {
      const allSelected = sessions.every((session) => previous.has(session.id));
      const next = new Set(previous);
      for (const { id } of sessions) {
        if (allSelected) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }

  function updateView(nextView: SessionView) {
    setView(nextView);
    setDeleteNotice('');
    setSelectedSessionIds(
      (previous) => new Set(nextView.sessions.map(({ id }) => id).filter((id) => previous.has(id))),
    );
  }

  return (
    <>
      <SessionToolbar
        selectedSessionIds={selectedSessionIds}
        sessionCount={view.sessions.length}
        countSessionsInMonth={(month) =>
          monthGroups.find(([key]) => key === month)?.[1].sessions.length ?? 0
        }
        timeZone={view.timeZone}
        onClearSelection={() => setSelectedSessionIds(new Set())}
      />
      <div aria-live="polite">
        {deleteNotice && <p className="session-notice">{deleteNotice}</p>}
      </div>
      {view.sessions.length === 0 && <p role="status">No sessions yet.</p>}
      {(view.sessions.length > 0 || adding) && (
        <div
          className="table-scroll"
          role="region"
          aria-label="Sessions table"
          tabIndex={0}
          ref={tableRegion}
        >
          <table className="sessions-table">
            <colgroup>
              <col className="select-column" />
              <col className="expand-column" />
              <col className="date-column" />
              <col />
              <col className="time-column" span={5} />
              <col className="actions-column" />
            </colgroup>
            <caption className="visually-hidden">Sessions by month</caption>
            <thead>
              <tr>
                <th scope="col" className="select-cell">
                  <span className="visually-hidden">Selection</span>
                </th>
                <th scope="col" className="expand-cell">
                  <span className="visually-hidden">Details</span>
                </th>
                <th scope="col">Date</th>
                <th scope="col">Student / flight</th>
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
                  Block time
                </th>
                <th scope="col" className="numeric">
                  Solo supervision
                </th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            {adding && (
              <tbody>
                <SessionEntry view={view} onSaved={updateView} onClose={onCloseEntry} />
              </tbody>
            )}
            {monthGroups.map(([month, { label, sessions }]) => {
              const allSelected = sessions.every((session) => selectedSessionIds.has(session.id));
              const selectionLabel = `${allSelected ? 'Deselect' : 'Select'} ${sessions.length} ${sessions.length === 1 ? 'session' : 'sessions'}`;
              return (
                <tbody key={month}>
                  <tr className="month-heading">
                    <th scope="rowgroup" colSpan={10} aria-label={label}>
                      <div className="month-heading-content">
                        {label}
                        <button
                          type="button"
                          className="action-button secondary"
                          aria-label={`${selectionLabel} in ${label}`}
                          data-selected={allSelected}
                          onClick={() => toggleSessions(sessions)}
                        >
                          {selectionLabel}
                        </button>
                      </div>
                    </th>
                  </tr>
                  {sessions.map((session) => (
                    <SessionRow
                      key={session.id}
                      session={session}
                      dateFormat={dateFormat}
                      timeFormat={timeFormat}
                      selected={selectedSessionIds.has(session.id)}
                      onSelect={() => toggleSessions([session])}
                      onDelete={(target) => {
                        setDeleteNotice('');
                        setDeleteTarget(target);
                      }}
                    />
                  ))}
                </tbody>
              );
            })}
          </table>
        </div>
      )}
      <p className="time-note">
        Duty times: <span>{view.timeZone}</span> · Durations H:MM
      </p>
      {deleteTarget && (
        <SessionDelete
          sessionId={deleteTarget.session.id}
          etag={deleteTarget.session.etag}
          description={deleteTarget.description}
          onCancel={() => {
            setDeleteTarget(null);
            deleteTarget.trigger.focus();
          }}
          onDeleted={(nextView) => {
            setDeleteTarget(null);
            updateView(nextView);
            setDeleteNotice('Session deleted.');
            if (nextView.sessions.length > 0) tableRegion.current?.focus({ preventScroll: true });
            else onFocusAdd();
          }}
        />
      )}
    </>
  );
}

export default function App() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [adding, setAdding] = useState(false);
  const addButtonRef = useRef<HTMLButtonElement>(null);

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
        <div className="session-heading">
          <h1>Sessions</h1>
          {state.status === 'ready' && (
            <button
              type="button"
              className="action-button icon"
              ref={addButtonRef}
              aria-label="Add session"
              title="Add session"
              aria-expanded={adding}
              onClick={() => setAdding(true)}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                aria-hidden="true"
                focusable="false"
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
          )}
        </div>
      </header>
      {state.status === 'loading' && <p role="status">Loading sessions…</p>}
      {state.status === 'error' && (
        <p role="alert" className="error">
          {state.message}
        </p>
      )}
      {state.status === 'ready' && (
        <SessionTable
          view={state.view}
          adding={adding}
          onFocusAdd={() => addButtonRef.current?.focus()}
          onCloseEntry={() => {
            setAdding(false);
            addButtonRef.current?.focus();
          }}
        />
      )}
    </main>
  );
}
