import { test } from "node:test";
import assert from "node:assert/strict";
import {
  draftFromSheet,
  sheetDate,
  sheetClock,
  writtenMinutes,
} from "../lib/sheet.ts";
import { confirmationIssues, parseDraft, totals } from "../lib/record.ts";
import { sheetReading, validDraft } from "./helpers.ts";

test("five source rows become three flights while preserving five intervals and two independent block periods", () => {
  const draft = draftFromSheet(sheetReading(), "Synthetic transcription");
  assert.equal(draft.date, "2027-04-17");
  assert.equal(draft.handwrittenStudent, "Example, Alex");
  assert.equal(draft.aircraft, "D-TEST");
  assert.equal(draft.preparationMinutes, 30);
  assert.equal(draft.blocks.length, 2);
  const flights = draft.blocks.flatMap((b) => b.flights);
  assert.deepEqual(
    flights.map((f) => [f.departure, f.arrival, f.landings]),
    [
      ["EDXX", "EDYY", 1],
      ["EDYY", "EDYY", 3],
      ["EDYY", "EDXX", 1],
    ],
  );
  assert.deepEqual(flights[1].movements, [
    { takeoff: "11:43", landing: "11:55" },
    { takeoff: "11:55", landing: "12:00" },
    { takeoff: "12:00", landing: "12:11" },
  ]);
  assert.deepEqual(
    draft.blocks.map((b) => [b.off, b.on]),
    [
      ["10:30", "11:24"],
      ["11:36", "13:09"],
    ],
  );
  assert.deepEqual(totals(draft), { flight: 122, block: 147 });
  assert.equal(draft.reportedFlightMinutes, 122);
  assert.equal(draft.reportedBlockMinutes, 147);
  assert.equal(draft.identityConfirmed, false);
  assert.equal(draft.reviewComplete, false);
  assert.equal(draft.sourceReading, "Synthetic transcription");
  assert.ok(flights.every((f) => f.activity === "unknown"));
});
test("grouped circuits preserve ground gaps and require review of conflicting totals", () => {
  const draft = draftFromSheet(sheetReading(), "Synthetic transcription");
  draft.blocks[1].flights[0].movements[1].takeoff = "11:57";
  assert.deepEqual(totals(draft), { flight: 120, block: 147 });
  assert.match(
    confirmationIssues(draft, []).join("\n"),
    /Written flight total/,
  );
});
test("the model cannot turn a written block subtotal into a landing count", () => {
  const reading = sheetReading();
  reading.blocks[0].flights[0].landings = 54;
  const draft = draftFromSheet(reading, "Synthetic transcription");
  assert.equal(draft.blocks[0].flights[0].landings, 1);
});
test("normalization uses written evidence instead of current year or guessed hours", () => {
  assert.equal(sheetDate("30.09.26"), "2026-09-30");
  assert.equal(sheetDate("30.09.25"), "2025-09-30");
  assert.equal(sheetDate("30.09.20"), "2020-09-30");
  assert.equal(sheetDate("30.09.?"), "30.09.?");
  assert.equal(sheetClock("1037"), "10:37");
  assert.equal(sheetClock("55"), "55");
  assert.equal(writtenMinutes("2:02"), 122);
  assert.equal(writtenMinutes("43′"), 43);
  assert.equal(writtenMinutes(""), null);
  assert.equal(writtenMinutes("0:00"), 0);
  const reading = sheetReading();
  reading.blocks[1].flights[1].movements[0].takeoff = "54";
  const draft = draftFromSheet(reading, "Uncertain minutes");
  assert.equal(draft.blocks[1].flights[0].movements[1].takeoff, "54");
  assert.equal(totals(draft).flight, null);
});
test("minute shorthand inherits the established hour through consecutive circuits and explicit hour changes", () => {
  const reading = sheetReading();
  const pairs = [
    ["0752", "0803"],
    ["03", "11"],
    ["11", "19"],
    ["19", "27"],
    ["27", "0904"],
    ["04", "12"],
    ["12", "20"],
    ["20", "31"],
  ];
  const circuit = reading.blocks[1].flights[0];
  reading.blocks = [
    {
      off: "0745",
      on: "0938",
      flights: pairs.map(([takeoff, landing]) => ({
        ...circuit,
        movements: [{ takeoff, landing }],
      })),
    },
  ];
  reading.flightTotal = "1:39";
  reading.blockTotal = "1:53";
  const draft = draftFromSheet(reading, "Literal times remain 03, 11, 19, ...");
  assert.deepEqual(draft.blocks[0].flights[0].movements, [
    { takeoff: "07:52", landing: "08:03" },
    { takeoff: "08:03", landing: "08:11" },
    { takeoff: "08:11", landing: "08:19" },
    { takeoff: "08:19", landing: "08:27" },
    { takeoff: "08:27", landing: "09:04" },
    { takeoff: "09:04", landing: "09:12" },
    { takeoff: "09:12", landing: "09:20" },
    { takeoff: "09:20", landing: "09:31" },
  ]);
  assert.equal(draft.blocks[0].flights[0].landings, 8);
  assert.deepEqual(totals(draft), { flight: 99, block: 113 });
  assert.equal(draft.sourceReading, "Literal times remain 03, 11, 19, ...");
});

test("block clocks establish the shorthand hour, including an explicitly marked next day", () => {
  const reading = sheetReading();
  reading.blocks = [
    {
      off: "1002",
      on: "32",
      flights: [
        {
          ...reading.blocks[0].flights[0],
          movements: [{ takeoff: "08", landing: "27" }],
        },
      ],
    },
  ];
  let draft = draftFromSheet(reading, "Synthetic shorthand");
  assert.equal(draft.blocks[0].on, "10:32");
  assert.deepEqual(draft.blocks[0].flights[0].movements, [
    { takeoff: "10:08", landing: "10:27" },
  ]);
  reading.blocks[0].off = "2350";
  reading.blocks[0].on = "0025+1";
  reading.blocks[0].flights[0].movements = [
    { takeoff: "2358", landing: "0004+1" },
    { takeoff: "04", landing: "15" },
  ];
  draft = draftFromSheet(reading, "Synthetic overnight");
  assert.deepEqual(draft.blocks[0].flights[0].movements[1], {
    takeoff: "00:04+1",
    landing: "00:15+1",
  });
});

test("shorthand never invents a rollover, crosses missing evidence, or contradicts a later explicit clock", () => {
  for (const [off, takeoff, landing, on] of [
    ["", "05", "15", ""],
    ["0955", "03", "1015", "1020"],
    ["1000", "09", "1005", "1030"],
    ["1000", "?", "15", "1030"],
    ["1000", "", "15", "1030"],
    ["1000", "65", "20", "1030"],
  ]) {
    const reading = sheetReading();
    reading.blocks = [
      {
        off,
        on,
        flights: [
          {
            ...reading.blocks[0].flights[0],
            movements: [{ takeoff, landing }],
          },
        ],
      },
    ];
    const draft = draftFromSheet(reading, "Ambiguous shorthand");
    assert.deepEqual(draft.blocks[0].flights[0].movements, [
      { takeoff: sheetClock(takeoff), landing: sheetClock(landing) },
    ]);
    assert.equal(totals(draft).flight, null);
  }
});
test("different activity scopes never merge and missing preparation remains unknown", () => {
  const reading = sheetReading();
  reading.preparation = "";
  reading.blocks[1].flights[1].activity = "soloSupervision";
  const draft = draftFromSheet(reading, "Synthetic transcription");
  assert.equal(draft.preparationMinutes, null);
  assert.equal(draft.blocks[1].flights.length, 4);
});
test("existing saved drafts remain readable; instructor and flight remarks are no longer fields or confirmation requirements", () => {
  const draft = validDraft("student");
  const legacy = {
    ...draft,
    instructor: "Synthetic Legacy Instructor",
    sourceReading: undefined,
    blocks: draft.blocks.map((b) => ({
      ...b,
      flights: b.flights.map((f) => ({
        ...f,
        movements: undefined,
        takeoff: f.movements[0].takeoff,
        landing: f.movements[0].landing,
        remarks: "Legacy exercise",
      })),
    })),
  };
  assert.deepEqual(parseDraft(legacy), draft);
  assert.deepEqual(
    confirmationIssues(draft, [{ id: "student", name: "Synthetic Student" }]),
    [],
  );
});
