import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vite-plus/test';
import { page, userEvent } from 'vite-plus/test/browser';
import App from './App';
import type { Session } from './sessions';
import './style.css';

afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  await page.viewport(1280, 720);
});

function sessionAPI(sessions: Session[] = []) {
  const entries: Omit<Session, 'etag'>[] = [];
  const fetch = vi.fn(async (_url: string, options?: RequestInit) => {
    if (options?.method === 'POST') {
      const entry = JSON.parse(options.body as string) as Omit<Session, 'etag'>;
      entries.push(entry);
      // Like the server, read wall-clock entry times as instants (in UTC here).
      const instant = (value: string) => `${value}:00Z`;
      sessions = [
        ...sessions,
        {
          ...entry,
          etag: `"${entry.id}"`,
          dutyStart: instant(entry.dutyStart),
          dutyEnd: instant(entry.dutyEnd),
          activities: entry.activities.map((activity) =>
            activity.type === 'preparation'
              ? activity
              : {
                  ...activity,
                  blockOff: instant(activity.blockOff),
                  blockOn: instant(activity.blockOn),
                },
          ),
        },
      ];
    }
    return Response.json({ sessions, timeZone: 'UTC' });
  });
  vi.stubGlobal('fetch', fetch);
  return { fetch, entries };
}

async function openEntry() {
  render(<App />);
  await userEvent.click(await screen.findByRole('button', { name: 'Add session' }));
}

const previousSession: Session = {
  id: 'previous',
  etag: '"previous"',
  student: 'Earlier Student',
  dutyStart: '2026-05-02T09:00:00Z',
  dutyEnd: '2026-05-02T11:00:00Z',
  activities: [
    {
      id: 'previous-flight',
      type: 'dual',
      blockOff: '2026-05-02T09:30:00Z',
      blockOn: '2026-05-02T10:30:00Z',
      departure: 'EDFE',
      arrival: 'EDFZ',
      registration: 'D-EKLM',
      landings: 1,
    },
  ],
};

const value = (label: string) => screen.getByLabelText<HTMLInputElement>(label).value;

async function fillFlight(number: number, blockOff: string, blockOn: string) {
  await userEvent.fill(screen.getByLabelText(`Flight ${number} block off`), blockOff);
  await userEvent.fill(screen.getByLabelText(`Flight ${number} block on`), blockOn);
  await userEvent.fill(screen.getByLabelText(`Flight ${number} departure`), 'EDFE');
  await userEvent.fill(screen.getByLabelText(`Flight ${number} arrival`), 'EDFE');
  await userEvent.fill(screen.getByLabelText(`Flight ${number} registration`), 'D-EFTI');
}

async function fillBasics() {
  await userEvent.fill(screen.getByLabelText('Session date'), '2026-05-03');
  await userEvent.fill(screen.getByLabelText('Student'), 'New Student');
  await userEvent.fill(screen.getByLabelText('Duty start'), '0900');
  await userEvent.fill(screen.getByLabelText('Duty end'), '1230');
}

function flightColumns(table: HTMLElement) {
  return within(table)
    .getAllByRole('columnheader')
    .slice(0, 2)
    .map((header) => {
      const { x, width } = header.getBoundingClientRect();
      return { x, width, align: getComputedStyle(header).textAlign };
    });
}

test('enters a session by keyboard, calculates block times, and saves individual flights', async () => {
  const { entries } = sessionAPI([previousSession]);
  await openEntry();
  const editor = screen.getByRole('table', { name: 'New session flights' });
  expect(
    within(editor)
      .getAllByRole('columnheader')
      .map((header) => header.textContent),
  ).toEqual([
    'Type',
    'Block off',
    'Block on',
    'Landings',
    'From',
    'To',
    'Aircraft',
    'Takeoff',
    'Landing',
    'Block',
    'Actions',
  ]);
  const editorColumns = flightColumns(editor);
  expect(document.activeElement).toBe(screen.getByLabelText('Session date'));
  await userEvent.fill(screen.getByLabelText('Session date'), '2026-05-03');
  await userEvent.fill(screen.getByLabelText('Student'), 'New Student');
  await userEvent.keyboard('{Tab}0900{Tab}1230{Tab}30{Tab}');
  expect(document.activeElement).toBe(screen.getByLabelText('Flight 1 type'));
  expect(value('Duty start')).toBe('09:00');
  expect(value('Duty end')).toBe('12:30');
  expect(value('Preparation duration')).toBe('0:30');
  // The last logged flight ended at EDFZ in D-EKLM.
  expect(
    ['departure', 'arrival', 'registration', 'landings'].map((field) => value(`Flight 1 ${field}`)),
  ).toEqual(['EDFZ', 'EDFZ', 'D-EKLM', '1']);
  await userEvent.keyboard('{Tab}945{Tab}1030{Tab}5{Tab}');
  expect(document.activeElement).toBe(screen.getByLabelText('Flight 1 departure'));
  expect(value('Flight 1 block off')).toBe('09:45');
  expect(screen.getByLabelText('Flight 1 block time').textContent).toBe('0:45');
  await userEvent.click(screen.getByRole('button', { name: 'Add flight' }));
  expect(document.activeElement).toBe(screen.getByLabelText('Flight 2 block off'));
  await userEvent.keyboard('1040{Tab}1155');
  expect(screen.getByLabelText('Block time total').textContent).toBe('2:00');
  expect(screen.getByLabelText('Block time total').tagName).toBe('SPAN');
  await userEvent.click(screen.getByRole('button', { name: 'Add flight' }));
  await userEvent.selectOptions(screen.getByLabelText('Flight 3 type'), 'soloSupervision');
  expect(value('Flight 2 block on')).toBe('11:55');
  await userEvent.fill(screen.getByLabelText('Flight 3 block off'), '1200');
  await userEvent.fill(screen.getByLabelText('Flight 3 block on'), '1220');
  await userEvent.fill(screen.getByLabelText('Flight 3 takeoff time'), '1203');
  await userEvent.fill(screen.getByLabelText('Flight 3 landing time'), '1218');
  await userEvent.fill(screen.getByLabelText('Flight 3 arrival'), 'edfe');
  expect(value('Flight 3 arrival')).toBe('EDFE');
  expect(screen.getByLabelText('Solo supervision total').textContent).toBe('0:20');
  await userEvent.click(screen.getByRole('button', { name: 'Save session' }));

  await screen.findByRole('rowheader', { name: 'New Student' });
  expect(entries).toHaveLength(1);
  const carried = { departure: 'EDFZ', registration: 'D-EKLM' };
  expect(entries[0]).toMatchObject({
    dutyStart: '2026-05-03T09:00',
    dutyEnd: '2026-05-03T12:30',
    student: 'New Student',
    activities: [
      { type: 'preparation', minutes: 30 },
      {
        type: 'dual',
        blockOff: '2026-05-03T09:45',
        blockOn: '2026-05-03T10:30',
        arrival: 'EDFZ',
        landings: 5,
        ...carried,
      },
      {
        type: 'dual',
        blockOff: '2026-05-03T10:40',
        blockOn: '2026-05-03T11:55',
        arrival: 'EDFZ',
        landings: 1,
        ...carried,
      },
      {
        type: 'soloSupervision',
        blockOff: '2026-05-03T12:00',
        blockOn: '2026-05-03T12:20',
        firstTakeoff: '2026-05-03T12:03',
        lastLanding: '2026-05-03T12:18',
        arrival: 'EDFE',
        ...carried,
      },
    ],
  });
  expect(entries[0]!.activities[1]).not.toHaveProperty('firstTakeoff');
  expect(entries[0]!.activities[1]).not.toHaveProperty('minutes');
  expect(new Set(entries[0]!.activities.map((activity) => activity.id)).size).toBe(4);
  expect(screen.queryByRole('form', { name: 'Add session' })).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add session' }));
  await userEvent.click(screen.getByRole('button', { name: /Show flights for New Student/ }));
  const flights = screen.getByRole('table', { name: /Flights for New Student/ });
  expect(flightColumns(flights)).toEqual(editorColumns);
  expect(within(flights).getAllByRole('row')).toHaveLength(4);
  expect(within(flights).getByText('1:15')).toBeTruthy();
});

test('rejects block times out of order without saving', async () => {
  const { entries } = sessionAPI();
  await openEntry();
  await fillBasics();
  await fillFlight(1, '1000', '1100');
  const save = () => userEvent.click(screen.getByRole('button', { name: 'Save session' }));
  for (const [label, time, message, focus] of [
    ['block on', '1000', 'Block on must be after block off.', 'block on'],
    ['block on', '0930', 'Block on must be after block off.', 'block on'],
    ['takeoff time', '1005', 'Enter both takeoff and landing times, or neither.', 'takeoff time'],
    ['landing time', '1005', 'Takeoff and landing must be within the block', 'takeoff time'],
    ['takeoff time', '0955', 'Takeoff and landing must be within the block', 'takeoff time'],
    ['landing time', '1101', 'Takeoff and landing must be within the block', 'takeoff time'],
  ] as const) {
    if (label === 'landing time')
      await userEvent.fill(screen.getByLabelText('Flight 1 takeoff time'), '1005');
    await userEvent.fill(screen.getByLabelText(`Flight 1 ${label}`), time);
    await save();
    expect(screen.getByRole('alert').textContent).toContain(message);
    expect(document.activeElement).toBe(screen.getByLabelText(`Flight 1 ${focus}`));
    if (label === 'block on')
      await userEvent.fill(screen.getByLabelText('Flight 1 block on'), '1100');
  }
  expect(entries).toHaveLength(0);
  await userEvent.fill(screen.getByLabelText('Flight 1 landing time'), '1100');
  await userEvent.fill(screen.getByLabelText('Flight 1 takeoff time'), '1000');
  await userEvent.clear(screen.getByLabelText('Flight 1 arrival'));
  await save();
  expect(screen.getByRole('alert').textContent).toContain('ICAO');
  expect(document.activeElement).toBe(screen.getByLabelText('Flight 1 arrival'));
  await userEvent.fill(screen.getByLabelText('Flight 1 arrival'), 'EDFZ');
  await save();
  await screen.findByRole('rowheader', { name: 'New Student' });
  expect(entries[0]!.activities).toEqual([
    expect.objectContaining({
      blockOff: '2026-05-03T10:00',
      firstTakeoff: '2026-05-03T10:00',
      lastLanding: '2026-05-03T11:00',
      blockOn: '2026-05-03T11:00',
      arrival: 'EDFZ',
    }),
  ]);
});

test('the flight inputs look disabled while the session is saving', async () => {
  const { fetch } = sessionAPI();
  await openEntry();
  await fillBasics();
  await fillFlight(1, '0930', '1015');
  const blockOff = screen.getByLabelText('Flight 1 block off');
  const enabledBackground = getComputedStyle(blockOff).backgroundColor;

  let finish!: (response: Response) => void;
  fetch.mockReturnValueOnce(
    new Promise<Response>((resolve) => {
      finish = resolve;
    }),
  );
  await userEvent.click(screen.getByRole('button', { name: 'Save session' }));
  await screen.findByRole('button', { name: 'Saving…' });

  const fieldColors = (field: HTMLElement) => {
    const { backgroundColor, borderTopColor, color } = getComputedStyle(field);
    return { backgroundColor, borderTopColor, color };
  };
  const date = screen.getByLabelText('Session date');
  const type = screen.getByLabelText('Flight 1 type');
  for (const field of [date, type, blockOff]) {
    expect(field.matches(':disabled')).toBe(true);
  }
  const disabledColors = fieldColors(blockOff);
  expect(disabledColors.backgroundColor).not.toBe(enabledBackground);
  expect(disabledColors).toEqual(fieldColors(date));
  expect(disabledColors).toEqual(fieldColors(type));

  finish(Response.json({ error: 'Disk is full' }, { status: 500 }));
  await screen.findByRole('alert');
  expect(blockOff.matches(':enabled')).toBe(true);
});

test('save-and-add shortcut retains the date and aircraft, resets inputs, and focuses the student', async () => {
  const { entries } = sessionAPI();
  await openEntry();
  await fillBasics();
  await userEvent.fill(screen.getByLabelText('Preparation duration'), '0:30');
  await fillFlight(1, '2330', '0035');
  await userEvent.fill(screen.getByLabelText('Flight 1 arrival'), 'EDFZ');
  await userEvent.fill(screen.getByLabelText('Duty start'), '2300');
  await userEvent.fill(screen.getByLabelText('Duty end'), '0100');
  await userEvent.keyboard('{Control>}{Enter}{/Control}');
  await screen.findByRole('rowheader', { name: 'New Student' });
  expect(entries[0]).toMatchObject({ dutyEnd: '2026-05-04T01:00' });
  // Flight times before duty start belong to the overnight duty's second day.
  expect(entries[0]!.activities).toContainEqual(
    expect.objectContaining({
      type: 'dual',
      blockOff: '2026-05-03T23:30',
      blockOn: '2026-05-04T00:35',
    }),
  );
  await expect.poll(() => document.activeElement).toBe(screen.getByLabelText('Student'));
  expect(screen.getByLabelText('Block time total').textContent).toBe('0:00');
  expect(screen.queryByText(/Duty ends the next day/)).toBeNull();
  expect(value('Session date')).toBe('2026-05-03');
  for (const label of [
    'Student',
    'Duty start',
    'Duty end',
    'Preparation duration',
    'Flight 1 block off',
    'Flight 1 block on',
  ]) {
    expect(value(label)).toBe('');
  }
  expect(
    ['departure', 'arrival', 'registration', 'landings'].map((field) => value(`Flight 1 ${field}`)),
  ).toEqual(['EDFZ', 'EDFZ', 'D-EFTI', '1']);
  const suggestions = document.getElementById(
    screen.getByLabelText('Student').getAttribute('list')!,
  );
  expect(suggestions?.querySelector('option')?.value).toBe('New Student');

  await userEvent.keyboard('Second Student{Tab}13{Tab}14{Tab}45{Enter}');
  await screen.findByRole('rowheader', { name: 'Second Student' });
  expect(entries).toHaveLength(2);
  expect(entries[1]!.id).not.toBe(entries[0]!.id);
  // The carried-over details alone do not make an unused row a flight.
  expect(entries[1]!.activities).toEqual([
    expect.objectContaining({ type: 'preparation', minutes: 45 }),
  ]);
});

test('saves unnamed special flights with preparation and includes them in block totals', async () => {
  const { entries } = sessionAPI();
  await openEntry();
  await fillBasics();
  await userEvent.fill(screen.getByLabelText('Student'), '');
  await userEvent.fill(screen.getByLabelText('Preparation duration'), '15');
  await userEvent.selectOptions(screen.getByLabelText('Flight 1 type'), 'rundflug');
  await fillFlight(1, '0915', '1000');
  await userEvent.click(screen.getByRole('button', { name: 'Add flight' }));
  await userEvent.selectOptions(screen.getByLabelText('Flight 2 type'), 'schnupperflug');
  await userEvent.fill(screen.getByLabelText('Flight 2 block off'), '1010');
  await userEvent.fill(screen.getByLabelText('Flight 2 block on'), '1040');
  expect(screen.getByLabelText('Block time total').textContent).toBe('1:15');
  expect(screen.getByLabelText('Solo supervision total').textContent).toBe('0:00');
  await userEvent.click(screen.getByRole('button', { name: 'Save session' }));
  await screen.findByRole('rowheader', { name: 'Rundflug / Schnupperflug' });
  expect(entries).toHaveLength(1);
  expect(entries[0]!.activities).toEqual([
    expect.objectContaining({ type: 'preparation', minutes: 15 }),
    expect.objectContaining({ type: 'rundflug', blockOff: '2026-05-03T09:15' }),
    expect.objectContaining({ type: 'schnupperflug', registration: 'D-EFTI' }),
  ]);
  expect(entries[0]).not.toHaveProperty('description');
});

test.each(['dual', 'soloSupervision', 'preparation'])(
  'requires a student for sessions containing %s',
  async (type) => {
    const { entries } = sessionAPI();
    await openEntry();
    await fillBasics();
    await userEvent.fill(screen.getByLabelText('Student'), '');
    if (type === 'preparation') {
      await userEvent.fill(screen.getByLabelText('Preparation duration'), '15');
    } else {
      await userEvent.selectOptions(screen.getByLabelText('Flight 1 type'), 'rundflug');
      await fillFlight(1, '0930', '1000');
      await userEvent.click(screen.getByRole('button', { name: 'Add flight' }));
      await userEvent.selectOptions(screen.getByLabelText('Flight 2 type'), type);
      await userEvent.fill(screen.getByLabelText('Flight 2 block off'), '1010');
      await userEvent.fill(screen.getByLabelText('Flight 2 block on'), '1025');
    }
    await userEvent.click(screen.getByRole('button', { name: 'Save session' }));
    expect(screen.getByRole('alert').textContent).toContain('Enter a student');
    expect(document.activeElement).toBe(screen.getByLabelText('Student'));
    expect(entries).toHaveLength(0);
  },
);

test('removing flights updates totals and keeps keyboard focus in the editor', async () => {
  sessionAPI();
  await openEntry();
  await fillFlight(1, '0900', '0945');
  await userEvent.click(screen.getByRole('button', { name: 'Add flight' }));
  await userEvent.fill(screen.getByLabelText('Flight 2 block off'), '1000');
  await userEvent.fill(screen.getByLabelText('Flight 2 block on'), '1015');
  await userEvent.click(screen.getByRole('button', { name: 'Remove flight 1' }));
  expect(screen.getByLabelText('Block time total').textContent).toBe('0:15');
  await expect.poll(() => document.activeElement).toBe(screen.getByLabelText('Flight 1 block off'));
  await userEvent.click(screen.getByRole('button', { name: 'Remove flight 1' }));
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add flight' }));
  expect(screen.getByLabelText('Block time total').textContent).toBe('0:00');
});

test('validates entries, infers overnight duty, and preserves data after errors', async () => {
  await page.viewport(390, 720);
  const { fetch, entries } = sessionAPI();
  await openEntry();
  await fillBasics();
  const start = screen.getByLabelText<HTMLInputElement>('Duty start');
  const validStart = getComputedStyle(start).backgroundColor;
  await userEvent.fill(start, '2460');
  await userEvent.keyboard('{Tab}');
  expect(start.value).toBe('2460');
  expect(getComputedStyle(start).backgroundColor).not.toBe(validStart);
  const loads = fetch.mock.calls.length;
  await userEvent.click(screen.getByRole('button', { name: 'Save session' }));
  expect(fetch).toHaveBeenCalledTimes(loads);
  expect(document.activeElement).toBe(start);
  const end = screen.getByLabelText('Duty end');
  const entryRow = end.closest('tr')!;
  const save = screen.getByRole('button', { name: 'Save session' });
  const rowHeight = entryRow.getBoundingClientRect().height;
  const endWidth = end.getBoundingClientRect().width;
  const form = screen.getByRole('form', { name: 'Add session' });
  const flights = screen.getByRole('table', { name: 'New session flights' });
  expect(flights.getBoundingClientRect().top).toBe(form.getBoundingClientRect().top);
  await userEvent.fill(end, '2330');
  await userEvent.fill(start, '2300');
  await userEvent.click(end);
  const saveOffset = () =>
    save.getBoundingClientRect().top - entryRow.getBoundingClientRect().bottom;
  const savePosition = saveOffset();
  await userEvent.keyboard('{ControlOrMeta>}a{/ControlOrMeta}233');
  expect(within(entryRow).queryByText('+1 day')).toBeNull();
  await userEvent.keyboard('0');
  await userEvent.keyboard('{ControlOrMeta>}a{/ControlOrMeta}0100');
  expect(within(entryRow).queryByText('+1 day')).toBeNull();
  expect(saveOffset()).toBe(savePosition);
  await userEvent.keyboard('{Tab}');
  expect(saveOffset()).toBe(savePosition);
  expect(entryRow.getBoundingClientRect().height).toBe(rowHeight);
  expect(end.getBoundingClientRect().width).toBe(endWidth);
  expect(end.getBoundingClientRect().top).toBe(start.getBoundingClientRect().top);
  const marker = within(entryRow).getByText('+1 day');
  expect(marker.getAttribute('title')).toBe('04.05.2026');
  const tableRegion = screen.getByRole('region', { name: 'Sessions table' });
  end.scrollIntoView({ block: 'nearest', inline: 'center' });
  expect(tableRegion.scrollLeft).toBeGreaterThan(0);
  const markerBounds = marker.parentElement!.getBoundingClientRect();
  const endBounds = end.getBoundingClientRect();
  expect(markerBounds.right).toBeLessThanOrEqual(tableRegion.getBoundingClientRect().right);
  expect(markerBounds.right).toBeLessThanOrEqual(endBounds.right);
  expect(markerBounds.left).toBeGreaterThanOrEqual(
    endBounds.right - Number.parseFloat(getComputedStyle(end).paddingInlineEnd),
  );
  await expect
    .element(page.getByRole('textbox', { name: 'Duty end' }))
    .toHaveAccessibleDescription(/Duty ends the next day.*04\.05\.2026/);
  await userEvent.fill(end, '2330');
  expect(marker.isConnected).toBe(true);
  await userEvent.keyboard('{Tab}');
  expect(within(entryRow).queryByText('+1 day')).toBeNull();
  expect(saveOffset()).toBe(savePosition);
  await userEvent.fill(end, '0100');
  await fillFlight(1, '2330', '0015');
  const blockOff = screen.getByLabelText<HTMLInputElement>('Flight 1 block off');
  const { borderColor, backgroundColor } = getComputedStyle(blockOff);
  await userEvent.fill(blockOff, '2460');
  await userEvent.keyboard('{Tab}');
  expect(blockOff.value).toBe('2460');
  expect(getComputedStyle(blockOff).borderColor).not.toBe(borderColor);
  expect(getComputedStyle(blockOff).backgroundColor).not.toBe(backgroundColor);
  const requests = fetch.mock.calls.length;
  await userEvent.click(screen.getByRole('button', { name: 'Save session' }));
  expect(fetch).toHaveBeenCalledTimes(requests);
  await userEvent.fill(blockOff, '2330');
  fetch.mockResolvedValueOnce(Response.json({ error: 'Disk is full' }, { status: 500 }));
  await userEvent.click(screen.getByRole('button', { name: 'Save session' }));
  expect((await screen.findByRole('alert')).textContent).toBe('Disk is full');
  expect(value('Flight 1 block off')).toBe('23:30');
  const failedRequest = fetch.mock.calls.at(-1)![1]!.body;
  await userEvent.click(screen.getByRole('button', { name: 'Save session' }));
  await screen.findByRole('rowheader', { name: 'New Student' });
  expect(fetch.mock.calls.at(-1)![1]!.body).toBe(failedRequest);
  expect(entries[0]).toMatchObject({
    dutyEnd: '2026-05-04T01:00',
    student: 'New Student',
  });
});

test.each([320, 1280])(
  'one click saves overnight duty at %ipx with the end time focused',
  async (width) => {
    await page.viewport(width, 720);
    const { entries } = sessionAPI();
    await openEntry();
    await fillBasics();
    await userEvent.fill(screen.getByLabelText('Preparation duration'), '30');
    await userEvent.fill(screen.getByLabelText('Duty start'), '0900');
    await userEvent.fill(screen.getByLabelText('Duty end'), '0100');
    await userEvent.click(screen.getByRole('button', { name: 'Save session' }));
    await screen.findByRole('rowheader', { name: 'New Student' });
    expect(entries[0]).toMatchObject({ dutyEnd: '2026-05-04T01:00' });
  },
);

test.each(['20260-05-03', '9999-12-31'])(
  'preserves an overnight draft when date %s exceeds the supported range',
  async (date) => {
    const { entries } = sessionAPI();
    await openEntry();
    await fillBasics();
    await userEvent.fill(screen.getByLabelText('Duty start'), '2300');
    await userEvent.fill(screen.getByLabelText('Duty end'), '0100');
    await fillFlight(1, '2315', '0000');
    await userEvent.fill(screen.getByLabelText('Session date'), date);

    expect(value('Student')).toBe('New Student');
    expect(value('Flight 1 block on')).toBe('00:00');
    await userEvent.click(screen.getByRole('button', { name: 'Save session' }));
    expect(screen.getByRole('alert').textContent).toContain('session date');
    expect(document.activeElement).toBe(screen.getByLabelText('Session date'));
    expect(entries).toHaveLength(0);

    await userEvent.fill(screen.getByLabelText('Session date'), '2026-05-03');
    await userEvent.click(screen.getByRole('button', { name: 'Save session' }));
    await screen.findByRole('rowheader', { name: 'New Student' });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      dutyStart: '2026-05-03T23:00',
      dutyEnd: '2026-05-04T01:00',
      student: 'New Student',
      activities: [
        expect.objectContaining({
          type: 'dual',
          blockOff: '2026-05-03T23:15',
          blockOn: '2026-05-04T00:00',
        }),
      ],
    });
  },
);

test.each([
  ['2026-05-31', '2026-06-01'],
  ['2026-12-31', '2027-01-01'],
])('overnight duty starting %s advances the calendar date to %s', async (date, nextDate) => {
  const { entries } = sessionAPI();
  await openEntry();
  await fillBasics();
  await userEvent.fill(screen.getByLabelText('Session date'), date);
  await userEvent.fill(screen.getByLabelText('Duty start'), '2300');
  await userEvent.fill(screen.getByLabelText('Duty end'), '2300');
  await userEvent.fill(screen.getByLabelText('Preparation duration'), '30');
  await userEvent.click(screen.getByRole('button', { name: 'Save session' }));
  expect(screen.getByRole('alert').textContent).toContain('must differ');
  expect(entries).toHaveLength(0);
  await userEvent.fill(screen.getByLabelText('Duty end'), '0100');
  await userEvent.keyboard('{Tab}');
  expect(
    screen
      .getByText(/Duty ends the next day/)
      .querySelector('time')
      ?.getAttribute('datetime'),
  ).toBe(nextDate);
  await userEvent.click(screen.getByRole('button', { name: 'Save session' }));
  await screen.findByRole('rowheader', { name: 'New Student' });
  expect(entries[0]).toMatchObject({ dutyStart: `${date}T23:00`, dutyEnd: `${nextDate}T01:00` });
});

test('suggests distinct existing students, defaults the date to the configured timezone, and cancels without saving', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-05-03T23:30:00Z'));
  const fetch = vi.fn().mockResolvedValue(
    Response.json({
      timeZone: 'Europe/Berlin',
      sessions: [
        {
          id: 'a',
          student: 'Alex',
          dutyStart: '2026-05-03T09:00:00Z',
          dutyEnd: '2026-05-03T10:00:00Z',
          activities: [],
        },
        {
          id: 'b',
          student: 'Alex',
          dutyStart: '2026-05-03T11:00:00Z',
          dutyEnd: '2026-05-03T12:00:00Z',
          activities: [],
        },
      ],
    }),
  );
  vi.stubGlobal('fetch', fetch);
  await openEntry();
  expect((screen.getByLabelText('Session date') as HTMLInputElement).value).toBe('2026-05-04');
  const list = document.getElementById(screen.getByLabelText('Student').getAttribute('list')!)!;
  expect([...list.querySelectorAll('option')].map((option) => option.value)).toEqual(['Alex']);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('form', { name: 'Add session' })).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add session' }));
});
