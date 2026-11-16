import { useEffect, useId, useRef, useState } from 'react';

function today(timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const value = (type: string) => parts.find((part) => part.type === type)!.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

export default function InvoiceControls({
  selectedSessionIds,
  sessionCount,
  timeZone,
}: {
  selectedSessionIds: string[];
  sessionCount: number;
  timeZone: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [number, setNumber] = useState('');
  const [issueDate, setIssueDate] = useState(() => today(timeZone));
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const formId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const numberInput = useRef<HTMLInputElement>(null);
  const hasSelection = selectedSessionIds.length > 0;

  useEffect(() => {
    if (expanded) numberInput.current?.focus();
  }, [expanded]);

  function close() {
    setExpanded(false);
    setError('');
    trigger.current?.focus();
  }

  async function generate() {
    if (generating || !hasSelection) return;
    setGenerating(true);
    setError('');
    try {
      const response = await fetch('/api/invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionIds: selectedSessionIds, number: number.trim(), issueDate }),
      });
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.error || 'Could not generate invoice.');
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = `Rechnung-${number.trim()}.pdf`;
      document.body.append(link);
      link.click();
      link.remove();
      // Give the browser time to start reading the blob before releasing it.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not generate invoice.');
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="session-toolbar">
      <p className="selection-count" role="status">
        {selectedSessionIds.length} of {sessionCount} {sessionCount === 1 ? 'session' : 'sessions'}{' '}
        selected
      </p>
      <div className="invoice-controls">
        <button
          ref={trigger}
          type="button"
          className={`action-button${expanded ? ' secondary' : ''}`}
          disabled={!hasSelection || generating}
          aria-expanded={expanded}
          aria-controls={formId}
          onClick={() => {
            if (expanded) close();
            else setExpanded(true);
          }}
        >
          Generate invoice
        </button>
        {expanded && (
          <form
            id={formId}
            className="invoice-form"
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
                  ref={numberInput}
                  type="text"
                  required
                  pattern="[0-9]{4}-[0-9]+"
                  title="Year followed by a running number, for example 2026-001"
                  placeholder={`${issueDate.slice(0, 4)}-001`}
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
              <div className="invoice-form-actions">
                <button
                  type="submit"
                  className="action-button"
                  disabled={!hasSelection || generating}
                >
                  {generating ? 'Generating…' : 'Download PDF'}
                </button>
                <button type="button" className="action-button text" onClick={close}>
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
        )}
      </div>
    </div>
  );
}
