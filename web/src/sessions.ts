export type ActivityType =
  | 'preparation'
  | 'dual'
  | 'soloSupervision'
  | 'rundflug'
  | 'schnupperflug';

export type FlightType = Exclude<ActivityType, 'preparation'>;

// One block as a pilot logbook records it. Times are absolute ISO timestamps.
export interface Flight {
  blockOff: string;
  blockOn: string;
  firstTakeoff?: string;
  lastLanding?: string;
  departure: string;
  arrival: string;
  registration: string;
  landings: number;
}

export type Activity =
  | { id: string; type: 'preparation'; minutes: number }
  | ({ id: string; type: FlightType } & Flight);

export interface Session {
  id: string;
  etag: string;
  dutyStart: string;
  dutyEnd: string;
  student?: string;
  activities: Activity[];
}

export interface SessionView {
  sessions: Session[];
  timeZone: string;
}

export const activityKinds: Record<
  ActivityType,
  {
    label: string;
    summary: 'preparation' | 'block' | 'soloSupervision';
    studentRequired: boolean;
    // I'm on board as pilot in command, so the flight goes in my logbook.
    pic: boolean;
    // Logged as instructor time.
    dualGiven: boolean;
  }
> = {
  preparation: {
    label: 'Preparation',
    summary: 'preparation',
    studentRequired: false,
    pic: false,
    dualGiven: false,
  },
  dual: { label: 'Dual', summary: 'block', studentRequired: true, pic: true, dualGiven: true },
  soloSupervision: {
    label: 'Solo supervision',
    summary: 'soloSupervision',
    studentRequired: true,
    pic: false,
    dualGiven: false,
  },
  rundflug: {
    label: 'Rundflug',
    summary: 'block',
    studentRequired: false,
    pic: true,
    dualGiven: false,
  },
  schnupperflug: {
    label: 'Schnupperflug',
    summary: 'block',
    studentRequired: false,
    pic: true,
    dualGiven: false,
  },
};

// Block minutes are calculated from the block times, never stored.
export function activityMinutes(activity: Activity) {
  if (activity.type === 'preparation') return activity.minutes;
  return Math.floor((Date.parse(activity.blockOn) - Date.parse(activity.blockOff)) / 60_000);
}

export function sessionTotals(sessions: Session[]) {
  const totals = { preparation: 0, block: 0, soloSupervision: 0 };
  for (const session of sessions) {
    for (const activity of session.activities) {
      totals[activityKinds[activity.type].summary] += activityMinutes(activity);
    }
  }
  return totals;
}

type MonthGroup = { key: string; label: string; sessions: Session[] };

// Newest first: years, the months within each year, and the sessions within each month.
export function groupSessionsByYear(sessions: Session[], timeZone: string) {
  const monthParts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
  });
  const monthLabel = new Intl.DateTimeFormat('en-GB', { timeZone, month: 'long', year: 'numeric' });
  const months = new Map<string, MonthGroup>();
  for (const session of sessions) {
    const date = new Date(session.dutyStart);
    const parts = monthParts.formatToParts(date);
    const year = parts.find((part) => part.type === 'year')!.value;
    const month = parts.find((part) => part.type === 'month')!.value;
    const key = `${year.padStart(4, '0')}-${month}`;
    const group = months.get(key);
    if (group) group.sessions.push(session);
    else months.set(key, { key, label: monthLabel.format(date), sessions: [session] });
  }
  const years = new Map<string, MonthGroup[]>();
  for (const month of [...months.values()].sort((first, second) =>
    second.key.localeCompare(first.key),
  )) {
    month.sessions.sort(
      (first, second) => Date.parse(second.dutyStart) - Date.parse(first.dutyStart),
    );
    const year = month.key.slice(0, 4);
    years.set(year, [...(years.get(year) ?? []), month]);
  }
  return [...years].map(([year, months]) => ({ year, months }));
}

export function formatDuration(minutes: number) {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}

// H:MM, with or without the colon; one or two digits alone are minutes.
export const durationPattern = /^(?:(\d*):?([0-5]\d)|(\d))$/;

export function parseDuration(value: string): number | undefined {
  const match = durationPattern.exec(value.trim());
  if (!match) return;
  const minutes = Number(match[1] ?? 0) * 60 + Number(match[2] ?? match[3]);
  if (Number.isSafeInteger(minutes)) return minutes;
}

export function normalizeDuration(value: string) {
  const minutes = parseDuration(value);
  return minutes === undefined ? value : formatDuration(minutes);
}

// 24-hour H:MM, with or without the colon; one or two digits alone are hours.
export const clockPattern = /^([01]?\d|2[0-3])(?::?([0-5]\d))?$/;

export function parseClock(value: string): string | undefined {
  const match = clockPattern.exec(value.trim());
  if (match) return `${match[1]!.padStart(2, '0')}:${match[2] ?? '00'}`;
}

// Flight times are shown and entered in UTC, as pilot logbooks record them.
export const flightTimeFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function wallClock(timeZone: string, instant: number) {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)!.value;
  return `${value('year').padStart(4, '0')}-${value('month')}-${value('day')}T${value('hour')}:${value('minute')}:${value('second')}`;
}

export function dateInZone(timeZone: string, date = new Date()) {
  return wallClock(timeZone, date.getTime()).slice(0, 10);
}

// HH:MM
export function clockInZone(timeZone: string, date: Date) {
  return wallClock(timeZone, date.getTime()).slice(11, 16);
}

// The instant that a date and H:MM clock time name in timeZone. During a clock change this
// settles on one candidate; the server rejects ambiguous and skipped times.
export function zonedInstant(timeZone: string, date: string, clock: string) {
  const wall = Date.parse(`${date}T${clock}Z`);
  let instant = wall;
  for (let pass = 0; pass < 2; pass++) {
    instant = wall - (Date.parse(`${wallClock(timeZone, instant)}Z`) - instant);
  }
  return instant;
}
