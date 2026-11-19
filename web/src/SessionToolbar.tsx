import { useId, useRef, useState, type KeyboardEvent } from 'react';
import InvoiceForm from './InvoiceForm';
import DutyReportForm from './DutyReportForm';
import DeleteSessionsForm from './DeleteSessionsForm';
import type { SessionView } from './sessions';

type DocumentKind = 'invoice' | 'dutyReport' | 'delete';

export default function SessionToolbar({
  selectedSessionIds,
  sessionCount,
  countSessionsInMonth,
  timeZone,
  onClearSelection,
  onDeleted,
}: {
  selectedSessionIds: ReadonlySet<string>;
  sessionCount: number;
  countSessionsInMonth: (month: string) => number;
  timeZone: string;
  onClearSelection: () => void;
  onDeleted: (view: SessionView) => void;
}) {
  const [expanded, setExpanded] = useState<DocumentKind | null>(null);
  const [generating, setGenerating] = useState(false);
  const formId = useId();
  const selectionStatus = useRef<HTMLParagraphElement>(null);
  const invoiceTrigger = useRef<HTMLButtonElement>(null);
  const reportTrigger = useRef<HTMLButtonElement>(null);
  const deleteTrigger = useRef<HTMLButtonElement>(null);
  const hasSelection = selectedSessionIds.size > 0;
  const invoiceOpen = expanded === 'invoice';
  const deleteOpen = expanded === 'delete';

  function close() {
    setExpanded(null);
    if (expanded === 'dutyReport') reportTrigger.current?.focus();
    else if (!hasSelection) selectionStatus.current?.focus();
    else (invoiceOpen ? invoiceTrigger : deleteTrigger).current?.focus();
  }

  function toggle(kind: DocumentKind) {
    if (expanded === kind) close();
    else setExpanded(kind);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (
      event.key !== 'Escape' ||
      event.defaultPrevented ||
      event.nativeEvent.isComposing ||
      event.repeat ||
      generating
    )
      return;

    const target = event.target;
    if (!(target instanceof Element) || !target.closest('form')) return;
    // Let open native pickers handle Escape. :is() tolerates browsers without :open.
    if (target.matches(':is(input:open)')) return;

    event.preventDefault();
    close();
  }

  return (
    <div className="session-toolbar" onKeyDown={handleKeyDown}>
      <div className="session-selection">
        <p className="selection-count" ref={selectionStatus} role="status" tabIndex={-1}>
          {selectedSessionIds.size} of {sessionCount} {sessionCount === 1 ? 'session' : 'sessions'}{' '}
          selected
        </p>
        {hasSelection && (
          <button
            type="button"
            className="action-button text"
            onClick={() => {
              onClearSelection();
              selectionStatus.current?.focus();
            }}
          >
            Clear selection
          </button>
        )}
        {(hasSelection || deleteOpen) && (
          <button
            ref={deleteTrigger}
            type="button"
            className="action-button text danger"
            disabled={generating}
            aria-expanded={deleteOpen}
            aria-controls={`${formId}-delete`}
            onClick={() => toggle('delete')}
          >
            Delete…
          </button>
        )}
      </div>
      <div className="document-buttons">
        <button
          ref={invoiceTrigger}
          type="button"
          className="action-button secondary"
          disabled={generating || (!invoiceOpen && !hasSelection)}
          aria-expanded={invoiceOpen}
          aria-controls={`${formId}-invoice`}
          onClick={() => toggle('invoice')}
        >
          Generate invoice…
        </button>
        <button
          ref={reportTrigger}
          type="button"
          className="action-button secondary"
          disabled={generating}
          aria-expanded={expanded === 'dutyReport'}
          aria-controls={`${formId}-duty-report`}
          onClick={() => toggle('dutyReport')}
        >
          Generate duty report…
        </button>
      </div>
      <InvoiceForm
        id={`${formId}-invoice`}
        open={invoiceOpen}
        selectedSessionIds={selectedSessionIds}
        timeZone={timeZone}
        onClose={close}
        onGeneratingChange={setGenerating}
      />
      <DutyReportForm
        id={`${formId}-duty-report`}
        open={expanded === 'dutyReport'}
        countSessionsInMonth={countSessionsInMonth}
        timeZone={timeZone}
        onClose={close}
        onGeneratingChange={setGenerating}
      />
      <DeleteSessionsForm
        id={`${formId}-delete`}
        open={deleteOpen}
        selectedSessionIds={selectedSessionIds}
        onClose={close}
        onDeleted={(view) => {
          setExpanded(null);
          onDeleted(view);
          selectionStatus.current?.focus();
        }}
        onDeletingChange={setGenerating}
      />
    </div>
  );
}
