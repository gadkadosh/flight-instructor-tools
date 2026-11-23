import {
  clockInZone,
  dateInZone,
  formatDuration,
  type Activity,
  type FlightType,
  type Session,
  type SessionView,
} from './sessions';

// The session form's values as typed, before they are checked and saved. The date and duty
// times are in the configured time zone; flight times are in UTC.
export type SessionDraft = {
  id: string;
  date: string;
  student: string;
  dutyStart: string;
  dutyEnd: string;
  preparationId: string;
  preparation: string;
  flights: FlightDraft[];
};

export type FlightDraft = {
  id: string;
  type: FlightType;
  // A row nobody has typed in is not a flight, even with carried-over details.
  untouched?: boolean;
  blockOff: string;
  blockOn: string;
  landings: string;
  departure: string;
  arrival: string;
  registration: string;
  takeoff: string;
  landing: string;
};

type Carried = Pick<FlightDraft, 'arrival' | 'registration'>;

// Airfield and aircraft carry over from the previous flight, which usually ends where the next starts.
export const newFlight = (previous?: Carried): FlightDraft => ({
  id: crypto.randomUUID(),
  type: 'dual',
  untouched: true,
  blockOff: '',
  blockOn: '',
  landings: '1',
  departure: previous?.arrival ?? '',
  arrival: previous?.arrival ?? '',
  registration: previous?.registration ?? '',
  takeoff: '',
  landing: '',
});

function lastFlight(sessions: Session[]): Carried | undefined {
  for (const session of sessions.toReversed()) {
    const flight = session.activities.findLast(
      (activity): activity is Exclude<Activity, { type: 'preparation' }> =>
        activity.type !== 'preparation',
    );
    if (flight) return flight;
  }
}

export function newSessionDraft(
  { sessions, timeZone }: SessionView,
  date = dateInZone(timeZone),
): SessionDraft {
  const id = crypto.randomUUID();
  return {
    id,
    date,
    student: '',
    dutyStart: '',
    dutyEnd: '',
    preparationId: `${id}-prep`,
    preparation: '',
    flights: [newFlight(lastFlight(sessions))],
  };
}

// The form values that save back to the same session. The form has a single preparation entry
// and lists it first, as it has always saved sessions.
export function sessionDraft(session: Session, timeZone: string): SessionDraft {
  const utc = (instant?: string) => (instant ? clockInZone('UTC', new Date(instant)) : '');
  const preparations = session.activities.flatMap((activity) =>
    activity.type === 'preparation' ? [activity] : [],
  );
  const preparation = preparations.reduce((total, { minutes }) => total + minutes, 0);
  return {
    id: session.id,
    date: dateInZone(timeZone, new Date(session.dutyStart)),
    student: session.student ?? '',
    dutyStart: clockInZone(timeZone, new Date(session.dutyStart)),
    dutyEnd: clockInZone(timeZone, new Date(session.dutyEnd)),
    preparationId: preparations[0]?.id ?? `${session.id}-prep`,
    preparation: preparation ? formatDuration(preparation) : '',
    flights: session.activities.flatMap((activity) =>
      activity.type === 'preparation'
        ? []
        : [
            {
              id: activity.id,
              type: activity.type,
              registration: activity.registration,
              departure: activity.departure,
              arrival: activity.arrival,
              blockOff: utc(activity.blockOff),
              takeoff: utc(activity.firstTakeoff),
              landing: utc(activity.lastLanding),
              blockOn: utc(activity.blockOn),
              landings: String(activity.landings),
            },
          ],
    ),
  };
}
