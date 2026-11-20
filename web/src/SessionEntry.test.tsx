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
      sessions = [
        ...sessions,
        {
          ...entry,
          etag: `"${entry.id}"`,
          dutyStart: `${entry.dutyStart}:00Z`,
          dutyEnd: `${entry.dutyEnd}:00Z`,
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

test('enters a session by keyboard, calculates totals, and saves individual flights', async () => {
  const { entries } = sessionAPI();
  await openEntry();
  const editor = screen.getByRole('table', { name: 'New session flights' });
  expect(
    within(editor)
      .getAllByRole('columnheader')
      .map((header) => header.textContent),
  ).toEqual(['Type', 'Duration', 'Actions']);
  const editorColumns = flightColumns(editor);
  expect(document.activeElement).toBe(screen.getByLabelText('Session date'));
  await userEvent.fill(screen.getByLabelText('Session date'), '2026-05-03');
  await userEvent.fill(screen.getByLabelText('Student'), 'New Student');
  await userEvent.keyboard('{Tab}0900{Tab}1230{Tab}30{Tab}');
  expect(document.activeElement).toBe(screen.getByLabelText('Flight 1 type'));
  expect((screen.getByLabelText('Duty start') as HTMLInputElement).value).toBe('09:00');
  expect((screen.getByLabelText('Duty end') as HTMLInputElement).value).toBe('12:30');
  expect((screen.getByLabelText('Preparation duration') as HTMLInputElement).value).toBe('0:30');
  await userEvent.keyboard('{Tab}45{Tab}{Tab}{Enter}');
  expect(document.activeElement).toBe(screen.getByLabelText('Flight 2 duration'));
  await userEvent.keyboard('115');
  expect(screen.getByLabelText('Block time total').textContent).toBe('2:00');
  expect(screen.getByLabelText('Block time total').tagName).toBe('SPAN');
  await userEvent.click(screen.getByRole('button', { name: 'Add flight' }));
  await userEvent.selectOptions(screen.getByLabelText('Flight 3 type'), 'soloSupervision');
  expect((screen.getByLabelText('Flight 2 duration') as HTMLInputElement).value).toBe('1:15');
  await userEvent.fill(screen.getByLabelText('Flight 3 duration'), '20');
  expect(screen.getByLabelText('Solo supervision total').textContent).toBe('0:20');
  await userEvent.click(screen.getByRole('button', { name: 'Save session' }));

  await screen.findByRole('rowheader', { name: 'New Student' });
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({
    dutyStart: '2026-05-03T09:00',
    dutyEnd: '2026-05-03T12:30',
    student: 'New Student',
    activities: [
      { type: 'preparation', minutes: 30 },
      { type: 'dual', minutes: 45 },
      { type: 'dual', minutes: 75 },
      { type: 'soloSupervision', minutes: 20 },
    ],
  });
  expect(new Set(entries[0]!.activities.map((activity) => activity.id)).size).toBe(4);
  expect(screen.queryByRole('form', { name: 'Add session' })).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add session' }));
  await userEvent.click(screen.getByRole('button', { name: /Show flights for New Student/ }));
  const flights = screen.getByRole('table', { name: /Flights for New Student/ });
  expect(flightColumns(flights)).toEqual(editorColumns);
  expect(within(flights).getAllByRole('row')).toHaveLength(4);
  expect(within(flights).getByText('1:15')).toBeTruthy();
});

test('the flight duration looks disabled while the session is saving', async () => {
  const { fetch } = sessionAPI();
  await openEntry();
  await fillBasics();
  const duration = screen.getByLabelText('Flight 1 duration');
  await userEvent.fill(duration, '45');
  const enabledBackground = getComputedStyle(duration).backgroundColor;

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
  for (const field of [date, type, duration]) {
    expect(field.matches(':disabled')).toBe(true);
  }
  const disabledColors = fieldColors(duration);
  expect(disabledColors.backgroundColor).not.toBe(enabledBackground);
  expect(disabledColors).toEqual(fieldColors(date));
  expect(disabledColors).toEqual(fieldColors(type));

  finish(Response.json({ error: 'Disk is full' }, { status: 500 }));
  await screen.findByRole('alert');
  expect(duration.matches(':enabled')).toBe(true);
});

test('save-and-add shortcut retains the date, resets inputs, and focuses the student', async () => {
  const { entries } = sessionAPI();
  await openEntry();
  await fillBasics();
  await userEvent.fill(screen.getByLabelText('Preparation duration'), '0:30');
  await userEvent.fill(screen.getByLabelText('Flight 1 duration'), '105');
  await userEvent.fill(screen.getByLabelText('Duty end'), '0100');
  await userEvent.keyboard('{Control>}{Enter}{/Control}');
  await screen.findByRole('rowheader', { name: 'New Student' });
  expect(entries[0]).toMatchObject({ dutyEnd: '2026-05-04T01:00' });
  expect(entries[0]!.activities).toContainEqual(
    expect.objectContaining({ type: 'dual', minutes: 65 }),
  );
  await expect.poll(() => document.activeElement).toBe(screen.getByLabelText('Student'));
  expect(screen.queryByText(/Duty ends the next day/)).toBeNull();
  expect((screen.getByLabelText('Session date') as HTMLInputElement).value).toBe('2026-05-03');
  for (const label of [
    'Student',
    'Duty start',
    'Duty end',
    'Preparation duration',
    'Flight 1 duration',
  ]) {
    expect((screen.getByLabelText(label) as HTMLInputElement).value).toBe('');
  }
  expect(screen.getByLabelText('Block time total').textContent).toBe('0:00');
  const suggestions = document.getElementById(
    screen.getByLabelText('Student').getAttribute('list')!,
  );
  expect(suggestions?.querySelector('option')?.value).toBe('New Student');

  await userEvent.keyboard('Second Student{Tab}13{Tab}14{Tab}45{Enter}');
  await screen.findByRole('rowheader', { name: 'Second Student' });
  expect(entries).toHaveLength(2);
  expect(entries[1]!.id).not.toBe(entries[0]!.id);
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
  await userEvent.fill(screen.getByLabelText('Flight 1 duration'), '45');
  await userEvent.click(screen.getByRole('button', { name: 'Add flight' }));
  await userEvent.selectOptions(screen.getByLabelText('Flight 2 type'), 'schnupperflug');
  await userEvent.fill(screen.getByLabelText('Flight 2 duration'), '30');
  expect(screen.getByLabelText('Block time total').textContent).toBe('1:15');
  expect(screen.getByLabelText('Solo supervision total').textContent).toBe('0:00');
  await userEvent.click(screen.getByRole('button', { name: 'Save session' }));
  await screen.findByRole('rowheader', { name: 'Rundflug / Schnupperflug' });
  expect(entries).toHaveLength(1);
  expect(entries[0]!.activities).toEqual([
    expect.objectContaining({ type: 'preparation', minutes: 15 }),
    expect.objectContaining({ type: 'rundflug', minutes: 45 }),
    expect.objectContaining({ type: 'schnupperflug', minutes: 30 }),
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
      await userEvent.fill(screen.getByLabelText('Flight 1 duration'), '30');
      await userEvent.click(screen.getByRole('button', { name: 'Add flight' }));
      await userEvent.selectOptions(screen.getByLabelText('Flight 2 type'), type);
      await userEvent.fill(screen.getByLabelText('Flight 2 duration'), '15');
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
  await userEvent.fill(screen.getByLabelText('Flight 1 duration'), '45');
  await userEvent.click(screen.getByRole('button', { name: 'Add flight' }));
  await userEvent.fill(screen.getByLabelText('Flight 2 duration'), '15');
  await userEvent.click(screen.getByRole('button', { name: 'Remove flight 1' }));
  expect(screen.getByLabelText('Block time total').textContent).toBe('0:15');
  await expect.poll(() => document.activeElement).toBe(screen.getByLabelText('Flight 1 duration'));
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
  const duration = screen.getByLabelText<HTMLInputElement>('Flight 1 duration');
  const { borderColor, backgroundColor } = getComputedStyle(duration);
  await userEvent.fill(duration, '90');
  await userEvent.keyboard('{Tab}');
  expect(duration.value).toBe('90');
  expect(getComputedStyle(duration).borderColor).not.toBe(borderColor);
  expect(getComputedStyle(duration).backgroundColor).not.toBe(backgroundColor);
  const requests = fetch.mock.calls.length;
  await userEvent.click(screen.getByRole('button', { name: 'Save session' }));
  expect(fetch).toHaveBeenCalledTimes(requests);
  await userEvent.fill(screen.getByLabelText('Flight 1 duration'), '45');
  fetch.mockResolvedValueOnce(Response.json({ error: 'Disk is full' }, { status: 500 }));
  await userEvent.click(screen.getByRole('button', { name: 'Save session' }));
  expect((await screen.findByRole('alert')).textContent).toBe('Disk is full');
  expect((screen.getByLabelText('Flight 1 duration') as HTMLInputElement).value).toBe('0:45');
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
    await userEvent.fill(screen.getByLabelText('Flight 1 duration'), '45');
    await userEvent.fill(screen.getByLabelText('Session date'), date);

    expect((screen.getByLabelText('Student') as HTMLInputElement).value).toBe('New Student');
    expect((screen.getByLabelText('Flight 1 duration') as HTMLInputElement).value).toBe('0:45');
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
      activities: [expect.objectContaining({ type: 'dual', minutes: 45 })],
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
