import { useEffect, useId, useRef } from 'react';
import {
  activityKinds,
  activityMinutes,
  flightTimeFormat,
  type Activity,
  type Session,
} from './sessions';

type Entry = Exclude<Activity, { type: 'preparation' }>;

// A time column is two cells, hours and minutes, as the paper logbook splits them.
type Column = {
  label?: string;
  time?: boolean;
  value?: (entry: Entry) => string | number | undefined;
};
type Group = { title: string; columns: Column[] };
type Section = { number: number; groups: Group[] };

const blockTime = (entry: Entry) => activityMinutes(entry);
// Sessions don't record night, so every takeoff and landing counts as day. Every landing follows a
// takeoff.
const dayLandings = (entry: Entry) => entry.landings;
const utcDate = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'UTC',
  day: '2-digit',
  month: '2-digit',
  year: '2-digit',
});

// The EASA logbook's columns on its left and right page. Columns this app has nothing for stay
// empty, so every value sits where it goes on paper.
const pages: Section[][] = [
  [
    {
      number: 1,
      groups: [
        {
          title: 'Date (dd/mm/yy)',
          columns: [{ value: (entry) => utcDate.format(Date.parse(entry.blockOff)) }],
        },
      ],
    },
    {
      number: 2,
      groups: [
        {
          title: 'Departure',
          columns: [
            { label: 'Place', value: (entry) => entry.departure },
            {
              label: 'Time',
              value: (entry) => flightTimeFormat.format(Date.parse(entry.blockOff)),
            },
          ],
        },
      ],
    },
    {
      number: 3,
      groups: [
        {
          title: 'Arrival',
          columns: [
            { label: 'Place', value: (entry) => entry.arrival },
            {
              label: 'Time',
              value: (entry) => flightTimeFormat.format(Date.parse(entry.blockOn)),
            },
          ],
        },
      ],
    },
    {
      number: 4,
      groups: [
        {
          title: 'Aircraft',
          columns: [
            { label: 'Make, model, variant' },
            { label: 'Registration', value: (entry) => entry.registration },
          ],
        },
      ],
    },
    {
      number: 5,
      groups: [
        {
          title: 'Single pilot time',
          // The paper logbook ticks the engine class. The unlabeled columns are spare.
          columns: [{ label: 'SE', value: () => '✓' }, { label: 'ME' }, {}, {}],
        },
        { title: 'Multi-pilot time', columns: [{ time: true }] },
      ],
    },
    {
      number: 6,
      groups: [{ title: 'Total time of flight', columns: [{ time: true, value: blockTime }] }],
    },
    { number: 7, groups: [{ title: 'Name PIC', columns: [{ value: () => 'SELF' }] }] },
    {
      number: 8,
      groups: [
        {
          title: 'Takeoffs',
          columns: [{ label: 'Day', value: dayLandings }, { label: 'Night' }],
        },
        {
          title: 'Landings',
          columns: [{ label: 'Day', value: dayLandings }, { label: 'Night' }],
        },
      ],
    },
  ],
  [
    {
      number: 9,
      groups: [
        {
          title: 'Operational condition time',
          columns: [
            { label: 'Night', time: true },
            { label: 'IFR', time: true },
          ],
        },
      ],
    },
    {
      number: 10,
      groups: [
        {
          title: 'Pilot function time',
          columns: [
            { label: 'Pilot-in-command', time: true, value: blockTime },
            { label: 'Co-pilot', time: true },
            { label: 'Dual', time: true },
            {
              label: 'Instructor',
              time: true,
              value: (entry) =>
                activityKinds[entry.type].dualGiven ? blockTime(entry) : undefined,
            },
          ],
        },
      ],
    },
    {
      number: 11,
      groups: [
        {
          title: 'Synthetic training devices session',
          columns: [
            { label: 'Date (dd/mm/yy)' },
            { label: 'Type' },
            { label: 'Total time of session', time: true },
          ],
        },
      ],
    },
    { number: 12, groups: [{ title: 'Remarks and endorsements', columns: [{}] }] },
  ],
];
const sections = pages.flat();
const groups = sections.flatMap((section) => section.groups);
const columns = groups.flatMap((group) => group.columns);

const span = (columns: Column[]) => columns.reduce((sum, column) => sum + (column.time ? 2 : 1), 0);
const sectionColumns = (section: Section) => section.groups.flatMap((group) => group.columns);
// A group without column labels takes the column label row too.
const labeled = (group: Group) => group.columns.some((column) => column.label);

function cells(column: Column, entry: Entry) {
  const value = column.value?.(entry);
  if (!column.time) return [value ?? ''];
  if (typeof value !== 'number') return ['', ''];
  return [Math.floor(value / 60), String(value % 60).padStart(2, '0')];
}

export default function LogbookPrintout({
  sessions,
  onClose,
}: {
  sessions: Session[];
  onClose: () => void;
}) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const entries = sessions
    .flatMap((session) => session.activities)
    .filter((activity): activity is Entry => activityKinds[activity.type].pic)
    .sort((first, second) => Date.parse(first.blockOff) - Date.parse(second.blockOff));

  useEffect(() => {
    // StrictMode runs this twice, and older browsers throw if the dialog is already open.
    if (!dialog.current?.open) dialog.current?.showModal();
  }, []);

  return (
    <dialog
      className="logbook-dialog"
      ref={dialog}
      aria-labelledby={`${id}-title`}
      // Nothing here can be lost, so a click outside closes it too.
      closedby="any"

      // Every way of closing ends here; the browser returns focus to the trigger.
      onClose={onClose}
    >
      <div className="logbook-heading">
        <div>
          <h2 id={`${id}-title`}>Logbook entries</h2>
          <p>
            {entries.length === 0
              ? 'The selected sessions contain no flights for your logbook.'
              : `${entries.length} ${entries.length === 1 ? 'flight' : 'flights'}, oldest first · Times in UTC`}
          </p>
        </div>
        <button
          type="button"
          className="action-button secondary"
          onClick={() => dialog.current?.close()}
        >
          Close
        </button>
      </div>
      {entries.length > 0 && (
        <div className="logbook-scroll">
          <table className="logbook-table" aria-labelledby={`${id}-title`}>
            {pages.map((page, index) => (
              <colgroup key={index} span={span(page.flatMap(sectionColumns))} />
            ))}
            <thead>
              <tr>
                {sections.map((section) => (
                  <th key={section.number} scope="colgroup" colSpan={span(sectionColumns(section))}>
                    {section.number}
                  </th>
                ))}
              </tr>
              <tr>
                {groups.map((group) => (
                  <th
                    key={group.title}
                    scope="colgroup"
                    rowSpan={labeled(group) ? undefined : 2}
                    colSpan={span(group.columns)}
                  >
                    {group.title}
                  </th>
                ))}
              </tr>
              <tr>
                {groups.filter(labeled).flatMap((group) =>
                  group.columns.map((column, index) => (
                    <th key={`${group.title} ${index}`} scope="col" colSpan={span([column])}>
                      {column.label}
                    </th>
                  )),
                )}
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  {columns.flatMap((column, index) =>
                    cells(column, entry).map((cell, part) => (
                      <td
                        key={`${index}-${part}`}
                        className={column.time ? (part === 0 ? 'hours' : 'minutes') : undefined}
                      >
                        {cell}
                      </td>
                    )),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </dialog>
  );
}
