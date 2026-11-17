import { useId, useRef, useState, type ReactNode } from 'react';
import InvoiceForm from './InvoiceForm';
import DutyReportForm from './DutyReportForm';

type DocumentKind = 'invoice' | 'dutyReport';

export default function SessionToolbar({
  selectedSessionIds,
  sessionCount,
  timeZone,
  children,
}: {
  selectedSessionIds: string[];
  sessionCount: number;
  timeZone: string;
  children?: ReactNode;
}) {
  const [expanded, setExpanded] = useState<DocumentKind | null>(null);
  const [generating, setGenerating] = useState(false);
  const formId = useId();
  const invoiceTrigger = useRef<HTMLButtonElement>(null);
  const reportTrigger = useRef<HTMLButtonElement>(null);

  function close() {
    setExpanded(null);
    (expanded === 'invoice' ? invoiceTrigger : reportTrigger).current?.focus();
  }

  function toggle(kind: DocumentKind) {
    if (expanded === kind) close();
    else setExpanded(kind);
  }

  return (
    <div className="session-toolbar">
      <p className="selection-count" role="status">
        {selectedSessionIds.length} of {sessionCount} {sessionCount === 1 ? 'session' : 'sessions'}{' '}
        selected
      </p>
      <div className="document-buttons">
        <button
          ref={invoiceTrigger}
          type="button"
          className={`action-button${expanded === 'invoice' ? ' secondary' : ''}`}
          disabled={selectedSessionIds.length === 0 || generating}
          aria-expanded={expanded === 'invoice'}
          aria-controls={`${formId}-invoice`}
          onClick={() => toggle('invoice')}
        >
          Generate invoice
        </button>
        <button
          ref={reportTrigger}
          type="button"
          className={`action-button${expanded === 'dutyReport' ? ' secondary' : ''}`}
          disabled={generating}
          aria-expanded={expanded === 'dutyReport'}
          aria-controls={`${formId}-duty-report`}
          onClick={() => toggle('dutyReport')}
        >
          Generate duty report
        </button>
        {children}
      </div>
      <InvoiceForm
        id={`${formId}-invoice`}
        open={expanded === 'invoice'}
        selectedSessionIds={selectedSessionIds}
        timeZone={timeZone}
        onClose={close}
        onGeneratingChange={setGenerating}
      />
      <DutyReportForm
        id={`${formId}-duty-report`}
        open={expanded === 'dutyReport'}
        timeZone={timeZone}
        onClose={close}
        onGeneratingChange={setGenerating}
      />
    </div>
  );
}
