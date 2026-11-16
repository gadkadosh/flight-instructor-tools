import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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
  description: 'Circuit practice',
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
  vi.unstubAllGlobals();
  vi.useRealTimers();
  await page.viewport(1280, 720);
});

function selectPreset(name: string) {
  fireEvent.click(screen.getByRole('checkbox', { name: /^Select sessions \(/ }));
  fireEvent.click(screen.getByRole('menuitem', { name }));
}

test('loads sessions in file order and expands flights by clicking a data cell', async () => {
  const fetch = respond({
    timeZone: 'Europe/Berlin',
    sessions: [
      session,
      {
        ...session,
        id: 'session-2',
        student: undefined,
        description: 'Sightseeing',
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
  const rows = within(screen.getByRole('table', { name: 'Sessions in file order' })).getAllByRole(
    'row',
  );
  expect(rows).toHaveLength(3);
  expect(rows[1].textContent).toContain('Alex Beispiel');
  expect(rows[2].textContent).toContain('Sightseeing');
  const cells = within(rows[1]).getAllByRole('cell');
  expect(cells[1].contains(toggle)).toBe(true);
  expect(cells.slice(2).map((cell) => cell.textContent)).toEqual([
    '04.05.2026',
    '00:30 LT',
    '01:55 LT',
    '0:15',
    '1:05',
    '0:05',
  ]);
  expect(within(rows[1]).getByText('Circuit practice')).toBeTruthy();
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(
    screen.queryByRole('table', { name: 'Flights for Alex Beispiel on 04.05.2026' }),
  ).toBeNull();
  expect(screen.queryByRole('columnheader', { name: 'Activities' })).toBeNull();

  fireEvent.click(cells[2]);
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  expect(within(rows[1]).getByRole<HTMLInputElement>('checkbox').checked).toBe(false);
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

test('selects sessions individually and in bulk without expanding flights', async () => {
  respond({
    timeZone: 'UTC',
    sessions: [session, { ...session, id: 'session-2', student: 'Sam Beispiel' }],
  });
  render(<App />);
  const selectionMenu = await screen.findByRole<HTMLInputElement>('checkbox', {
    name: 'Select sessions (0 of 2 selected)',
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
  expect([selectionMenu.checked, selectionMenu.indeterminate]).toEqual([false, false]);
  expect(screen.getByRole('status').textContent).toBe('0 of 2 sessions selected');

  fireEvent.click(alex);
  expect([alex.checked, sam.checked]).toEqual([true, false]);
  expect(selectionMenu.getAttribute('aria-label')).toBe('Select sessions (1 of 2 selected)');
  expect([selectionMenu.checked, selectionMenu.indeterminate]).toEqual([false, true]);
  expect(screen.getByRole('status').textContent).toBe('1 of 2 sessions selected');
  expect(alex.closest('tr')?.getAttribute('data-selected')).toBe('true');
  expect(toggle.getAttribute('aria-expanded')).toBe('false');

  fireEvent.click(selectionMenu);
  expect([selectionMenu.checked, selectionMenu.indeterminate]).toEqual([false, true]);
  expect([alex.checked, sam.checked]).toEqual([true, false]);
  await userEvent.keyboard('{Escape}');
  expect([selectionMenu.checked, selectionMenu.indeterminate]).toEqual([false, true]);

  fireEvent.click(toggle);
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  expect(alex.checked).toBe(true);
  const flights = screen.getByRole('table', { name: 'Flights for Alex Beispiel on 03.05.2026' });
  expect(flights.closest('td')?.colSpan).toBe(9);

  selectPreset('Select all');
  expect([alex.checked, sam.checked]).toEqual([true, true]);
  expect([selectionMenu.checked, selectionMenu.indeterminate]).toEqual([true, false]);
  expect(screen.getByRole('status').textContent).toBe('2 of 2 sessions selected');
  expect(toggle.getAttribute('aria-expanded')).toBe('true');

  fireEvent.click(alex);
  expect([alex.checked, sam.checked]).toEqual([false, true]);
  expect(screen.getByRole('status').textContent).toBe('1 of 2 sessions selected');
  expect(alex.closest('tr')?.getAttribute('data-selected')).toBe('false');
  expect(toggle.getAttribute('aria-expanded')).toBe('true');

  selectPreset('Clear selection');
  expect([alex.checked, sam.checked]).toEqual([false, false]);
  expect([selectionMenu.checked, selectionMenu.indeterminate]).toEqual([false, false]);
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
  await screen.findByRole('checkbox', { name: /^Select sessions \(/ });
  selectPreset('Select all');
  for (let attempt = 0; attempt < 2; attempt++) {
    selectPreset(preset);
    const selected = screen
      .getAllByRole<HTMLInputElement>('checkbox', { name: /^Select session for / })
      .filter((checkbox) => checkbox.checked)
      .map((checkbox) => within(checkbox.closest('tr')!).getByRole('rowheader').textContent);
    expect(selected).toEqual(expected.map((student) => `${student}Circuit practice`));
    expect(screen.getByRole('status').textContent).toBe(
      `${expected.length} of 8 sessions selected`,
    );
    expect(screen.queryByRole('menu')).toBeNull();
  }
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
  await screen.findByRole('checkbox', { name: /^Select sessions \(/ });
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
  const trigger = await screen.findByRole<HTMLInputElement>('checkbox', {
    name: /^Select sessions \(/,
  });
  await userEvent.click(trigger);
  expect([trigger.checked, trigger.indeterminate]).toEqual([false, false]);
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
  expect(trigger.checked).toBe(false);
  expect(
    screen.getByRole<HTMLInputElement>('checkbox', { name: /^Select session for / }).checked,
  ).toBe(false);
  await userEvent.keyboard('{Escape}');

  await userEvent.keyboard('{Enter}');
  expect(screen.getByRole('menu')).toBeTruthy();
  expect(trigger.checked).toBe(false);
  await userEvent.keyboard('{Escape}');

  await userEvent.keyboard('{ArrowDown}');
  await userEvent.click(screen.getByRole('menuitem', { name: 'Select all' }));
  expect(document.activeElement).toBe(trigger);
  expect([trigger.checked, trigger.indeterminate]).toEqual([true, false]);
  expect(
    screen.getByRole<HTMLInputElement>('checkbox', { name: /^Select session for / }).checked,
  ).toBe(true);

  await userEvent.keyboard('{ArrowUp}');
  expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Clear selection' }));
  await userEvent.keyboard('{Tab}');
  expect(screen.queryByRole('menu')).toBeNull();
  expect(document.activeElement).toBe(
    screen.getByRole('checkbox', { name: /^Select session for / }),
  );

  await userEvent.click(trigger);
  expect([trigger.checked, trigger.indeterminate]).toEqual([true, false]);
  await userEvent.click(screen.getByRole('heading', { name: 'Sessions' }));
  expect(screen.queryByRole('menu')).toBeNull();
  expect(
    screen.getByRole<HTMLInputElement>('checkbox', { name: /^Select session for / }).checked,
  ).toBe(true);

  await userEvent.click(trigger);
  await userEvent.click(trigger);
  expect(screen.queryByRole('menu')).toBeNull();
  expect([trigger.checked, trigger.indeterminate]).toEqual([true, false]);
});

test.each([720, 320, 240])('selection menu stays onscreen at 568 × %i', async (height) => {
  await page.viewport(568, height);
  respond({ timeZone: 'UTC', sessions: [session] });
  render(<App />);
  const trigger = await screen.findByRole('checkbox', { name: /^Select sessions \(/ });
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
  const onSelect = vi.fn();
  render(
    <div style={{ position: 'fixed', top: '50%', left: '1rem' }}>
      <SelectionMenu sessions={[session]} timeZone="UTC" selectedCount={1} onSelect={onSelect} />
    </div>,
  );
  await userEvent.click(screen.getByRole('checkbox'));
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
  expect(onSelect).toHaveBeenCalledExactlyOnceWith([]);
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
  expect(screen.getByRole('checkbox', { name: 'Select sessions (1 of 1 selected)' })).toBeTruthy();
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
