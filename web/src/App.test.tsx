import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vite-plus/test';
import { page, userEvent } from 'vite-plus/test/browser';
import App from './App';
import SelectionMenu from './SelectionMenu';
import './style.css';

const session = {
  id: 'session-1',
  dutyStart: '2026-05-03T22:30:00Z',
  dutyEnd: '2026-05-03T23:55:00Z',
  student: 'Alex Beispiel',
  activities: [
    { id: 'briefing', type: 'preparation', minutes: 15 },
    { id: 'flight-1', type: 'dual', minutes: 35 },
    { id: 'flight-2', type: 'dual', minutes: 30 },
    { id: 'solo', type: 'soloSupervision', minutes: 5 },
  ],
};

function respond(body: unknown, status = 200) {
  const fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  await page.viewport(1280, 720);
});

function selectPreset(name: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Select sessions' }));
  fireEvent.click(screen.getByRole('menuitem', { name }));
}

test('loads sessions and expands flights by clicking a data cell', async () => {
  const fetch = respond({
    timeZone: 'Europe/Berlin',
    sessions: [
      session,
      {
        ...session,
        id: 'session-2',
        student: undefined,
        activities: [{ id: 'sightseeing', type: 'rundflug', minutes: 45 }],
        dutyStart: '2026-04-01T10:00:00Z',
        dutyEnd: '2026-04-01T11:00:00Z',
      },
    ],
  });
  render(<App />);
  expect(screen.getByRole('status').textContent).toBe('Loading sessions…');
  const toggle = await screen.findByRole('button', {
    name: 'Show flights for Alex Beispiel on 04.05.2026',
  });
  expect(fetch).toHaveBeenCalledWith(
    '/api/sessions',
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
  expect(screen.getByText('Europe/Berlin')).toBeTruthy();
  expect(screen.getByRole('rowheader', { name: 'Rundflug' })).toBeTruthy();
  const row = within(toggle.closest('tr')!);
  const cells = row.getAllByRole('cell');
  expect(cells[1].contains(toggle)).toBe(true);
  expect(cells.slice(2).map((cell) => cell.textContent)).toEqual([
    '04.05.2026',
    '00:30 LT',
    '01:55 LT',
    '0:15',
    '1:05',
    '0:05',
  ]);
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(
    screen.queryByRole('table', { name: 'Flights for Alex Beispiel on 04.05.2026' }),
  ).toBeNull();
  expect(screen.queryByRole('columnheader', { name: 'Activities' })).toBeNull();

  fireEvent.click(cells[2]);
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  expect(row.getByRole<HTMLInputElement>('checkbox').checked).toBe(false);
  expect(screen.getAllByRole('table')).toHaveLength(2);
  const flights = screen.getByRole('table', { name: 'Flights for Alex Beispiel on 04.05.2026' });
  expect(
    within(flights)
      .getAllByRole('columnheader')
      .map((header) => header.textContent),
  ).toEqual(['Flight', 'Type', 'Block']);
  const flightRows = within(flights).getAllByRole('row').slice(1);
  expect(
    flightRows.map((row) => [
      within(row).getByRole('rowheader').textContent,
      ...within(row)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ]),
  ).toEqual([
    ['1', 'Dual', '0:35'],
    ['2', 'Dual', '0:30'],
    ['3', 'Solo supervision', '0:05'],
  ]);
  expect(within(flights).queryByText('Preparation')).toBeNull();
  expect(within(flights).queryByText('flight-1')).toBeNull();

  toggle.focus();
  expect(document.activeElement).toBe(toggle);
  fireEvent.click(toggle);
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(
    screen.queryByRole('table', { name: 'Flights for Alex Beispiel on 04.05.2026' }),
  ).toBeNull();
});

test('special flights count as own block time and retain their types in flight rows', async () => {
  respond({
    timeZone: 'UTC',
    sessions: [
      {
        ...session,
        activities: [
          ...session.activities,
          { id: 'rundflug', type: 'rundflug', minutes: 20 },
          { id: 'schnupperflug', type: 'schnupperflug', minutes: 10 },
        ],
      },
      {
        ...session,
        id: 'unnamed',
        student: undefined,
        activities: [
          { id: 'rundflug-1', type: 'rundflug', minutes: 15 },
          { id: 'rundflug-2', type: 'rundflug', minutes: 20 },
          { id: 'schnupperflug-1', type: 'schnupperflug', minutes: 10 },
        ],
      },
    ],
  });
  render(<App />);
  const alex = await screen.findByRole('rowheader', { name: 'Alex Beispiel' });
  expect(screen.getByRole('columnheader', { name: 'Block time' })).toBeTruthy();
  expect(screen.getByRole('columnheader', { name: 'Solo supervision' })).toBeTruthy();
  const totals = (header: HTMLElement) =>
    within(header.closest('tr')!)
      .getAllByRole('cell')
      .slice(-3)
      .map((cell) => cell.textContent);
  expect(totals(alex)).toEqual(['0:15', '1:35', '0:05']);
  const unnamed = screen.getByRole('rowheader', { name: 'Rundflug / Schnupperflug' });
  expect(totals(unnamed)).toEqual(['0:00', '0:45', '0:00']);
  fireEvent.click(screen.getByRole('button', { name: /Show flights for Rundflug/ }));
  const flights = screen.getByRole('table', {
    name: 'Flights for Rundflug / Schnupperflug on 03.05.2026',
  });
  expect(
    within(flights)
      .getAllByRole('row')
      .slice(1)
      .map((row) => row.textContent),
  ).toEqual(['1Rundflug0:15', '2Rundflug0:20', '3Schnupperflug0:10']);
  fireEvent.click(
    screen.getByRole('checkbox', {
      name: 'Select session for Rundflug / Schnupperflug on 03.05.2026',
    }),
  );
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Generate invoice' }).disabled).toBe(
    false,
  );
  expect(screen.getByRole('status').textContent).toBe('1 of 2 sessions selected');
});

test('selects sessions individually and in bulk without expanding flights', async () => {
  respond({
    timeZone: 'UTC',
    sessions: [session, { ...session, id: 'session-2', student: 'Sam Beispiel' }],
  });
  render(<App />);
  const selectionMenu = await screen.findByRole<HTMLButtonElement>('button', {
    name: 'Select sessions',
  });
  const alex = screen.getByRole<HTMLInputElement>('checkbox', {
    name: 'Select session for Alex Beispiel on 03.05.2026',
  });
  const sam = screen.getByRole<HTMLInputElement>('checkbox', {
    name: 'Select session for Sam Beispiel on 03.05.2026',
  });
  const toggle = screen.getByRole('button', {
    name: 'Show flights for Alex Beispiel on 03.05.2026',
  });
  expect([alex.checked, sam.checked]).toEqual([false, false]);
  expect(screen.getByRole('status').textContent).toBe('0 of 2 sessions selected');

  await userEvent.click(alex);
  expect([alex.checked, sam.checked]).toEqual([true, false]);
  expect(screen.getByRole('status').textContent).toBe('1 of 2 sessions selected');
  expect(alex.closest('tr')?.getAttribute('data-selected')).toBe('true');
  expect(toggle.getAttribute('aria-expanded')).toBe('false');

  await userEvent.click(selectionMenu);
  expect(screen.getByRole('menu')).toBeTruthy();
  await userEvent.click(selectionMenu);
  expect(screen.queryByRole('menu')).toBeNull();
  expect([alex.checked, sam.checked]).toEqual([true, false]);
  expect(screen.getByRole('status').textContent).toBe('1 of 2 sessions selected');
  await userEvent.click(selectionMenu);
  await userEvent.keyboard('{Escape}');

  fireEvent.click(toggle);
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  expect(alex.checked).toBe(true);
  const flights = screen.getByRole('table', { name: 'Flights for Alex Beispiel on 03.05.2026' });
  expect(flights.closest('td')?.colSpan).toBe(9);

  selectPreset('Select all');
  expect([alex.checked, sam.checked]).toEqual([true, true]);
  expect(screen.getByRole('status').textContent).toBe('2 of 2 sessions selected');
  expect(toggle.getAttribute('aria-expanded')).toBe('true');

  fireEvent.click(alex);
  expect([alex.checked, sam.checked]).toEqual([false, true]);
  expect(screen.getByRole('status').textContent).toBe('1 of 2 sessions selected');
  expect(alex.closest('tr')?.getAttribute('data-selected')).toBe('false');
  expect(toggle.getAttribute('aria-expanded')).toBe('true');

  selectPreset('Clear selection');
  expect([alex.checked, sam.checked]).toEqual([false, false]);
  expect(screen.getByRole('status').textContent).toBe('0 of 2 sessions selected');
});

test.each([
  ['Select this month', ['Today', 'Later today', 'End of month']],
  ['Select last month', ['Start of last month', 'End of last month']],
])('%s replaces selection using dates in the configured timezone', async (preset, expected) => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-01-31T23:30:00Z'));
  const dates = [
    ['Today', '2026-01-31T23:15:00Z'],
    ['Later today', '2026-02-01T12:00:00Z'],
    ['End of month', '2026-02-28T22:59:00Z'],
    ['Next month', '2026-02-28T23:00:00Z'],
    ['Start of last month', '2025-12-31T23:00:00Z'],
    ['End of last month', '2026-01-31T22:59:00Z'],
    ['Previous month', '2025-12-31T22:59:00Z'],
    ['Same month last year', '2025-02-01T12:00:00Z'],
  ];
  respond({
    timeZone: 'Europe/Berlin',
    sessions: dates.map(([student, dutyStart]) => ({
      ...session,
      id: student,
      student,
      dutyStart,
      dutyEnd: new Date(Date.parse(dutyStart) + 3600000).toISOString(),
    })),
  });
  render(<App />);
  await screen.findByRole('button', { name: 'Select sessions' });
  selectPreset('Select all');
  for (let attempt = 0; attempt < 2; attempt++) {
    selectPreset(preset);
    const selected = screen
      .getAllByRole<HTMLInputElement>('checkbox', { name: /^Select session for / })
      .filter((checkbox) => checkbox.checked)
      .map((checkbox) => within(checkbox.closest('tr')!).getByRole('rowheader').textContent);
    expect(selected).toEqual(expected);
    expect(screen.getByRole('status').textContent).toBe(
      `${expected.length} of 8 sessions selected`,
    );
    expect(screen.queryByRole('menu')).toBeNull();
  }
});

test('groups sessions by local month and replaces selection from a month heading', async () => {
  await page.viewport(568, 720);
  const dates = [
    ['Last January', '2025-01-11T12:00:00Z'],
    ['New Year lesson', '2025-12-31T23:30:00Z'],
    ['December lesson', '2025-12-31T22:30:00Z'],
    ['January lesson', '2026-01-02T08:00:00Z'],
  ];
  respond({
    timeZone: 'Europe/Berlin',
    sessions: dates.map(([student, dutyStart]) => ({
      ...session,
      id: student,
      student,
      dutyStart,
      dutyEnd: new Date(Date.parse(dutyStart) + 60 * 60 * 1000).toISOString(),
    })),
  });
  render(<App />);
  const table = await screen.findByRole('table', { name: 'Sessions by month' });
  const groups = within(table).getAllByRole('rowgroup').slice(1);
  expect(
    groups.map((group) =>
      within(group)
        .getByRole('button', { name: /^Select \d/ })
        .getAttribute('aria-label'),
    ),
  ).toEqual([
    'Select 2 sessions in January 2026',
    'Select 1 session in December 2025',
    'Select 1 session in January 2025',
  ]);
  const groupButton = within(table).getByRole('button', {
    name: 'Select 2 sessions in January 2026',
  });
  expect(groupButton.getBoundingClientRect().right).toBeLessThanOrEqual(568);
  selectPreset('Select all');
  await userEvent.click(groupButton);
  await userEvent.click(groupButton);
  const selected = () =>
    within(table)
      .getAllByRole('checkbox', { checked: true })
      .map((checkbox) => within(checkbox.closest('tr')!).getByRole('rowheader').textContent);
  expect(selected()).toEqual(['New Year lesson', 'January lesson']);
  expect(screen.getByRole('status').textContent).toBe('2 of 4 sessions selected');
  await userEvent.click(within(table).getByRole('checkbox', { name: /New Year lesson/ }));
  expect(selected()).toEqual(['January lesson']);
});

test('last month includes December of the previous year and clears a selection when empty', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-01-01T12:00:00Z'));
  respond({
    timeZone: 'UTC',
    sessions: [
      { ...session, dutyStart: '2025-12-31T23:30:00Z', dutyEnd: '2026-01-01T00:30:00Z' },
      { ...session, id: 'older', student: 'Older', dutyStart: '2024-12-31T23:30:00Z' },
    ],
  });
  render(<App />);
  await screen.findByRole('button', { name: 'Select sessions' });
  selectPreset('Select last month');
  expect(screen.getByRole<HTMLInputElement>('checkbox', { name: /Alex Beispiel/ }).checked).toBe(
    true,
  );
  expect(screen.getByRole<HTMLInputElement>('checkbox', { name: /Older/ }).checked).toBe(false);
  selectPreset('Select this month');
  expect(
    screen
      .getAllByRole<HTMLInputElement>('checkbox', { name: /^Select session for / })
      .every((checkbox) => !checkbox.checked),
  ).toBe(true);
  expect(screen.getByRole('status').textContent).toBe('0 of 2 sessions selected');
});

test('selection menu supports keyboard navigation, dismissal and restoring focus', async () => {
  respond({ timeZone: 'UTC', sessions: [session] });
  render(<App />);
  const trigger = await screen.findByRole<HTMLButtonElement>('button', {
    name: 'Select sessions',
  });
  await userEvent.click(trigger);
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
    'Select this month',
    'Select last month',
    'Select all',
    'Clear selection',
  ]);
  expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Select this month' }));
  await userEvent.keyboard('{ArrowUp}');
  expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Clear selection' }));
  await userEvent.keyboard('{Home}');
  await userEvent.keyboard('{ArrowDown}');
  expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Select last month' }));
  await userEvent.keyboard('{End}');
  expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Clear selection' }));
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('menu')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  expect(trigger.getAttribute('aria-expanded')).toBe('false');

  await userEvent.keyboard(' ');
  expect(screen.getByRole('menu')).toBeTruthy();
  expect(
    screen.getByRole<HTMLInputElement>('checkbox', { name: /^Select session for / }).checked,
  ).toBe(false);
  await userEvent.keyboard('{Escape}');

  await userEvent.keyboard('{Enter}');
  expect(screen.getByRole('menu')).toBeTruthy();
  await userEvent.keyboard('{Escape}');

  await userEvent.keyboard('{ArrowDown}');
  await userEvent.click(screen.getByRole('menuitem', { name: 'Select all' }));
  expect(document.activeElement).toBe(trigger);
  expect(
    screen.getByRole<HTMLInputElement>('checkbox', { name: /^Select session for / }).checked,
  ).toBe(true);

  await userEvent.keyboard('{ArrowUp}');
  expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Clear selection' }));
  await userEvent.keyboard('{Tab}');
  expect(screen.queryByRole('menu')).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Generate invoice' }));

  await userEvent.click(trigger);
  await userEvent.click(screen.getByRole('heading', { name: 'Sessions' }));
  expect(screen.queryByRole('menu')).toBeNull();
  expect(
    screen.getByRole<HTMLInputElement>('checkbox', { name: /^Select session for / }).checked,
  ).toBe(true);

  await userEvent.click(trigger);
  await userEvent.click(trigger);
  expect(screen.queryByRole('menu')).toBeNull();
});

test.each([720, 320, 240])('selection menu stays onscreen at 568 × %i', async (height) => {
  await page.viewport(568, height);
  respond({ timeZone: 'UTC', sessions: [session] });
  render(<App />);
  const trigger = await screen.findByRole('button', { name: 'Select sessions' });
  await userEvent.click(screen.getByRole('checkbox', { name: /^Select session for / }));
  await userEvent.click(trigger);

  const bounds = screen.getByRole('menu').getBoundingClientRect();
  expect(bounds.top).toBeGreaterThanOrEqual(0);
  expect(bounds.bottom).toBeLessThanOrEqual(height);
  expect(bounds.left).toBeGreaterThanOrEqual(0);
  expect(bounds.right).toBeLessThanOrEqual(568);
  const anchor = trigger.getBoundingClientRect();
  expect(bounds.left).toBeCloseTo(anchor.left + 4);
  expect(bounds.top >= anchor.bottom || bounds.bottom <= anchor.top).toBe(true);
  await userEvent.keyboard('{End}');
  const clear = screen.getByRole('menuitem', { name: 'Clear selection' });
  expect(document.activeElement).toBe(clear);
  expect(clear.getBoundingClientRect().bottom).toBeLessThanOrEqual(height);
  await userEvent.click(clear);
  expect(screen.getByRole('status').textContent).toBe('0 of 1 session selected');
  expect(document.activeElement).toBe(trigger);
});

test('a constrained menu scrolls internally to keep keyboard-focused options reachable', async () => {
  await page.viewport(568, 100);
  const onSelectionChange = vi.fn();
  render(
    <div style={{ position: 'fixed', top: '50%', left: '1rem' }}>
      <SelectionMenu sessions={[session]} timeZone="UTC" onSelectionChange={onSelectionChange} />
    </div>,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Select sessions' }));
  const menu = screen.getByRole('menu');
  expect(menu.scrollHeight).toBeGreaterThan(menu.clientHeight);
  expect(menu.getBoundingClientRect().top).toBeGreaterThanOrEqual(0);
  expect(menu.getBoundingClientRect().bottom).toBeLessThanOrEqual(100);

  await userEvent.keyboard('{End}');
  const clear = screen.getByRole('menuitem', { name: 'Clear selection' });
  expect(document.activeElement).toBe(clear);
  expect(menu.scrollTop).toBeGreaterThan(0);
  expect(clear.getBoundingClientRect().top).toBeGreaterThanOrEqual(0);
  expect(clear.getBoundingClientRect().bottom).toBeLessThanOrEqual(100);
  await userEvent.keyboard('{Enter}');
  expect(onSelectionChange).toHaveBeenCalledExactlyOnceWith(new Set());
  expect(screen.queryByRole('menu')).toBeNull();
});

test('preparation-only sessions have no flight expansion', async () => {
  respond({ timeZone: 'UTC', sessions: [{ ...session, activities: [session.activities[0]] }] });
  render(<App />);
  await screen.findByText('Alex Beispiel');
  expect(screen.getByText('0:15')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /flights for/ })).toBeNull();
  fireEvent.click(screen.getByRole('checkbox', { name: /Select session for/ }));
  expect(screen.getByRole('status').textContent).toBe('1 of 1 session selected');
  expect(screen.getByRole('button', { name: 'Select sessions' })).toBeTruthy();
});

test('shows the end date for sessions crossing midnight in the display timezone', async () => {
  respond({ timeZone: 'UTC', sessions: [{ ...session, dutyEnd: '2026-05-04T01:00:00Z' }] });
  render(<App />);
  await screen.findByRole('button', { name: /flights for/ });
  expect(screen.getByText('UTC')).toBeTruthy();
  expect(screen.getByText('22:30').textContent).toBe('22:30 Z');
  expect(screen.getByText('01:00').textContent).toContain('01:00 Z');
  expect(screen.getByText('04.05.2026')).toBeTruthy();
});

test('shows an empty state for a valid empty sessions file', async () => {
  respond({ timeZone: 'UTC', sessions: [] });
  render(<App />);
  expect(await screen.findByText('No sessions yet.')).toBeTruthy();
  expect(screen.queryByRole('table')).toBeNull();
  expect(screen.queryByRole('checkbox')).toBeNull();
});

test('shows file errors returned by the server', async () => {
  respond({ error: 'read sessions: open "sessions.json": no such file or directory' }, 500);
  render(<App />);
  expect((await screen.findByRole('alert')).textContent).toContain('open "sessions.json"');
  expect(screen.queryByRole('table')).toBeNull();
});

test('shows network errors', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Connection lost')));
  render(<App />);
  expect((await screen.findByRole('alert')).textContent).toBe('Connection lost');
});

test('invoice controls require a selection and retain entered details when cancelled', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-12-31T23:30:00Z'));
  respond({ timeZone: 'Europe/Berlin', sessions: [session] });
  render(<App />);
  const trigger = await screen.findByRole<HTMLButtonElement>('button', {
    name: 'Generate invoice',
  });
  expect(trigger.disabled).toBe(true);
  expect(screen.queryByRole('form')).toBeNull();
  fireEvent.click(screen.getByRole('checkbox', { name: /Select session for/ }));
  expect(trigger.disabled).toBe(false);
  fireEvent.click(trigger);
  const number = screen.getByLabelText<HTMLInputElement>('Invoice number');
  expect(document.activeElement).toBe(number);
  expect(number.value).toBe('');
  expect(number.placeholder).toBe('2027-01');
  expect(number.checkValidity()).toBe(false);
  expect(screen.getByLabelText<HTMLInputElement>('Issue date').value).toBe('2027-01-01');
  fireEvent.change(number, { target: { value: '2027-12' } });
  expect(number.checkValidity()).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('form')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  fireEvent.click(trigger);
  expect(screen.getByLabelText<HTMLInputElement>('Invoice number').value).toBe('2027-12');
  selectPreset('Clear selection');
  expect(trigger.disabled).toBe(true);
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Download PDF' }).disabled).toBe(
    true,
  );
});

test('downloads the generated PDF for exactly the selected sessions without clearing selection', async () => {
  const fetch = respond({
    timeZone: 'UTC',
    sessions: [session, { ...session, id: 'session-2', student: 'Sam Beispiel' }],
  });
  const pdf = '%PDF-1.7\ninvoice';
  let finish!: (response: Response) => void;
  const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:invoice');
  const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const downloads: { href: string; name: string; connected: boolean }[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    downloads.push({ href: this.href, name: this.download, connected: this.isConnected });
  });
  render(<App />);
  const sam = await screen.findByRole<HTMLInputElement>('checkbox', {
    name: /Select session for Sam/,
  });
  fetch.mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  const alex = screen.getByRole('checkbox', { name: /Select session for Alex/ });
  fireEvent.click(alex);
  fireEvent.click(screen.getByRole('button', { name: 'Generate invoice' }));
  fireEvent.click(alex);
  fireEvent.click(sam);
  fireEvent.change(screen.getByLabelText('Invoice number'), { target: { value: '2026-12' } });
  fireEvent.change(screen.getByLabelText('Issue date'), { target: { value: '2026-06-09' } });
  fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }));
  expect(fetch).toHaveBeenLastCalledWith('/api/invoice', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionIds: ['session-2'],
      number: '2026-12',
      issueDate: '2026-06-09',
    }),
  });
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Generating…' }).disabled).toBe(
    true,
  );
  expect(screen.getByLabelText<HTMLInputElement>('Invoice number').matches(':disabled')).toBe(true);
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Generate invoice' }).disabled).toBe(
    true,
  );
  expect(
    screen.getByRole<HTMLButtonElement>('button', { name: 'Generate duty report' }).disabled,
  ).toBe(true);
  expect(downloads).toEqual([]);
  finish(new Response(pdf, { headers: { 'Content-Type': 'application/pdf' } }));
  await waitFor(() => expect(downloads).toHaveLength(1));
  expect(downloads).toEqual([
    { href: 'blob:invoice', name: 'Rechnung-2026-12.pdf', connected: true },
  ]);
  const blob = createObjectURL.mock.calls[0][0] as Blob;
  const contents = await new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsText(blob);
  });
  expect(contents).toBe(pdf);
  expect(screen.getByRole('form', { name: 'Generate invoice' })).toBeTruthy();
  expect(screen.getByLabelText<HTMLInputElement>('Invoice number').value).toBe('2026-12');
  expect(screen.getByLabelText<HTMLInputElement>('Issue date').value).toBe('2026-06-09');
  expect(screen.queryByText('PDF download started.')).toBeNull();
  expect(sam.checked).toBe(true);
  expect(
    screen.getByRole<HTMLInputElement>('checkbox', { name: /Select session for Alex/ }).checked,
  ).toBe(false);
  expect(document.querySelector('a[download]')).toBeNull();
  await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:invoice'), {
    timeout: 2000,
  });
});

test('invoice errors preserve form details and allow retrying', async () => {
  const fetch = respond({ timeZone: 'UTC', sessions: [session] });
  render(<App />);
  await screen.findByRole('button', { name: 'Generate invoice' });
  selectPreset('Select all');
  fireEvent.click(screen.getByRole('button', { name: 'Generate invoice' }));
  fireEvent.change(screen.getByLabelText('Invoice number'), { target: { value: '2026-12' } });
  fetch.mockResolvedValueOnce(
    new Response(JSON.stringify({ error: 'Install WeasyPrint' }), { status: 500 }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }));
  expect((await screen.findByRole('alert')).textContent).toBe('Install WeasyPrint');
  expect(screen.getByLabelText<HTMLInputElement>('Invoice number').value).toBe('2026-12');
  expect(
    screen.getByRole<HTMLInputElement>('checkbox', { name: /Select session for Alex/ }).checked,
  ).toBe(true);
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Download PDF' }).disabled).toBe(
    false,
  );
  fetch.mockRejectedValueOnce(new Error('Connection lost'));
  fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }));
  expect((await screen.findByRole('alert')).textContent).toBe('Connection lost');
  expect(fetch).toHaveBeenCalledTimes(3);
  fireEvent.click(screen.getByRole('button', { name: 'Generate duty report' }));
  expect(screen.queryByRole('alert')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Generate invoice' }));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByLabelText<HTMLInputElement>('Invoice number').value).toBe('2026-12');
});

test.each([
  ['2026-12-31T23:30:00Z', '2026-12', '', '2027-01-01'],
  ['2026-01-31T23:30:00Z', '2026-01', '0:00', '2026-02-01'],
])(
  'duty report defaults use the reporting timezone at %s, even with no sessions',
  async (now, month, carry, issueDate) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(now));
    respond({ timeZone: 'Europe/Berlin', sessions: [] });
    render(<App />);
    const trigger = await screen.findByRole<HTMLButtonElement>('button', {
      name: 'Generate duty report',
    });
    expect(trigger.disabled).toBe(false);
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Generate invoice' }).disabled,
    ).toBe(true);
    fireEvent.click(trigger);
    const monthInput = screen.getByLabelText<HTMLInputElement>('Month');
    const carryInput = screen.getByLabelText<HTMLInputElement>(
      'Flight-duty total before this month',
    );
    expect(document.activeElement).toBe(monthInput);
    expect(monthInput.type).toBe('month');
    expect(monthInput.value).toBe(month);
    expect(carryInput.value).toBe(carry);
    expect(carryInput.checkValidity()).toBe(carry !== '');
    expect(screen.getByLabelText<HTMLInputElement>('Issue date').value).toBe(issueDate);
    fireEvent.change(carryInput, { target: { value: '123:60' } });
    expect(carryInput.checkValidity()).toBe(false);
    fireEvent.change(carryInput, { target: { value: '123:45' } });
    expect(carryInput.checkValidity()).toBe(true);
    fireEvent.change(monthInput, { target: { value: '2027-01' } });
    expect(carryInput.value).toBe('0:00');
    fireEvent.change(monthInput, { target: { value: '2027-02' } });
    expect(carryInput.value).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('form')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  },
);

test('switching document forms preserves their independent details and shows only one form', async () => {
  respond({ timeZone: 'UTC', sessions: [session] });
  render(<App />);
  const reportTrigger = await screen.findByRole('button', { name: 'Generate duty report' });
  selectPreset('Select all');
  const invoiceTrigger = screen.getByRole('button', { name: 'Generate invoice' });
  fireEvent.click(invoiceTrigger);
  fireEvent.change(screen.getByLabelText('Invoice number'), { target: { value: '2026-123' } });
  fireEvent.change(screen.getByLabelText('Issue date'), { target: { value: '2026-10-05' } });
  fireEvent.click(reportTrigger);
  expect(screen.queryByRole('form', { name: 'Generate invoice' })).toBeNull();
  expect(invoiceTrigger.getAttribute('aria-expanded')).toBe('false');
  expect(reportTrigger.getAttribute('aria-expanded')).toBe('true');
  expect(document.activeElement).toBe(screen.getByLabelText('Month'));
  expect(document.getElementById(reportTrigger.getAttribute('aria-controls')!)).toBe(
    screen.getByRole('form', { name: 'Generate duty report' }),
  );
  fireEvent.change(screen.getByLabelText('Month'), { target: { value: '2026-09' } });
  fireEvent.change(screen.getByLabelText('Flight-duty total before this month'), {
    target: { value: '432:10' },
  });
  fireEvent.change(screen.getByLabelText('Issue date'), { target: { value: '2026-10-01' } });
  fireEvent.click(invoiceTrigger);
  expect(screen.getAllByRole('form')).toHaveLength(1);
  expect(document.activeElement).toBe(screen.getByLabelText('Invoice number'));
  expect(document.getElementById(invoiceTrigger.getAttribute('aria-controls')!)).toBe(
    screen.getByRole('form', { name: 'Generate invoice' }),
  );
  expect(screen.getByLabelText<HTMLInputElement>('Invoice number').value).toBe('2026-123');
  expect(screen.getByLabelText<HTMLInputElement>('Issue date').value).toBe('2026-10-05');
  fireEvent.click(reportTrigger);
  expect(screen.getByLabelText<HTMLInputElement>('Month').value).toBe('2026-09');
  expect(screen.getByLabelText<HTMLInputElement>('Flight-duty total before this month').value).toBe(
    '432:10',
  );
  expect(screen.getByLabelText<HTMLInputElement>('Issue date').value).toBe('2026-10-01');
  fireEvent.click(reportTrigger);
  expect(screen.queryByRole('form')).toBeNull();
});

test('duty report download ignores table selection and preserves details after an error', async () => {
  const fetch = respond({ timeZone: 'Europe/Berlin', sessions: [session] });
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn().mockReturnValue('blob:report'),
    revokeObjectURL: vi.fn(),
  });
  const downloads: string[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    downloads.push(this.download);
  });
  render(<App />);
  const trigger = await screen.findByRole<HTMLButtonElement>('button', {
    name: 'Generate duty report',
  });
  selectPreset('Select all');
  fireEvent.click(trigger);
  fireEvent.change(screen.getByLabelText('Month'), { target: { value: '2026-05' } });
  fireEvent.change(screen.getByLabelText('Flight-duty total before this month'), {
    target: { value: '120:00' },
  });
  fireEvent.change(screen.getByLabelText('Issue date'), { target: { value: '2026-06-09' } });
  fetch.mockResolvedValueOnce(
    new Response(JSON.stringify({ error: 'Install WeasyPrint' }), { status: 500 }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }));
  expect(trigger.disabled).toBe(true);
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Generate invoice' }).disabled).toBe(
    true,
  );
  expect(screen.getByLabelText<HTMLInputElement>('Month').matches(':disabled')).toBe(true);
  expect((await screen.findByRole('alert')).textContent).toBe('Install WeasyPrint');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  fireEvent.click(trigger);
  expect(screen.queryByRole('alert')).toBeNull();
  selectPreset('Clear selection');
  expect(trigger.disabled).toBe(false);
  expect(screen.getByLabelText<HTMLInputElement>('Month').value).toBe('2026-05');
  expect(screen.getByLabelText<HTMLInputElement>('Flight-duty total before this month').value).toBe(
    '120:00',
  );
  fetch.mockResolvedValueOnce(
    new Response('%PDF-1.7\nduty report', { headers: { 'Content-Type': 'application/pdf' } }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }));
  await waitFor(() => expect(downloads).toEqual(['Dienstzeitnachweis-2026-05.pdf']));
  expect(fetch).toHaveBeenLastCalledWith('/api/duty-report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      month: '2026-05',
      carryOverFlightDuty: '120:00',
      issueDate: '2026-06-09',
    }),
  });
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByLabelText<HTMLInputElement>('Issue date').value).toBe('2026-06-09');
  expect(screen.getByRole('status').textContent).toBe('0 of 1 session selected');
});
