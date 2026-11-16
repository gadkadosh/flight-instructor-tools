import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../lib/store.ts";
import { emptyDraft } from "../lib/record.ts";
import type { Draft } from "../lib/record.ts";

// Explicitly synthetic image, used only in tests; never an extraction fallback.
export const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6Vh0AAAAASUVORK5CYII=",
  "base64",
);
export function testStore() {
  const dir = mkdtempSync(join(tmpdir(), "flight-record-test-"));
  const store = new Store(dir);
  return {
    dir,
    store,
    cleanup: () => {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
export function validDraft(studentId: string): Draft {
  return {
    ...emptyDraft(),
    handwrittenStudent: "A. Synthetic",
    studentId,
    identityConfirmed: true,
    date: "2026-11-01",
    aircraft: "D-TEST",
    preparationMinutes: 15,
    reportedFlightMinutes: 40,
    reportedBlockMinutes: 60,
    reviewComplete: true,
    blocks: [
      {
        off: "10:00",
        on: "11:00",
        flights: [
          {
            departure: "EDXX",
            arrival: "EDXX",
            movements: [{ takeoff: "10:05", landing: "10:25" }],
            landings: 2,
            activity: "dual",
          },
          {
            departure: "EDXX",
            arrival: "EDXX",
            movements: [{ takeoff: "10:30", landing: "10:50" }],
            landings: 1,
            activity: "soloSupervision",
          },
        ],
      },
    ],
  };
}

// Synthetic analogue of a sheet with an outbound leg, three circuits, and a
// return leg sharing the second block period. No real student data is stored.
export function sheetReading() {
  const flight = (
    departure: string,
    arrival: string,
    takeoff: string,
    landing: string,
  ) => ({
    departure,
    arrival,
    landings: 1,
    activity: "unknown",
    movements: [{ takeoff, landing }],
  });
  return {
    student: "Example, Alex",
    date: "17.04.27",
    aircraft: "D-TEST",
    preparation: "0:30",
    flightTotal: "2:02",
    blockTotal: "2:27",
    charterLocal: "",
    uncertainties: "",
    blocks: [
      {
        off: "1030",
        on: "1124",
        flights: [flight("EDXX", "EDYY", "1037", "1120")],
      },
      {
        off: "1136",
        on: "1309",
        flights: [
          flight("EDYY", "EDYY", "1143", "1155"),
          flight("EDYY", "EDYY", "55", "1200"),
          flight("EDYY", "EDYY", "1200", "1211"),
          flight("EDYY", "EDXX", "1211", "1302"),
        ],
      },
    ],
  };
}
