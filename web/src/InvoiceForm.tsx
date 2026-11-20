import { useEffect, useRef, useState } from 'react';
import type { DocumentDownload } from './documents';
import { dateInZone } from './sessions';

export default function InvoiceForm({
  id,
  open,
  selectedSessionIds,
  timeZone,
  onClose,
  pdf,
}: {
  id: string;
  open: boolean;
  selectedSessionIds: ReadonlySet<string>;
  timeZone: string;
  onClose: () => void;
  pdf: DocumentDownload;
}) {
  const [number, setNumber] = useState('');
  const [issueDate, setIssueDate] = useState(() => dateInZone(timeZone));
  const firstInput = useRef<HTMLInputElement>(null);
  const selectedCount = selectedSessionIds.size;
  const hasSelection = selectedCount > 0;

  useEffect(() => {
    if (open) firstInput.current?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <form
      id={id}
      className="document-form"
      data-kind="invoice"
      aria-label="Generate invoice"
      aria-busy={pdf.generating}
      onSubmit={(event) => {
        event.preventDefault();
        if (!hasSelection) return;
        void pdf.download(
          '/api/invoice',
          { sessionIds: [...selectedSessionIds], number: number.trim(), issueDate },
          `Rechnung-${number.trim()}.pdf`,
          'invoice',
        );
      }}
    >
      <fieldset disabled={pdf.generating}>
        <label>
          Invoice number
          <input
            ref={firstInput}
            type="text"
            required
            pattern="[0-9]{4}-[0-9]+"
            title="Year followed by a running number, for example 2026-01"
            placeholder={`${issueDate.slice(0, 4)}-01`}
            value={number}
            onChange={(event) => setNumber(event.target.value)}
          />
        </label>
        <label>
          Issue date
          <input
            type="date"
            required
            value={issueDate}
            onChange={(event) => setIssueDate(event.target.value)}
          />
        </label>
        <div className="document-form-footer">
          <p id={`${id}-scope`} className="document-scope">
            Includes {selectedCount} selected {selectedCount === 1 ? 'session' : 'sessions'}
          </p>
          <div className="document-form-actions">
            <button type="button" className="action-button text" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="action-button"
              aria-describedby={`${id}-scope`}
              disabled={!hasSelection || pdf.generating}
            >
              {pdf.generating ? 'Generating…' : 'Download PDF'}
            </button>
          </div>
        </div>
      </fieldset>
      {pdf.error && (
        <p role="alert" className="error">
          {pdf.error}
        </p>
      )}
    </form>
  );
}
