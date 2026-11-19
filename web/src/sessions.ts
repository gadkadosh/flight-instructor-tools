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

export function parseDuration(value: string): number | undefined {
  const text = value.trim();
  if (!text) return 0;
  if (!/^\d+$|^\d+:[0-5]\d$/.test(text)) return;
  const parts = text.split(':').map(Number);
  const minutes = parts.length === 1 ? parts[0]! : parts[0]! * 60 + parts[1]!;
  if (Number.isSafeInteger(minutes)) return minutes;
}

export function parseClock(value: string): string | undefined {
  const text = value.trim();
  if (!/^\d{1,4}$|^\d{1,2}:\d{2}$/.test(text)) return;
  const parts = text.includes(':')
    ? text.split(':')
    : text.length > 2
      ? [text.slice(0, -2), text.slice(-2)]
      : [text, '00'];
  const [hours, minutes] = parts.map(Number);
  if (hours! < 24 && minutes! < 60) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }
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
