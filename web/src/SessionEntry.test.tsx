import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vite-plus/test';
import { userEvent } from 'vite-plus/test/browser';
import App from './App';
import type { Session } from './sessions';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function sessionAPI(sessions: Session[] = []) {
  const entries: Session[] = [];
  const fetch = vi.fn(async (_url: string, options?: RequestInit) => {
    if (options?.method === 'POST') {
      const entry = JSON.parse(options.body as string) as Session;
      entries.push(entry);
      sessions = [
        ...sessions,
        { ...entry, dutyStart: `${entry.dutyStart}:00Z`, dutyEnd: `${entry.dutyEnd}:00Z` },
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

test('enters a session by keyboard, calculates totals, and saves individual flights', async () => {
  const { entries } = sessionAPI();
  await openEntry();
  expect(document.activeElement).toBe(screen.getByLabelText('Session date'));
  await userEvent.fill(screen.getByLabelText('Session date'), '2026-05-03');
  await userEvent.fill(screen.getByLabelText('Student'), 'New Student');
  await userEvent.keyboard('{Tab}0900{Tab}1230{Tab}30{Tab}');
  expect(document.activeElement).toBe(screen.getByLabelText('Flight 1 type'));
  expect((screen.getByLabelText('Duty start') as HTMLInputElement).value).toBe('09:00');
  expect((screen.getByLabelText('Duty end') as HTMLInputElement).value).toBe('12:30');
  await userEvent.keyboard('{Tab}45{Tab}{Tab}{Enter}');
  expect(document.activeElement).toBe(screen.getByLabelText('Flight 2 duration'));
  await userEvent.keyboard('1:15');
  expect(screen.getByLabelText('Dual total').textContent).toBe('2:00');
  expect(screen.getByLabelText('Dual total').tagName).toBe('SPAN');
  await userEvent.click(screen.getByRole('button', { name: 'Add flight' }));
  await userEvent.selectOptions(screen.getByLabelText('Flight 3 type'), 'soloSupervision');
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
  expect(within(flights).getAllByRole('row')).toHaveLength(4);
  expect(within(flights).getByText('1:15')).toBeTruthy();
});

test('save-and-add shortcut retains the date, resets inputs, and focuses the student', async () => {
  const { entries } = sessionAPI();
  await openEntry();
  await fillBasics();
  await userEvent.fill(screen.getByLabelText('Preparation duration'), '0:30');
  await userEvent.fill(screen.getByLabelText('Flight 1 duration'), '65');
  await userEvent.keyboard('{Control>}{Enter}{/Control}');
  await screen.findByRole('rowheader', { name: 'New Student' });
  await expect.poll(() => document.activeElement).toBe(screen.getByLabelText('Student'));
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
  expect(screen.getByLabelText('Dual total').textContent).toBe('0:00');
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

test('removing flights updates totals and keeps keyboard focus in the editor', async () => {
  sessionAPI();
  await openEntry();
  await userEvent.fill(screen.getByLabelText('Flight 1 duration'), '45');
  await userEvent.click(screen.getByRole('button', { name: 'Add flight' }));
  await userEvent.fill(screen.getByLabelText('Flight 2 duration'), '15');
  await userEvent.click(screen.getByRole('button', { name: 'Remove flight 1' }));
  expect(screen.getByLabelText('Dual total').textContent).toBe('0:15');
  await expect.poll(() => document.activeElement).toBe(screen.getByLabelText('Flight 1 duration'));
  await userEvent.click(screen.getByRole('button', { name: 'Remove flight 1' }));
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add flight' }));
  expect(screen.getByLabelText('Dual total').textContent).toBe('0:00');
});

test('validates entries, infers overnight duty, and preserves data after errors', async () => {
  const { fetch, entries } = sessionAPI();
  await openEntry();
  await fillBasics();
  await userEvent.fill(screen.getByLabelText('Duty start'), '2460');
  await userEvent.click(screen.getByRole('button', { name: 'Save session' }));
  expect(screen.getByRole('alert').textContent).toContain('duty start');
  expect(document.activeElement).toBe(screen.getByLabelText('Duty start'));
  await userEvent.fill(screen.getByLabelText('Duty start'), '2300');
  await userEvent.fill(screen.getByLabelText('Duty end'), '0100');
  await userEvent.fill(screen.getByLabelText('Flight 1 duration'), '1:99');
  await userEvent.click(screen.getByRole('button', { name: 'Save session' }));
  expect(screen.getByRole('alert').textContent).toContain('flight duration');
  await userEvent.fill(screen.getByLabelText('Flight 1 duration'), '45');
  expect(screen.getByText(/Next day:/).textContent).toContain('04.05.2026');
  fetch.mockResolvedValueOnce(Response.json({ error: 'Disk is full' }, { status: 500 }));
  await userEvent.click(screen.getByRole('button', { name: 'Save session' }));
  expect((await screen.findByRole('alert')).textContent).toBe('Disk is full');
  expect((screen.getByLabelText('Flight 1 duration') as HTMLInputElement).value).toBe('45');
  const failedRequest = fetch.mock.calls.at(-1)![1]!.body;
  await userEvent.click(screen.getByRole('button', { name: 'Save session' }));
  await screen.findByRole('rowheader', { name: 'New Student' });
  expect(fetch.mock.calls.at(-1)![1]!.body).toBe(failedRequest);
  expect(entries[0]).toMatchObject({
    dutyEnd: '2026-05-04T01:00',
    student: 'New Student',
    description: '',
  });
});

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
  expect(
    screen
      .getByText(/Next day:/)
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
