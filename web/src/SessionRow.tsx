import { useId, useState } from 'react';
import {
  activityKinds,
  activityMinutes,
  dateInZone,
  flightColumns,
  flightTimeFormat,
  formatDuration,
  type Session,
} from './sessions';

export type DeleteTarget = {
  session: Session;
  description: string;
  trigger: HTMLButtonElement;
};

export default function SessionRow({
  session,
  dateFormat,
  timeFormat,
  selected,
  onSelect,
  onDelete,
}: {
  session: Session;
  dateFormat: Intl.DateTimeFormat;
  timeFormat: Intl.DateTimeFormat;
  selected: boolean;
  onSelect: () => void;
  onDelete: (target: DeleteTarget) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const endDateId = useId();
  const start = new Date(session.dutyStart);
  const end = new Date(session.dutyEnd);
  const startDate = dateFormat.format(start);
  const endDate = dateFormat.format(end);
  const { timeZone } = timeFormat.resolvedOptions();
  const timeSuffix = timeZone === 'UTC' ? 'Z' : 'LT';
  // Comparing local dates as UTC midnights keeps clock changes out of the day count.
  const endsNextDay =
    endDate !== startDate &&
    Date.parse(dateInZone(timeZone, end)) - Date.parse(dateInZone(timeZone, start)) ===
      24 * 60 * 60 * 1000;
  const flights = session.activities.flatMap((activity) =>
    activity.type === 'preparation' ? [] : [activity],
  );
  const subject =
    session.student?.trim() ||
    [...new Set(flights.map((activity) => activityKinds[activity.type].label))].sort().join(' / ');
  const startTime = timeFormat.format(start);
  const description = `${subject} · ${startDate}, ${startTime} ${timeSuffix}`;
  const totals = { preparation: 0, block: 0, soloSupervision: 0 };
  for (const activity of session.activities) {
    totals[activityKinds[activity.type].summary] += activityMinutes(activity);
  }
  return (
    <>
      <tr
        className={flights.length > 0 ? 'session-row' : undefined}
        data-selected={selected}
        onClick={() => {
          if (flights.length > 0) setExpanded(!expanded);
        }}
      >
        <td className="select-cell" onClick={(event) => event.stopPropagation()}>
          <label>
            <input
              type="checkbox"
              aria-label={`Select session for ${subject} on ${startDate}`}
              checked={selected}
              onChange={onSelect}
            />
          </label>
        </td>
        <td className="expand-cell">
          {flights.length > 0 && (
            <button
              type="button"
              className="row-toggle"
              aria-expanded={expanded}
              aria-controls={detailsId}
              aria-label={`${expanded ? 'Hide' : 'Show'} flights for ${subject} on ${startDate}`}
            >
              <svg
                className="chevron"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                focusable="false"
              >
                <path d="m9 6 6 6-6 6" />
              </svg>
            </button>
          )}
        </td>
        <td>
          <time dateTime={session.dutyStart}>{startDate}</time>
        </td>
        <th scope="row" className="session-subject">
          {subject}
        </th>
        <td className="numeric">
          <time dateTime={session.dutyStart}>
            {startTime} <span className="time-zone">{timeSuffix}</span>
          </time>
        </td>
        <td className="numeric">
          <time dateTime={session.dutyEnd}>
            {timeFormat.format(end)} <span className="time-zone">{timeSuffix}</span>
            {!endsNextDay && endDate !== startDate && (
              <span className="description">{endDate}</span>
            )}
          </time>
          {endsNextDay && (
            <>
              {' '}
              <button
                type="button"
                className="next-day"
                popoverTarget={endDateId}
                aria-describedby={endDateId}
                title={endDate}
                onClick={(event) => event.stopPropagation()}
              >
                +1 day
              </button>
              <span
                id={endDateId}
                className="next-day-date"
                popover="auto"
                onClick={(event) => event.stopPropagation()}
              >
                End date {endDate}
              </span>
            </>
          )}
        </td>
        <td className="numeric">{formatDuration(totals.preparation)}</td>
        <td className="numeric">{formatDuration(totals.block)}</td>
        <td className="numeric">{formatDuration(totals.soloSupervision)}</td>
        <td className="row-actions" onClick={(event) => event.stopPropagation()}>
          <button
            className="action-button icon danger"
            type="button"
            aria-label={`Delete session for ${description}`}
            aria-haspopup="dialog"
            title="Delete session"
            onClick={(event) => onDelete({ session, description, trigger: event.currentTarget })}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M10 11v6" />
              <path d="M14 11v6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
              <path d="M3 6h18" />
              <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
          </button>
        </td>
      </tr>
      <tr id={detailsId} hidden={!expanded} className="activity-details">
        <td colSpan={10}>
          <table className="flight-table" aria-label={`Flights for ${subject} on ${startDate}`}>
            <thead>
              <tr>
                {flightColumns.map((column) => (
                  <th key={column.label} scope="col" className={column.className}>
                    {column.label}
                    {'utc' in column && <span className="time-zone"> UTC</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {flights.map((flight) => {
                const time = (value?: string) =>
                  value ? flightTimeFormat.format(new Date(value)) : '–';
                return (
                  <tr key={flight.id}>
                    <th scope="row">{activityKinds[flight.type].label}</th>
                    <td>{flight.registration}</td>
                    <td>{flight.departure}</td>
                    <td>{flight.arrival}</td>
                    <td className="numeric">{time(flight.blockOff)}</td>
                    <td className="numeric">{time(flight.firstTakeoff)}</td>
                    <td className="numeric">{time(flight.lastLanding)}</td>
                    <td className="numeric">{time(flight.blockOn)}</td>
                    <td className="numeric">{flight.landings}</td>
                    <td className="numeric">{formatDuration(activityMinutes(flight))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </td>
      </tr>
    </>
  );
}
