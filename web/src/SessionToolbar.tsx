import { useId, useRef, useState } from 'react';
import InvoiceForm from './InvoiceForm';
import DutyReportForm from './DutyReportForm';
import SelectionMenu from './SelectionMenu';
import type { Session } from './sessions';

type DocumentKind = 'invoice' | 'dutyReport';

export default function SessionToolbar({
  selectedSessionIds,
  sessions,
  timeZone,
  onSelectionChange,
}: {
  selectedSessionIds: ReadonlySet<string>;
  sessions: Session[];
  timeZone: string;
  onSelectionChange: (sessionIds: Set<string>) => void;
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
      <div className="session-selection">
        {sessions.length > 0 && (
          <SelectionMenu
            sessions={sessions}
            timeZone={timeZone}
            onSelectionChange={onSelectionChange}
          />
        )}
        <p className="selection-count" role="status">
          {selectedSessionIds.size} of {sessions.length}{' '}
          {sessions.length === 1 ? 'session' : 'sessions'} selected
        </p>
      </div>
      <div className="document-buttons">
        <button
          ref={invoiceTrigger}
          type="button"
          className="action-button secondary"
          disabled={selectedSessionIds.size === 0 || generating}
          aria-expanded={expanded === 'invoice'}
          aria-controls={`${formId}-invoice`}
          onClick={() => toggle('invoice')}
        >
          Generate invoice
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
          Generate duty report
        </button>
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
