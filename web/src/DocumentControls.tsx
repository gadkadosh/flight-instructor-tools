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

function previousMonth(date: string) {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
}

type DocumentKind = 'invoice' | 'dutyReport';

export default function DocumentControls({
  selectedSessionIds,
  sessionCount,
  timeZone,
}: {
  selectedSessionIds: string[];
  sessionCount: number;
  timeZone: string;
}) {
  const [expanded, setExpanded] = useState<DocumentKind | null>(null);
  const [number, setNumber] = useState('');
  const [invoiceIssueDate, setInvoiceIssueDate] = useState(() => today(timeZone));
  const [reportIssueDate, setReportIssueDate] = useState(() => today(timeZone));
  const [month, setMonth] = useState(() => previousMonth(today(timeZone)));
  const [carryOver, setCarryOver] = useState(() => (month.endsWith('-01') ? '0:00' : ''));
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const formId = useId();
  const invoiceTrigger = useRef<HTMLButtonElement>(null);
  const reportTrigger = useRef<HTMLButtonElement>(null);
  const firstInput = useRef<HTMLInputElement>(null);
  const hasSelection = selectedSessionIds.length > 0;
  const isInvoice = expanded === 'invoice';
  const issueDate = isInvoice ? invoiceIssueDate : reportIssueDate;

  useEffect(() => {
    if (expanded) firstInput.current?.focus();
  }, [expanded]);

  function close() {
    setExpanded(null);
    setError('');
    (isInvoice ? invoiceTrigger : reportTrigger).current?.focus();
  }

  function toggle(kind: DocumentKind) {
    if (expanded === kind) close();
    else {
      setExpanded(kind);
      setError('');
    }
  }

  async function generate() {
    if (generating || !expanded || (isInvoice && !hasSelection)) return;
    setGenerating(true);
    setError('');
    const name = isInvoice ? 'invoice' : 'duty report';
    try {
      const response = await fetch(isInvoice ? '/api/invoice' : '/api/duty-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          isInvoice
            ? { sessionIds: selectedSessionIds, number: number.trim(), issueDate }
            : { month, carryOverFlightDuty: carryOver.trim(), issueDate },
        ),
      });
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.error || `Could not generate ${name}.`);
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = isInvoice
        ? `Rechnung-${number.trim()}.pdf`
        : `Dienstzeitnachweis-${month}.pdf`;
      document.body.append(link);
      link.click();
      link.remove();
      // Give the browser time to start reading the blob before releasing it.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setError(error instanceof Error ? error.message : `Could not generate ${name}.`);
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
      <div className="document-buttons">
        <button
          ref={invoiceTrigger}
          type="button"
          className={`action-button${isInvoice ? ' secondary' : ''}`}
          disabled={!hasSelection || generating}
          aria-expanded={isInvoice}
          aria-controls={formId}
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
          aria-controls={formId}
          onClick={() => toggle('dutyReport')}
        >
          Generate duty report
        </button>
      </div>
      {expanded && (
        <form
          id={formId}
          className="document-form"
          data-kind={expanded}
          aria-label={isInvoice ? 'Generate invoice' : 'Generate duty report'}
          aria-busy={generating}
          onSubmit={(event) => {
            event.preventDefault();
            void generate();
          }}
        >
          <fieldset disabled={generating}>
            {isInvoice ? (
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
            ) : (
              <>
                <label>
                  Month
                  <input
                    ref={firstInput}
                    type="month"
                    required
                    pattern="[0-9]{4}-(0[1-9]|1[0-2])"
                    title="Month in YYYY-MM format"
                    value={month}
                    onChange={(event) => {
                      const value = event.target.value;
                      setMonth(value);
                      setCarryOver(value.endsWith('-01') ? '0:00' : '');
                    }}
                  />
                </label>
                <label>
                  Flight-duty total before this month
                  <input
                    type="text"
                    required
                    pattern="[0-9]+:[0-5][0-9]"
                    title="Hours and minutes, for example 120:00 or 0:00"
                    placeholder="H:MM"
                    value={carryOver}
                    onChange={(event) => setCarryOver(event.target.value)}
                  />
                </label>
              </>
            )}
            <label>
              Issue date
              <input
                type="date"
                required
                value={issueDate}
                onChange={(event) =>
                  (isInvoice ? setInvoiceIssueDate : setReportIssueDate)(event.target.value)
                }
              />
            </label>
            <div className="document-form-actions">
              <button
                type="submit"
                className="action-button"
                disabled={(isInvoice && !hasSelection) || generating}
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
  );
}
