export type ActivityType =
  | 'preparation'
  | 'dual'
  | 'soloSupervision'
  | 'rundflug'
  | 'schnupperflug';

export interface Activity {
  id: string;
  type: ActivityType;
  minutes: number;
}

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
  { label: string; summary: 'preparation' | 'block' | 'soloSupervision'; studentRequired: boolean }
> = {
  preparation: { label: 'Preparation', summary: 'preparation', studentRequired: false },
  dual: { label: 'Dual', summary: 'block', studentRequired: true },
  soloSupervision: { label: 'Solo supervision', summary: 'soloSupervision', studentRequired: true },
  rundflug: { label: 'Rundflug', summary: 'block', studentRequired: false },
  schnupperflug: { label: 'Schnupperflug', summary: 'block', studentRequired: false },
};

export function groupSessionsByMonth(sessions: Session[], timeZone: string) {
  const monthParts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
  });
  const monthLabel = new Intl.DateTimeFormat('en-GB', { timeZone, month: 'long', year: 'numeric' });
  const groups = new Map<string, { label: string; sessions: Session[] }>();
  for (const session of sessions) {
    const date = new Date(session.dutyStart);
    const parts = monthParts.formatToParts(date);
    const year = parts.find((part) => part.type === 'year')!.value;
    const month = parts.find((part) => part.type === 'month')!.value;
    const monthKey = `${year.padStart(4, '0')}-${month}`;
    const group = groups.get(monthKey);
    if (group) group.sessions.push(session);
    else groups.set(monthKey, { label: monthLabel.format(date), sessions: [session] });
  }
  for (const group of groups.values()) {
    group.sessions.sort(
      (first, second) => Date.parse(second.dutyStart) - Date.parse(first.dutyStart),
    );
  }
  return [...groups].sort(([first], [second]) => second.localeCompare(first));
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

export function dateInZone(timeZone: string, date = new Date()) {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)!.value;
  return `${value('year').padStart(4, '0')}-${value('month')}-${value('day')}`;
}
