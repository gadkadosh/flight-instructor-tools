import { useId, useRef, useState } from 'react';
import InvoiceForm from './InvoiceForm';
import DutyReportForm from './DutyReportForm';

type DocumentKind = 'invoice' | 'dutyReport';

export default function SessionToolbar({
  selectedSessionIds,
  sessionCount,
  countSessionsInMonth,
  timeZone,
  onClearSelection,
}: {
  selectedSessionIds: ReadonlySet<string>;
  sessionCount: number;
  countSessionsInMonth: (month: string) => number;
  timeZone: string;
  onClearSelection: () => void;
}) {
  const [expanded, setExpanded] = useState<DocumentKind | null>(null);
  const [generating, setGenerating] = useState(false);
  const formId = useId();
  const selectionStatus = useRef<HTMLParagraphElement>(null);
  const invoiceTrigger = useRef<HTMLButtonElement>(null);
  const reportTrigger = useRef<HTMLButtonElement>(null);
  const hasSelection = selectedSessionIds.size > 0;
  const invoiceOpen = expanded === 'invoice';

  function close() {
    setExpanded(null);
    if (invoiceOpen && !hasSelection) selectionStatus.current?.focus();
    else (invoiceOpen ? invoiceTrigger : reportTrigger).current?.focus();
  }

  function toggle(kind: DocumentKind) {
    if (expanded === kind) close();
    else setExpanded(kind);
  }

  return (
    <div className="session-toolbar">
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
    </div>
  );
}
