export type Activity = "unknown" | "dual" | "soloSupervision";
export type Movement = { takeoff: string; landing: string };
export type Flight = {
  departure: string;
  arrival: string;
  movements: Movement[];
  landings: number | null;
  activity: Activity;
};
export type Block = { off: string; on: string; flights: Flight[] };
export type Draft = {
  handwrittenStudent: string;
  studentId: string;
  identityConfirmed: boolean;
  date: string;
  aircraft: string;
  preparationMinutes: number | null;
  reportedFlightMinutes: number | null;
  reportedBlockMinutes: number | null;
  charterLocal: string;
  remarks: string;
  uncertainties: string;
  sourceReading: string;
  reviewComplete: boolean;
  blocks: Block[];
};
export type Photo = { id: string; name: string; mime: string };
export type Student = { id: string; name: string };
export type RecordSession = {
  id: string;
  revision: number;
  confirmedAt: string | null;
  hasConfirmationHistory: boolean;
  updatedAt: string;
  extractionNote: string;
  draft: Draft;
  photos: Photo[];
};

export function emptyFlight(): Flight {
  return {
    departure: "",
    arrival: "",
    movements: [{ takeoff: "", landing: "" }],
    landings: null,
    activity: "unknown",
  };
}

export function emptyDraft(): Draft {
  return {
    handwrittenStudent: "",
    studentId: "",
    identityConfirmed: false,
    date: "",
    aircraft: "",
    preparationMinutes: null,
    reportedFlightMinutes: null,
    reportedBlockMinutes: null,
    charterLocal: "",
    remarks: "",
    uncertainties: "",
    sourceReading: "",
    reviewComplete: false,
    blocks: [{ off: "", on: "", flights: [emptyFlight()] }],
  };
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected a record object.");
  return value as Record<string, unknown>;
}
function string(value: unknown): string {
  if (typeof value !== "string" || value.length > 10000)
    throw new Error("Expected text (at most 10,000 characters).");
  return value;
}
function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("Expected true or false.");
  return value;
}
function minutes(value: unknown): number | null {
  if (value === null) return null;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > 2880
  )
    throw new Error(
      "Minutes/counts must be whole numbers from 0 to 2880, or blank.",
    );
  return value;
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length > 100)
    throw new Error("Expected an array with at most 100 entries.");
  return value;
}

// Validate all untrusted inputs, including local model output. Unknown fields are discarded.
export function parseDraft(value: unknown): Draft {
  const v = object(value);
  return {
    handwrittenStudent: string(v.handwrittenStudent),
    studentId: string(v.studentId),
    identityConfirmed: boolean(v.identityConfirmed),
    date: string(v.date),
    aircraft: string(v.aircraft),
    preparationMinutes: minutes(v.preparationMinutes),
    reportedFlightMinutes: minutes(v.reportedFlightMinutes),
    reportedBlockMinutes: minutes(v.reportedBlockMinutes),
    charterLocal: string(v.charterLocal),
    remarks: string(v.remarks),
    uncertainties: string(v.uncertainties),
    sourceReading: v.sourceReading === undefined ? "" : string(v.sourceReading),
    reviewComplete: boolean(v.reviewComplete),
    blocks: array(v.blocks).map((item) => {
      const b = object(item);
      return {
        off: string(b.off),
        on: string(b.on),
        flights: array(b.flights).map((item) => {
          const f = object(item);
          if (
            !["unknown", "dual", "soloSupervision"].includes(String(f.activity))
          )
            throw new Error("Unknown flight activity.");
          return {
            departure: string(f.departure),
            arrival: string(f.arrival),
            // Earlier drafts stored one interval directly on each flight.
            movements: array(
              f.movements ?? [{ takeoff: f.takeoff, landing: f.landing }],
            ).map((item) => {
              const m = object(item);
              return { takeoff: string(m.takeoff), landing: string(m.landing) };
            }),
            landings: minutes(f.landings),
            activity: f.activity as Activity,
          };
        }),
      };
    }),
  };
}

// UTC minutes since the session date. Midnight is explicit, never inferred.
export function timeMinutes(time: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)(\+1)?$/.exec(time);
  return match
    ? Number(match[1]) * 60 + Number(match[2]) + (match[3] ? 1440 : 0)
    : null;
}
export function elapsed(start: string, end: string): number | null {
  const a = timeMinutes(start),
    b = timeMinutes(end);
  return a !== null && b !== null && b > a ? b - a : null;
}
export function totals(draft: Draft): {
  flight: number | null;
  block: number | null;
} {
  const sum = (values: (number | null)[]) =>
    values.length && values.every((v) => v !== null)
      ? values.reduce<number>((a, b) => a + b!, 0)
      : null;
  return {
    flight: sum(
      draft.blocks.flatMap((b) =>
        b.flights.flatMap((f) =>
          f.movements.map((m) => elapsed(m.takeoff, m.landing)),
        ),
      ),
    ),
    block: sum(draft.blocks.map((b) => elapsed(b.off, b.on))),
  };
}
export function duration(value: number | null): string {
  return value === null
    ? "—"
    : `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}

export function confirmationIssues(d: Draft, students: Student[]): string[] {
  const issues: string[] = [];
  if (!d.handwrittenStudent.trim())
    issues.push("Preserve the student name as written on the sheet.");
  if (!students.some((s) => s.id === d.studentId) || !d.identityConfirmed)
    issues.push("Select a student and explicitly confirm their identity.");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(d.date) ||
    !Number.isFinite(Date.parse(d.date)) ||
    new Date(d.date).toISOString().slice(0, 10) !== d.date
  )
    issues.push("Enter a valid session date (YYYY-MM-DD, UTC).");
  if (!d.aircraft.trim()) issues.push("Enter the aircraft registration.");
  if (d.preparationMinutes === null)
    issues.push(
      "Enter preparation minutes explicitly, including zero when appropriate.",
    );
  if (!d.reviewComplete)
    issues.push(
      "Review the photos, page grouping, uncertainties, totals, and SOLO scope, then acknowledge the review.",
    );
  if (!d.blocks.length) issues.push("Add at least one block period.");
  let previousBlockEnd = -1;
  d.blocks.forEach((b, bi) => {
    const label = `Block ${bi + 1}`;
    const off = timeMinutes(b.off),
      on = timeMinutes(b.on);
    if (elapsed(b.off, b.on) === null)
      issues.push(
        `${label}: enter complete UTC off/on times in increasing order (HH:MM; append +1 for next day).`,
      );
    if (off !== null && off < previousBlockEnd)
      issues.push(`${label}: block periods overlap or are out of order.`);
    if (on !== null) previousBlockEnd = on;
    if (!b.flights.length)
      issues.push(`${label}: add at least one takeoff/landing entry.`);
    let previousLanding = off ?? -1;
    b.flights.forEach((f, fi) => {
      const prefix = `${label}, flight ${fi + 1}`;
      if (!f.movements.length)
        issues.push(`${prefix}: add at least one takeoff/landing interval.`);
      f.movements.forEach((m, mi) => {
        const takeoff = timeMinutes(m.takeoff),
          landing = timeMinutes(m.landing);
        if (elapsed(m.takeoff, m.landing) === null)
          issues.push(
            `${prefix}, interval ${mi + 1}: enter complete UTC takeoff/landing times in increasing order.`,
          );
        if (
          takeoff !== null &&
          landing !== null &&
          (takeoff < previousLanding || (on !== null && landing > on))
        )
          issues.push(
            `${prefix}: flights must be ordered, non-overlapping, and inside their block period.`,
          );
        if (landing !== null) previousLanding = landing;
      });
      if (!f.departure.trim() || !f.arrival.trim())
        issues.push(`${prefix}: enter departure and arrival airfields.`);
      if (!f.landings) issues.push(`${prefix}: enter the number of landings.`);
      if (f.activity === "unknown")
        issues.push(
          `${prefix}: explicitly select dual instruction or supervised solo.`,
        );
    });
  });
  const calculated = totals(d);
  if (
    d.reportedFlightMinutes !== null &&
    calculated.flight !== d.reportedFlightMinutes
  )
    issues.push(
      "Written flight total does not match calculated flight minutes.",
    );
  if (
    d.reportedBlockMinutes !== null &&
    calculated.block !== d.reportedBlockMinutes
  )
    issues.push("Written block total does not match calculated block minutes.");
  return issues;
}
