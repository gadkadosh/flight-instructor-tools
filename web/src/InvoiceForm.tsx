import { useEffect, useRef, useState } from 'react';
import { downloadPDF, today } from './documents';

export default function InvoiceForm({
  id,
  open,
  selectedSessionIds,
  timeZone,
  onClose,
  onGeneratingChange,
}: {
  id: string;
  open: boolean;
  selectedSessionIds: string[];
  timeZone: string;
  onClose: () => void;
  onGeneratingChange: (generating: boolean) => void;
}) {
  const [number, setNumber] = useState('');
  const [issueDate, setIssueDate] = useState(() => today(timeZone));
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const firstInput = useRef<HTMLInputElement>(null);
  const hasSelection = selectedSessionIds.length > 0;

  useEffect(() => {
    if (open) firstInput.current?.focus();
  }, [open]);

  async function generate() {
    if (generating || !hasSelection) return;
    setGenerating(true);
    onGeneratingChange(true);
    setError('');
    try {
      await downloadPDF(
        '/api/invoice',
        { sessionIds: selectedSessionIds, number: number.trim(), issueDate },
        `Rechnung-${number.trim()}.pdf`,
        'invoice',
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not generate invoice.');
    } finally {
      setGenerating(false);
      onGeneratingChange(false);
    }
  }

  if (!open) {
    if (error) setError('');
    return null;
  }

  return (
    <form
      id={id}
      className="document-form"
      data-kind="invoice"
      aria-label="Generate invoice"
      aria-busy={generating}
      onSubmit={(event) => {
        event.preventDefault();
        void generate();
      }}
    >
      <fieldset disabled={generating}>
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
        <div className="document-form-actions">
          <button type="submit" className="action-button" disabled={!hasSelection || generating}>
            {generating ? 'Generating…' : 'Download PDF'}
          </button>
          <button type="button" className="action-button text" onClick={onClose}>
            Cancel
          </button>
        </div>
      </fieldset>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </form>
  );
}
