import { emptyDraft, parseDraft, timeMinutes } from "./record.ts";
import type { Draft, Flight } from "./record.ts";

// A reading preserves written values. Normalization and calculations belong to
// application code, rather than another arithmetic task for the vision model.
export const sheetTemplate = {
  student: "",
  date: "",
  aircraft: "",
  preparation: "",
  flightTotal: "",
  blockTotal: "",
  charterLocal: "",
  uncertainties: "",
  blocks: [
    {
      off: "",
      on: "",
      flights: [
        {
          departure: "",
          arrival: "",
          activity: "unknown",
          movements: [{ takeoff: "", landing: "" }],
        },
      ],
    },
  ],
};

export function schemaFor(value: unknown, key = ""): object {
  if (value === null)
    return { type: ["integer", "null"], minimum: 0, maximum: 2880 };
  if (Array.isArray(value))
    return { type: "array", maxItems: 100, items: schemaFor(value[0]) };
  if (typeof value === "object") {
    const fields = value as Record<string, unknown>;
    return {
      type: "object",
      additionalProperties: false,
      required: Object.keys(fields),
      properties: Object.fromEntries(
        Object.entries(fields).map(([name, v]) => [name, schemaFor(v, name)]),
      ),
    };
  }
  if (key === "activity")
    return { type: "string", enum: ["unknown", "dual", "soloSupervision"] };
  return { type: typeof value };
}
export const sheetSchema = schemaFor(sheetTemplate);

function text(value: unknown): string {
  if (typeof value !== "string" || value.length > 10000)
    throw new Error("Invalid text in sheet reading.");
  return value.trim();
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid sheet reading.");
  return value as Record<string, unknown>;
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length > 100)
    throw new Error("Invalid sheet rows.");
  return value;
}

export function sheetDate(value: string): string {
  const match = /^(\d{1,2})[./](\d{1,2})[./](\d{2}|\d{4})$/.exec(value);
  // Explicit convention for these contemporary school sheets: YY means 20YY.
  return match
    ? `${match[3].length === 2 ? "20" : ""}${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`
    : value;
}
export function writtenMinutes(value: string): number | null {
  if (!value) return null;
  const clock = /^(\d{1,2}):([0-5]\d)$/.exec(value);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  const minutes = /^(\d{1,4})\s*(?:['′’]|min(?:uten)?\.?)?$/i.exec(value);
  return minutes ? Number(minutes[1]) : null;
}
export function sheetClock(value: string): string {
  const match = /^(\d{1,2})[.:]?([0-5]\d)(\+1)?$/.exec(value);
  if (!match || Number(match[1]) > 23) return value;
  return `${match[1].padStart(2, "0")}:${match[2]}${match[3] ?? ""}`;
}

// The writer omits the hour while it stays unchanged. Walk off-block,
// movements, and on-block in order; only explicit full clocks change the hour.
// Missing evidence and contradictory clocks stop propagation.
function expandMinuteTimes(block: Draft["blocks"][number]): void {
  const cells = [
    {
      value: () => block.off,
      set: (v: string) => {
        block.off = v;
      },
    },
    ...block.flights.flatMap((f) =>
      f.movements.flatMap((m) => [
        {
          value: () => m.takeoff,
          set: (v: string) => {
            m.takeoff = v;
          },
        },
        {
          value: () => m.landing,
          set: (v: string) => {
            m.landing = v;
          },
        },
      ]),
    ),
    {
      value: () => block.on,
      set: (v: string) => {
        block.on = v;
      },
    },
  ];
  // Bound each shorthand cell by the next explicitly written clock. Compute
  // bounds once, so long sequences of circuits still take linear time.
  const limits = cells.map((cell) => timeMinutes(cell.value()));
  let next: number | null = null;
  for (let i = cells.length - 1; i >= 0; i--) {
    const explicit = limits[i];
    limits[i] = next;
    if (explicit !== null) next = explicit;
  }
  let previous: number | null = null;
  cells.forEach((cell, i) => {
    const value = cell.value();
    const explicit = timeMinutes(value);
    if (explicit !== null) {
      previous = explicit;
      return;
    }
    if (previous === null || !/^\d{2}$/.test(value) || Number(value) > 59) {
      previous = null;
      return;
    }
    const candidate = Math.floor(previous / 60) * 60 + Number(value);
    const limit = limits[i];
    if (candidate < previous || (limit !== null && candidate > limit)) {
      previous = null;
      return;
    }
    const hour = String(Math.floor(candidate / 60) % 24).padStart(2, "0");
    cell.set(`${hour}:${value}${candidate >= 1440 ? "+1" : ""}`);
    previous = candidate;
  });
}

export function groupCircuits(flights: Flight[]): Flight[] {
  const grouped: Flight[] = [];
  for (const flight of flights) {
    const previous = grouped.at(-1);
    if (
      previous &&
      previous.departure &&
      previous.departure === previous.arrival &&
      previous.departure === flight.departure &&
      flight.departure === flight.arrival &&
      previous.activity === flight.activity
    ) {
      previous.movements.push(...flight.movements);
      previous.landings =
        previous.landings === null || flight.landings === null
          ? null
          : previous.landings + flight.landings;
    } else grouped.push({ ...flight, movements: [...flight.movements] });
  }
  return grouped;
}

export function draftFromSheet(value: unknown, sourceReading: string): Draft {
  const v = object(value);
  const draft = parseDraft({
    ...emptyDraft(),
    handwrittenStudent: text(v.student),
    date: sheetDate(text(v.date)),
    aircraft: text(v.aircraft).toUpperCase().replace(/\s+/g, ""),
    preparationMinutes: writtenMinutes(text(v.preparation)),
    reportedFlightMinutes: writtenMinutes(text(v.flightTotal)),
    reportedBlockMinutes: writtenMinutes(text(v.blockTotal)),
    charterLocal: text(v.charterLocal),
    uncertainties: text(v.uncertainties),
    sourceReading,
    blocks: array(v.blocks).map((value) => {
      const b = object(value);
      return {
        off: sheetClock(text(b.off)),
        on: sheetClock(text(b.on)),
        flights: array(b.flights).map((value) => {
          const f = object(value);
          return {
            departure: text(f.departure).toUpperCase(),
            arrival: text(f.arrival).toUpperCase(),
            landings: array(f.movements).length || null,
            activity: f.activity,
            movements: array(f.movements).map((value) => {
              const m = object(value);
              return {
                takeoff: sheetClock(text(m.takeoff)),
                landing: sheetClock(text(m.landing)),
              };
            }),
          };
        }),
      };
    }),
  });
  draft.blocks.forEach((b) => {
    expandMinuteTimes(b);
    b.flights = groupCircuits(b.flights);
  });
  return draft;
}
