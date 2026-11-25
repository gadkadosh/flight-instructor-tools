import { useId, useRef, useState, type KeyboardEvent } from 'react';
import InvoiceForm from './InvoiceForm';
import DutyReportForm from './DutyReportForm';
import { useDocumentDownload } from './documents';

type DocumentKind = 'invoice' | 'dutyReport';

export default function SessionToolbar({
  selectedSessionIds,
  sessionCount,
  countSessionsInMonth,
  timeZone,
  onClearSelection,
  onShowLogbook,
}: {
  selectedSessionIds: ReadonlySet<string>;
  sessionCount: number;
  countSessionsInMonth: (month: string) => number;
  timeZone: string;
  onClearSelection: () => void;
  onShowLogbook: () => void;
}) {
  const [expanded, setExpanded] = useState<DocumentKind | null>(null);
  const documents = useDocumentDownload();
  const formId = useId();
  const selectionStatus = useRef<HTMLParagraphElement>(null);
  const invoiceTrigger = useRef<HTMLButtonElement>(null);
  const reportTrigger = useRef<HTMLButtonElement>(null);
  const hasSelection = selectedSessionIds.size > 0;
  const invoiceOpen = expanded === 'invoice';

  function close() {
    setExpanded(null);
    documents.clearError();
    if (invoiceOpen && !hasSelection) selectionStatus.current?.focus();
    else (invoiceOpen ? invoiceTrigger : reportTrigger).current?.focus();
  }

  function toggle(kind: DocumentKind) {
    if (expanded === kind) close();
    else {
      setExpanded(kind);
      documents.clearError();
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (
      event.key !== 'Escape' ||
      event.defaultPrevented ||
      event.nativeEvent.isComposing ||
      event.repeat ||
      documents.generating
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
            className="action-button link"
            onClick={() => {
              onClearSelection();
              selectionStatus.current?.focus();
            }}
          >
            Clear selection
          </button>
        )}
      </div>
      <div className="document-buttons">
        <button
          ref={invoiceTrigger}
          type="button"
          className="action-button secondary"
          disabled={documents.generating || (!invoiceOpen && !hasSelection)}
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
          disabled={documents.generating}
          aria-expanded={expanded === 'dutyReport'}
          aria-controls={`${formId}-duty-report`}
          onClick={() => toggle('dutyReport')}
        >
          Generate duty report…
        </button>
        <button
          type="button"
          className="action-button secondary"
          disabled={documents.generating || !hasSelection}
          onClick={() => {
            setExpanded(null);
            void documents.download(
              '/api/foreflight',
              { sessionIds: [...selectedSessionIds] },
              'ForeFlight logbook',
            );
          }}
        >
          Export to ForeFlight
        </button>
        <button
          type="button"
          className="action-button secondary"
          disabled={!hasSelection}
          aria-haspopup="dialog"
          onClick={onShowLogbook}
        >
          Show logbook entries
        </button>
      </div>
      {expanded === null && documents.error && (
        <p role="alert" className="error">
          {documents.error}
        </p>
      )}
      <InvoiceForm
        id={`${formId}-invoice`}
        open={invoiceOpen}
        selectedSessionIds={selectedSessionIds}
        timeZone={timeZone}
        onClose={close}
        documents={documents}
      />
      <DutyReportForm
        id={`${formId}-duty-report`}
        open={expanded === 'dutyReport'}
        countSessionsInMonth={countSessionsInMonth}
        timeZone={timeZone}
        onClose={close}
        documents={documents}
      />
    </div>
  );
}
