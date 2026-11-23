import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vite-plus/test';
import { page, userEvent } from 'vite-plus/test/browser';
import App from './App';
import { zonedInstant, type Session } from './sessions';
import './style.css';

afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  await page.viewport(1280, 720);
});

function sessionAPI(sessions: Session[] = [], timeZone = 'UTC') {
  const entries: Omit<Session, 'etag'>[] = [];
  const fetch = vi.fn(async (url: string, options?: RequestInit) => {
    if (options?.method === 'POST' || options?.method === 'PUT') {
      const entry = JSON.parse(options.body as string) as Omit<Session, 'etag'>;
      // Like the server, read wall-clock duty times as instants in the time zone.
      const instant = (value: string) =>
        new Date(zonedInstant(timeZone, value.slice(0, 10), value.slice(11))).toISOString();
      const saved = {
        ...entry,
        etag: `"${entry.id}-${entries.length}"`,
        dutyStart: instant(entry.dutyStart),
        dutyEnd: instant(entry.dutyEnd),
      };
      if (options.method === 'PUT') {
        const current = sessions.find(
          ({ id }) => url === `/api/sessions/${encodeURIComponent(id)}`,
        );
        if (new Headers(options.headers).get('If-Match') !== current?.etag) {
          return Response.json(
            { error: 'this session changed; reload the page and review it before saving' },
            { status: 412 },
          );
        }
        sessions = sessions.map((session) => (session === current ? saved : session));
      } else {
        sessions = [...sessions, saved];
      }
      entries.push(entry);
    }
    return Response.json({ sessions, timeZone });
  });
  vi.stubGlobal('fetch', fetch);
  return { fetch, entries };
}

function berlinAPI() {
  const fetch = vi.fn(async (_url: string, _options?: RequestInit) =>
    Response.json({ sessions: [], timeZone: 'Europe/Berlin' }),
  );
  vi.stubGlobal('fetch', fetch);
  return fetch;
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
      id: 'first-flight',
      type: 'dual',
      blockOff: '2026-05-02T09:00:00Z',
      blockOn: '2026-05-02T09:20:00Z',
      departure: 'EDFH',
      arrival: 'EDFH',
      registration: 'D-EAAA',
      landings: 1,
    },
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
    .slice(0, 10)
    .map((header) => {
      const { x, width } = header.getBoundingClientRect();
      return { x, width, align: getComputedStyle(header).textAlign };
    });
}

test('enters a session by keyboard, calculates block times, and saves individual flights', async () => {
  const older: Session = {
    ...previousSession,
    id: 'older',
    dutyStart: '2026-05-01T09:00:00Z',
    dutyEnd: '2026-05-01T11:00:00Z',
    activities: [previousSession.activities[0]!],
  };
  const { entries } = sessionAPI([older, previousSession]);
  await openEntry();
  const editor = screen.getByRole('table', { name: 'New session flights' });
  expect(
    within(editor)
      .getAllByRole('columnheader')
      .map((header) => header.textContent),
  ).toEqual([
    'Type',
    'Aircraft',
    'From',
    'To',
    'Block off UTC',
    'Takeoff UTC',
    'Landing UTC',
    'Block on UTC',
    'Landings',
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
  // Tab past the prefilled aircraft and airfields, then the optional takeoff and landing.
  await userEvent.keyboard('{Tab}{Tab}{Tab}{Tab}945{Tab}{Tab}{Tab}1030{Tab}5{Tab}');
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Remove flight 1' }));
  expect(value('Flight 1 block off')).toBe('09:45');
  expect(screen.getByLabelText('Flight 1 block time').textContent).toBe('0:45');
  await userEvent.click(screen.getByRole('button', { name: 'Add flight' }));
  expect(document.activeElement).toBe(screen.getByLabelText('Flight 2 block off'));
  await userEvent.keyboard('1040{Tab}{Tab}{Tab}1155');
  expect(screen.getByLabelText('Block time total').textContent).toBe('2:00');
  expect(screen.getByLabelText('Block time total').tagName).toBe('SPAN');
  await userEvent.click(screen.getByRole('button', { name: 'Add flight' }));
  await userEvent.selectOptions(screen.getByLabelText('Flight 3 type'), 'soloSupervision');
  expect(value('Flight 2 block on')).toBe('11:55');
  await userEvent.fill(screen.getByLabelText('Flight 3 block off'), '1200');
  await userEvent.fill(screen.getByLabelText('Flight 3 block on'), '1220');
  await userEvent.fill(screen.getByLabelText('Flight 3 takeoff time'), '1203');
  await userEvent.fill(screen.getByLabelText('Flight 3 landing time'), '1218');
  await userEvent.fill(screen.getByLabelText('Flight 3 registration'), 'd-eklm');
  await userEvent.fill(screen.getByLabelText('Flight 3 departure'), 'edfz');
  await userEvent.fill(screen.getByLabelText('Flight 3 arrival'), 'edfe');
  expect(getComputedStyle(screen.getByLabelText('Flight 3 arrival')).textTransform).toBe(
    'uppercase',
  );
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
        blockOff: '2026-05-03T09:45:00.000Z',
        blockOn: '2026-05-03T10:30:00.000Z',
        arrival: 'EDFZ',
        landings: 5,
        ...carried,
      },
      {
        type: 'dual',
        blockOff: '2026-05-03T10:40:00.000Z',
        blockOn: '2026-05-03T11:55:00.000Z',
        arrival: 'EDFZ',
        landings: 1,
        ...carried,
      },
      {
        type: 'soloSupervision',
        blockOff: '2026-05-03T12:00:00.000Z',
        blockOn: '2026-05-03T12:20:00.000Z',
        firstTakeoff: '2026-05-03T12:03:00.000Z',
        lastLanding: '2026-05-03T12:18:00.000Z',
        arrival: 'EDFE',
        ...carried,
      },
    ],
  });
  expect(entries[0]!.activities[1]).not.toHaveProperty('firstTakeoff');
  expect(entries[0]!.activities[1]).not.toHaveProperty('minutes');
  expect(new Set(entries[0]!.activities.map((activity) => activity.id)).size).toBe(4);
  expect(screen.queryByRole('form', { name: 'New session' })).toBeNull();
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
  for (const [label, message] of [
    ['block on', 'Enter block on'],
    ['landings', 'Enter landings'],
    ['departure', 'ICAO'],
    ['arrival', 'ICAO'],
    ['registration', 'Enter the aircraft registration'],
  ] as const) {
    const input = screen.getByLabelText<HTMLInputElement>(`Flight 1 ${label}`);
    const valid = input.value;
    await userEvent.clear(input);
    await save();
    expect(screen.getByRole('alert').textContent).toContain(message);
    expect(document.activeElement).toBe(input);
    await userEvent.fill(input, valid);
  }
  expect(entries).toHaveLength(0);
  await userEvent.fill(screen.getByLabelText('Flight 1 arrival'), 'EDFZ');
  await save();
  await screen.findByRole('rowheader', { name: 'New Student' });
  expect(entries[0]!.activities).toEqual([
    expect.objectContaining({
      blockOff: '2026-05-03T10:00:00.000Z',
      firstTakeoff: '2026-05-03T10:00:00.000Z',
      lastLanding: '2026-05-03T11:00:00.000Z',
      blockOn: '2026-05-03T11:00:00.000Z',
      arrival: 'EDFZ',
    }),
  ]);
});

test.for([
  ['0900', '1200', '0859', '1000', 'block off'],
  ['0900', '1200', '1100', '1201', 'block on'],
  ['0900', '1200', '1400', '1500', 'block off'],
  ['2200', '0200', '2100', '2150', 'block off'],
  ['2200', '0200', '2150', '2230', 'block off'],
  ['2200', '0200', '0130', '0201', 'block on'],
  ['2200', '0200', '0300', '0400', 'block off'],
] as const)(
  'rejects a flight outside duty: %s–%s duty, %s–%s block',
  async ([dutyStart, dutyEnd, blockOff, blockOn, invalid]) => {
    const { entries } = sessionAPI();
    await openEntry();
    await fillBasics();
    await userEvent.fill(screen.getByLabelText('Duty start'), dutyStart);
    await userEvent.fill(screen.getByLabelText('Duty end'), dutyEnd);
    await fillFlight(1, blockOff, blockOn);
    await userEvent.click(screen.getByRole('button', { name: 'Save session' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      `${invalid === 'block off' ? 'Block off' : 'Block on'} must be within duty time.`,
    );
    expect(document.activeElement).toBe(screen.getByLabelText(`Flight 1 ${invalid}`));
    expect(entries).toHaveLength(0);
  },
);

test.for([
  ['0900', '1200', '2026-05-03T09:00:00.000Z', '2026-05-03T12:00:00.000Z'],
  ['2200', '0200', '2026-05-03T22:00:00.000Z', '2026-05-04T02:00:00.000Z'],
] as const)(
  'accepts a flight filling %s–%s duty',
  async ([dutyStart, dutyEnd, blockOff, blockOn]) => {
    const { entries } = sessionAPI();
    await openEntry();
    await fillBasics();
    await userEvent.fill(screen.getByLabelText('Duty start'), dutyStart);
    await userEvent.fill(screen.getByLabelText('Duty end'), dutyEnd);
    await fillFlight(1, dutyStart, dutyEnd);
    await userEvent.click(screen.getByRole('button', { name: 'Save session' }));
    await screen.findByRole('rowheader', { name: 'New Student' });
    expect(entries[0]!.activities).toEqual([expect.objectContaining({ blockOff, blockOn })]);
  },
);

test.for([
  // Winter: UTC+1.
  [
    '2026-11-15',
    '0830',
    '1330',
    '0838',
    '0947',
    '2026-11-15T08:38:00.000Z',
    '2026-11-15T09:47:00.000Z',
  ],
  // Summer: UTC+2, so this duty starts on the previous UTC date.
  [
    '2026-05-03',
    '0030',
    '0230',
    '2245',
    '0015',
    '2026-05-02T22:45:00.000Z',
    '2026-05-03T00:15:00.000Z',
  ],
] as const)(
  'enters flight times in UTC for a session in Berlin on %s, %s–%s',
  async ([date, dutyStart, dutyEnd, blockOff, blockOn, savedOff, savedOn]) => {
    const fetch = berlinAPI();
    await openEntry();
    await fillBasics();
    await userEvent.fill(screen.getByLabelText('Session date'), date);
    await userEvent.fill(screen.getByLabelText('Duty start'), dutyStart);
    await userEvent.fill(screen.getByLabelText('Duty end'), dutyEnd);
    await fillFlight(1, blockOff, blockOn);
    expect(screen.getByLabelText('Flight 1 block time').textContent).not.toBe('0:00');
    await userEvent.click(screen.getByRole('button', { name: 'Save session' }));
    await expect.poll(() => fetch.mock.calls.length).toBe(2);
    const entry = JSON.parse(fetch.mock.calls[1]![1]!.body as string);
    expect(entry).toMatchObject({
      dutyStart: `${date}T${dutyStart.slice(0, 2)}:${dutyStart.slice(2)}`,
      activities: [expect.objectContaining({ blockOff: savedOff, blockOn: savedOn })],
    });
  },
);

test.for([
  ['0729', '0800', 'block off'],
  ['1230', '1231', 'block on'],
] as const)(
  'rejects UTC flight times %s–%s outside 08:30–13:30 duty in Berlin',
  async ([blockOff, blockOn, invalid]) => {
    const fetch = berlinAPI();
    await openEntry();
    await fillBasics();
    await userEvent.fill(screen.getByLabelText('Session date'), '2026-11-15');
    await userEvent.fill(screen.getByLabelText('Duty start'), '0830');
    await userEvent.fill(screen.getByLabelText('Duty end'), '1330');
    await fillFlight(1, blockOff, blockOn);
    await userEvent.click(screen.getByRole('button', { name: 'Save session' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      `${invalid === 'block off' ? 'Block off' : 'Block on'} must be within duty time.`,
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  },
);

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
  await userEvent.fill(screen.getByLabelText('Flight 1 takeoff time'), '0005');
  await userEvent.fill(screen.getByLabelText('Flight 1 landing time'), '0030');
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
      blockOff: '2026-05-03T23:30:00.000Z',
      blockOn: '2026-05-04T00:35:00.000Z',
      firstTakeoff: '2026-05-04T00:05:00.000Z',
      lastLanding: '2026-05-04T00:30:00.000Z',
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

  // Tab through the prefilled row as far as landing, then submit.
  await userEvent.keyboard(`Second Student{Tab}13{Tab}14{Tab}45${'{Tab}'.repeat(7)}{Enter}`);
  await screen.findByRole('rowheader', { name: 'Second Student' });
  expect(entries).toHaveLength(2);
  expect(entries[1]!.id).not.toBe(entries[0]!.id);
  // The carried-over details alone do not make an unused row a flight.
  expect(entries[1]!.activities).toEqual([
    expect.objectContaining({ type: 'preparation', minutes: 45 }),
  ]);
});

test.for([
  ['registration', 'D-EFTI', 3, 'kl', 'D-EKLI'],
  ['arrival', 'EDFE', 1, 'tm', 'ETME'],
] as const)(
  'editing inside the %s keeps the cursor and undo',
  async ([name, initial, from, typed, edited]) => {
    sessionAPI();
    await openEntry();
    const input = screen.getByLabelText<HTMLInputElement>(`Flight 1 ${name}`);
    await userEvent.fill(input, initial);
    input.setSelectionRange(from, from + typed.length);
    await userEvent.keyboard(typed);
    expect(input.value.toUpperCase()).toBe(edited);
    await userEvent.keyboard('{ControlOrMeta>}z{/ControlOrMeta}');
    if (input.value !== initial) await userEvent.keyboard('{ControlOrMeta>}z{/ControlOrMeta}');
    expect(input.value).toBe(initial);
  },
);

test.for(['arrival', 'type'])('reports a flight with an edited %s but no times', async (field) => {
  const { entries } = sessionAPI([previousSession]);
  await openEntry();
  await fillBasics();
  await userEvent.fill(screen.getByLabelText('Preparation duration'), '30');
  const input = screen.getByLabelText(`Flight 1 ${field}`);
  if (field === 'type') await userEvent.selectOptions(input, 'rundflug');
  else await userEvent.fill(input, 'EDDF');
  await userEvent.click(screen.getByRole('button', { name: 'Save session' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Enter block off');
  expect(document.activeElement).toBe(screen.getByLabelText('Flight 1 block off'));
  expect(entries).toHaveLength(0);
});

test('save-and-add carries over from the last saved flight, not the last row', async () => {
  const { entries } = sessionAPI([previousSession]);
  await openEntry();
  await fillBasics();
  await userEvent.click(screen.getByRole('button', { name: 'Add flight' }));
  await fillFlight(1, '1000', '1100');
  await userEvent.click(screen.getByRole('button', { name: 'Save and add another' }));
  await expect.poll(() => value('Student')).toBe('');
  const carried = () =>
    ['departure', 'arrival', 'registration'].map((field) => value(`Flight 1 ${field}`));
  expect(carried()).toEqual(['EDFE', 'EDFE', 'D-EFTI']);

  await fillBasics();
  await userEvent.fill(screen.getByLabelText('Preparation duration'), '30');
  await userEvent.click(screen.getByRole('button', { name: 'Remove flight 1' }));
  await userEvent.click(screen.getByRole('button', { name: 'Save and add another' }));
  await expect.poll(() => entries.length).toBe(2);
  await expect.poll(() => value('Student')).toBe('');
  expect(carried()).toEqual(['EDFE', 'EDFE', 'D-EFTI']);
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
    expect.objectContaining({ type: 'rundflug', blockOff: '2026-05-03T09:15:00.000Z' }),
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
  const form = screen.getByRole('form', { name: 'New session' });
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
          blockOff: '2026-05-03T23:15:00.000Z',
          blockOn: '2026-05-04T00:00:00.000Z',
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
  expect(screen.queryByRole('form', { name: 'New session' })).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add session' }));
});

const editButton = (name: RegExp) => screen.getByRole('button', { name });

async function openEditor(student: string) {
  render(<App />);
  await screen.findByRole('rowheader', { name: student });
  // Like a mouse user, point at the row to reveal its buttons.
  await page.getByRole('rowheader', { name: student }).hover();
  await userEvent.click(editButton(new RegExp(`Edit session for ${student}`)));
}

test('edits a session in place and saves the corrected values under the same ID', async () => {
  const later: Session = {
    ...previousSession,
    id: 'later',
    etag: '"later"',
    student: 'Later Student',
    dutyStart: '2026-05-02T12:00:00Z',
    dutyEnd: '2026-05-02T13:00:00Z',
    activities: [{ id: 'later-prep', type: 'preparation', minutes: 45 }],
  };
  const earliest: Session = {
    ...later,
    id: 'earliest',
    etag: '"earliest"',
    student: 'Earliest Student',
    dutyStart: '2026-05-02T07:00:00Z',
    dutyEnd: '2026-05-02T08:00:00Z',
  };
  const { fetch, entries } = sessionAPI([previousSession, later, earliest]);
  await openEditor('Earlier Student');
  const row = (student: string) => screen.getByRole('rowheader', { name: student }).closest('tr')!;

  const form = screen.getByRole('form', { name: 'Edit session' });
  const entryRow = screen.getByLabelText('Session date').closest('tr')!;
  // The form takes the row's place, between the later and earlier sessions of the day.
  expect(screen.queryByRole('rowheader', { name: 'Earlier Student' })).toBeNull();
  expect(row('Later Student').compareDocumentPosition(entryRow)).toBe(
    Node.DOCUMENT_POSITION_FOLLOWING,
  );
  expect(row('Earliest Student').compareDocumentPosition(entryRow)).toBe(
    Node.DOCUMENT_POSITION_PRECEDING,
  );
  expect(document.activeElement).toBe(screen.getByLabelText('Session date'));
  expect(
    ['Session date', 'Student', 'Duty start', 'Duty end', 'Preparation duration'].map(value),
  ).toEqual(['2026-05-02', 'Earlier Student', '09:00', '11:00', '']);
  expect(
    ['type', 'registration', 'departure', 'arrival', 'block off', 'block on', 'landings'].map(
      (field) => value(`Flight 2 ${field}`),
    ),
  ).toEqual(['dual', 'D-EKLM', 'EDFE', 'EDFZ', '09:30', '10:30', '1']);
  expect(screen.getByLabelText('Block time total').textContent).toBe('1:20');
  expect(within(form).queryByRole('button', { name: 'Save and add another' })).toBeNull();

  await userEvent.fill(screen.getByLabelText('Student'), 'Corrected Student');
  await userEvent.fill(screen.getByLabelText('Flight 2 block on'), '1040');
  await userEvent.fill(screen.getByLabelText('Flight 2 landings'), '3');
  await userEvent.keyboard('{Control>}{Enter}{/Control}');

  await screen.findByRole('rowheader', { name: 'Corrected Student' });
  expect(screen.queryByRole('form', { name: 'Edit session' })).toBeNull();
  expect(fetch).toHaveBeenLastCalledWith('/api/sessions/previous', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'If-Match': '"previous"' },
    body: expect.any(String),
  });
  expect(entries).toEqual([
    {
      id: 'previous',
      dutyStart: '2026-05-02T09:00',
      dutyEnd: '2026-05-02T11:00',
      student: 'Corrected Student',
      activities: [
        {
          ...previousSession.activities[0],
          blockOff: '2026-05-02T09:00:00.000Z',
          blockOn: '2026-05-02T09:20:00.000Z',
        },
        {
          ...previousSession.activities[1],
          blockOff: '2026-05-02T09:30:00.000Z',
          blockOn: '2026-05-02T10:40:00.000Z',
          landings: 3,
        },
      ],
    },
  ]);
  expect(document.activeElement).toBe(editButton(/Edit session for Corrected Student/));
  const subjects = document.querySelectorAll('.session-subject');
  expect([...subjects].map((subject) => subject.textContent)).toEqual([
    'Later Student',
    'Corrected Student',
    'Earliest Student',
  ]);
  await userEvent.click(screen.getByRole('button', { name: /Show flights for Corrected/ }));
  const flights = screen.getByRole('table', { name: /Flights for Corrected Student/ });
  expect(within(flights).getByText('1:10')).toBeTruthy();
});

// Times as instants, so 10:00:00Z and 10:00:00.000Z compare equal.
const instants = (value: unknown) =>
  JSON.parse(JSON.stringify(value), (_key, field) =>
    typeof field === 'string' && /^\d{4}-\d\d-\d\dT.*Z$/.test(field)
      ? new Date(field).toISOString()
      : field,
  );

test('saving an overnight session in Berlin unchanged sends back exactly what is stored', async () => {
  // Duty 23:00–03:00 in Berlin (UTC+2); the flights cross midnight UTC.
  const night: Session = {
    id: 'night',
    etag: '"night"',
    student: 'Night Student',
    dutyStart: '2026-05-03T21:00:00Z',
    dutyEnd: '2026-05-04T01:00:00Z',
    activities: [
      { id: 'night-briefing', type: 'preparation', minutes: 75 },
      {
        id: 'night-dual',
        type: 'dual',
        blockOff: '2026-05-03T23:40:00Z',
        firstTakeoff: '2026-05-03T23:45:00Z',
        lastLanding: '2026-05-04T00:20:00Z',
        blockOn: '2026-05-04T00:25:00Z',
        departure: 'EDFE',
        arrival: 'EDFZ',
        registration: 'D-EFTI',
        landings: 4,
      },
      {
        id: 'night-solo',
        type: 'soloSupervision',
        blockOff: '2026-05-04T00:30:00Z',
        blockOn: '2026-05-04T00:50:00Z',
        departure: 'EDFZ',
        arrival: 'EDFE',
        registration: 'D-EFTI',
        landings: 1,
      },
    ],
  };
  const { entries } = sessionAPI([night], 'Europe/Berlin');
  await openEditor('Night Student');
  expect(['Session date', 'Duty start', 'Duty end', 'Preparation duration'].map(value)).toEqual([
    '2026-05-03',
    '23:00',
    '03:00',
    '1:15',
  ]);
  expect(screen.getByText(/Duty ends the next day/).querySelector('time')?.dateTime).toBe(
    '2026-05-04',
  );
  expect(
    ['block off', 'takeoff time', 'landing time', 'block on'].map((field) =>
      value(`Flight 1 ${field}`),
    ),
  ).toEqual(['23:40', '23:45', '00:20', '00:25']);
  expect(value('Flight 2 takeoff time')).toBe('');
  await userEvent.click(screen.getByRole('button', { name: 'Save session' }));
  await screen.findByRole('rowheader', { name: 'Night Student' });

  const { etag: _, ...stored } = night;
  expect(entries).toHaveLength(1);
  expect(instants(entries[0]!.activities)).toEqual(instants(stored.activities));
  expect(entries[0]).toEqual({
    ...stored,
    dutyStart: '2026-05-03T23:00',
    dutyEnd: '2026-05-04T03:00',
    activities: entries[0]!.activities,
  });
});

test('a save refused as outdated keeps the edits and explains why', async () => {
  const { fetch, entries } = sessionAPI([previousSession]);
  await openEditor('Earlier Student');
  // Another window saved a newer version after this one loaded.
  fetch.mockImplementationOnce(async () =>
    Response.json(
      { error: 'this session changed; reload the page and review it before saving' },
      { status: 412 },
    ),
  );
  await userEvent.fill(screen.getByLabelText('Flight 1 landings'), '2');
  await userEvent.click(screen.getByRole('button', { name: 'Save session' }));
  expect((await screen.findByRole('alert')).textContent).toBe(
    'this session changed; reload the page and review it before saving',
  );
  expect(value('Flight 1 landings')).toBe('2');
  expect(screen.getByRole('form', { name: 'Edit session' })).toBeTruthy();
  expect(entries).toHaveLength(0);
});

test('cancelling an edit restores the row without saving', async () => {
  const { fetch } = sessionAPI([previousSession]);
  await openEditor('Earlier Student');
  await userEvent.fill(screen.getByLabelText('Student'), 'Discarded');
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('form', { name: 'Edit session' })).toBeNull();
  expect(screen.getByRole('rowheader', { name: 'Earlier Student' })).toBeTruthy();
  expect(document.activeElement).toBe(editButton(/Edit session for Earlier/));
  expect(fetch).toHaveBeenCalledTimes(1);
});
