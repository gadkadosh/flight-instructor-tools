import { useEffect, useRef, useState } from 'react';
import type { DocumentDownload } from './documents';
import { dateInZone, durationPattern, normalizeDuration } from './sessions';

const monthPattern = /^[0-9]{4}-(0[1-9]|1[0-2])$/;
const reportMonthFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  month: 'long',
  year: 'numeric',
});

function previousMonth(date: string) {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
}

export default function DutyReportForm({
  id,
  open,
  countSessionsInMonth,
  timeZone,
  onClose,
  documents,
}: {
  id: string;
  open: boolean;
  countSessionsInMonth: (month: string) => number;
  timeZone: string;
  onClose: () => void;
  documents: DocumentDownload;
}) {
  const [issueDate, setIssueDate] = useState(() => dateInZone(timeZone));
  const [month, setMonth] = useState(() => previousMonth(dateInZone(timeZone)));
  const [carryOver, setCarryOver] = useState(() => (month.endsWith('-01') ? '0:00' : ''));
  const firstInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) firstInput.current?.focus();
  }, [open]);

  if (!open) return null;

  const monthLabel = monthPattern.test(month)
    ? reportMonthFormat.format(new Date(`${month}-01T00:00:00Z`))
    : '';
  const sessionCount = countSessionsInMonth(month);

  return (
    <form
      id={id}
      className="document-form"
      data-kind="dutyReport"
      aria-label="Generate duty report"
      aria-busy={documents.generating}
      onSubmit={(event) => {
        event.preventDefault();
        void documents.download(
          '/api/duty-report',
          { month, carryOverFlightDuty: normalizeDuration(carryOver), issueDate },
          'duty report',
        );
      }}
    >
      <fieldset disabled={documents.generating}>
        <label>
          Month
          <input
            ref={firstInput}
            type="month"
            required
            pattern={monthPattern.source}
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
            pattern={durationPattern.source}
            title="Hours and two digits for minutes, for example 120:45 or 12045"
            placeholder="H:MM or HMM"
            value={carryOver}
            onChange={(event) => setCarryOver(event.target.value)}
            onBlur={() => setCarryOver(normalizeDuration)}
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
            {monthLabel &&
              `Includes ${sessionCount} ${sessionCount === 1 ? 'session' : 'sessions'} in ${monthLabel}`}
          </p>
          <div className="document-form-actions">
            <button type="button" className="action-button text" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="action-button"
              aria-describedby={monthLabel ? `${id}-scope` : undefined}
              disabled={documents.generating}
            >
              {documents.generating ? 'Generating…' : 'Download PDF'}
            </button>
          </div>
        </div>
      </fieldset>
      {documents.error && (
        <p role="alert" className="error">
          {documents.error}
        </p>
      )}
    </form>
  );
}
