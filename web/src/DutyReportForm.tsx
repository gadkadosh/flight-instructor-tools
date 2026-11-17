import { useEffect, useRef, useState } from 'react';
import { downloadPDF, today } from './documents';

function previousMonth(date: string) {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
}

export default function DutyReportForm({
  id,
  open,
  timeZone,
  onClose,
  onGeneratingChange,
}: {
  id: string;
  open: boolean;
  timeZone: string;
  onClose: () => void;
  onGeneratingChange: (generating: boolean) => void;
}) {
  const [issueDate, setIssueDate] = useState(() => today(timeZone));
  const [month, setMonth] = useState(() => previousMonth(today(timeZone)));
  const [carryOver, setCarryOver] = useState(() => (month.endsWith('-01') ? '0:00' : ''));
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const firstInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) firstInput.current?.focus();
  }, [open]);

  async function generate() {
    if (generating) return;
    setGenerating(true);
    onGeneratingChange(true);
    setError('');
    try {
      await downloadPDF(
        '/api/duty-report',
        { month, carryOverFlightDuty: carryOver.trim(), issueDate },
        `Dienstzeitnachweis-${month}.pdf`,
        'duty report',
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not generate duty report.');
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
      data-kind="dutyReport"
      aria-label="Generate duty report"
      aria-busy={generating}
      onSubmit={(event) => {
        event.preventDefault();
        void generate();
      }}
    >
      <fieldset disabled={generating}>
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
          <button type="submit" className="action-button" disabled={generating}>
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
