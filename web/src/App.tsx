import { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import SessionToolbar from './SessionToolbar';
import SessionEntry from './SessionEntry';
import SessionDelete from './SessionDelete';
import LogbookPrintout from './LogbookPrintout';
import SessionRow, { sessionSummary } from './SessionRow';
import { newSessionDraft, sessionDraft } from './sessionDraft';
import { groupSessionsByMonth, type Session, type SessionView } from './sessions';

type DeleteTarget = { session: Session; trigger: HTMLButtonElement };

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; view: SessionView }
  | { status: 'error'; message: string };

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
  const [showingLogbook, setShowingLogbook] = useState(false);
  // Each open editor keeps the session as it was opened, so saving cannot overwrite a newer version.
  const [editing, setEditing] = useState<ReadonlyMap<string, Session>>(() => new Map());
  const editButtons = useRef(new Map<string, HTMLButtonElement>());
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

  function closeEditor(id: string) {
    flushSync(() =>
      setEditing((previous) => {
        const next = new Map(previous);
        next.delete(id);
        return next;
      }),
    );
    editButtons.current.get(id)?.focus();
  }

  function updateView(nextView: SessionView) {
    setView(nextView);
    setDeleteNotice('');
    const ids = new Set(nextView.sessions.map(({ id }) => id));
    setSelectedSessionIds((previous) => new Set([...previous].filter((id) => ids.has(id))));
    setEditing((previous) => new Map([...previous].filter(([id]) => ids.has(id))));
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
        onShowLogbook={() => setShowingLogbook(true)}
      />
      <div className="visually-hidden" aria-live="polite">
        {deleteNotice}
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
                <SessionEntry
                  view={view}
                  initial={newSessionDraft(view)}
                  onSaved={updateView}
                  onClose={onCloseEntry}
                />
              </tbody>
            )}
            {monthGroups.map(([month, { label, sessions }]) => {
              const allSelected = sessions.every((session) => selectedSessionIds.has(session.id));
              const selectionLabel = `${allSelected ? 'Deselect' : 'Select'} ${sessions.length} ${sessions.length === 1 ? 'session' : 'sessions'}`;
              return (
                <tbody key={month}>
                  <tr className="month-heading">
                    <th scope="rowgroup" colSpan={10} aria-label={label}>
                      {label}
                      <button
                        type="button"
                        className="action-button link"
                        aria-label={`${selectionLabel} in ${label}`}
                        onClick={() => toggleSessions(sessions)}
                      >
                        {selectionLabel}
                      </button>
                    </th>
                  </tr>
                  {sessions.map((session) => {
                    const opened = editing.get(session.id);
                    return opened ? (
                      <SessionEntry
                        key={session.id}
                        view={view}
                        initial={sessionDraft(opened, view.timeZone)}
                        etag={opened.etag}
                        onSaved={updateView}
                        onClose={() => closeEditor(session.id)}
                        onDelete={(trigger) => {
                          setDeleteNotice('');
                          setDeleteTarget({ session: opened, trigger });
                        }}
                      />
                    ) : (
                      <SessionRow
                        key={session.id}
                        session={session}
                        dateFormat={dateFormat}
                        timeFormat={timeFormat}
                        selected={selectedSessionIds.has(session.id)}
                        onSelect={() => toggleSessions([session])}
                        editButtonRef={(button) => {
                          if (button) editButtons.current.set(session.id, button);
                          return () => {
                            editButtons.current.delete(session.id);
                          };
                        }}
                        onEdit={() =>
                          setEditing((previous) => new Map(previous).set(session.id, session))
                        }
                      />
                    );
                  })}
                </tbody>
              );
            })}
          </table>
        </div>
      )}
      <p className="time-note">
        Duty times: <span>{view.timeZone}</span> · Flight times: UTC · Durations H:MM
      </p>
      {showingLogbook && (
        <LogbookPrintout
          sessions={view.sessions.filter(({ id }) => selectedSessionIds.has(id))}
          onClose={() => setShowingLogbook(false)}
        />
      )}
      {deleteTarget && (
        <SessionDelete
          sessionId={deleteTarget.session.id}
          etag={deleteTarget.session.etag}
          description={sessionSummary(deleteTarget.session, dateFormat, timeFormat).description}
          onCancel={() => {
            setDeleteTarget(null);
            deleteTarget.trigger.focus();
          }}
          onDeleted={(nextView) => {
            // Closing the dialog returned focus to the deleted session's editor, so move it before
            // the update.
            if (nextView.sessions.length > 0) tableRegion.current?.focus({ preventScroll: true });
            else onFocusAdd();
            const update = () =>
              flushSync(() => {
                setDeleteTarget(null);
                updateView(nextView);
                setDeleteNotice('Session deleted.');
              });
            // Firefox can't nest view transition groups yet. Once every browser can, drop this check
            // and the @supports wrapper in style.css.
            const region = tableRegion.current;
            const rowsStayInFrame =
              CSS.supports('view-transition-group', 'contain') ||
              !region ||
              region.scrollWidth <= region.clientWidth;
            if (document.startViewTransition && rowsStayInFrame)
              document.startViewTransition(update);
            else update();
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
