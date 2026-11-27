import { useId, useRef, useState, type KeyboardEvent } from 'react';
import InvoiceForm from './InvoiceForm';
import DutyReportForm from './DutyReportForm';
import { useDocumentDownload } from './documents';
import { formatDuration, type Totals } from './sessions';

type DocumentKind = 'invoice' | 'dutyReport';

const totalLabels: Record<keyof Totals, string> = {
  preparation: 'prep',
  block: 'block',
  soloSupervision: 'solo supervision',
};

const foreflightImportUrl = 'https://plan.foreflight.com/logbook#/import';

export default function SessionToolbar({
  selectedSessionIds,
  selectionTotals,
  sessionCount,
  countSessionsInMonth,
  timeZone,
  onClearSelection,
  onShowLogbook,
}: {
  selectedSessionIds: ReadonlySet<string>;
  selectionTotals: Totals;
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
  const selectionHours = Object.entries(selectionTotals)
    .filter(([, minutes]) => minutes > 0)
    .map(([kind, minutes]) => `${formatDuration(minutes)} ${totalLabels[kind as keyof Totals]}`);

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
      {/* Wraps as two whole groups, so neither breaks apart on a narrow window. */}
      <div className="toolbar-row">
        <div className="session-selection">
          <p className="selection-count" ref={selectionStatus} role="status" tabIndex={-1}>
            {selectedSessionIds.size} of {sessionCount} selected
          </p>
          {selectionHours.length > 0 && (
            <p className="selection-hours">· {selectionHours.join(' · ')}</p>
          )}
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
            type="button"
            className="action-button secondary"
            disabled={!hasSelection}
            aria-haspopup="dialog"
            onClick={onShowLogbook}
          >
            Show logbook entries
          </button>
          <button
            type="button"
            className="action-button secondary"
            disabled={documents.generating || !hasSelection}
            onClick={async () => {
              setExpanded(null);
              const downloaded = await documents.download(
                '/api/foreflight',
                { sessionIds: [...selectedSessionIds] },
                'ForeFlight logbook',
              );
              if (downloaded) window.open(foreflightImportUrl, '_blank', 'noopener');
            }}
          >
            Export to ForeFlight
          </button>
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
          {/* The buttons before it use the selection; the duty report covers a month. */}
          <span className="toolbar-separator" aria-hidden="true" />
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
        </div>
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
