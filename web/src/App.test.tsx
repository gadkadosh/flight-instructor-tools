// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vite-plus/test';
import App from './App';

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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test('loads sessions in file order and expands flights by clicking any cell', async () => {
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
  expect(cells[0].contains(toggle)).toBe(true);
  expect(cells.slice(1).map((cell) => cell.textContent)).toEqual([
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

  fireEvent.click(cells[1]);
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
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

test('preparation-only sessions have no flight expansion', async () => {
  respond({ timeZone: 'UTC', sessions: [{ ...session, activities: [session.activities[0]] }] });
  render(<App />);
  await screen.findByText('Alex Beispiel');
  expect(screen.getByText('0:15')).toBeTruthy();
  expect(screen.queryByRole('button')).toBeNull();
});

test('shows the end date for sessions crossing midnight in the display timezone', async () => {
  respond({ timeZone: 'UTC', sessions: [{ ...session, dutyEnd: '2026-05-04T01:00:00Z' }] });
  render(<App />);
  await screen.findByRole('button');
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
