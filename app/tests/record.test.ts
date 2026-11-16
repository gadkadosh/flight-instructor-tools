import { test } from "node:test";
import assert from "node:assert/strict";
import {
  confirmationIssues,
  duration,
  emptyDraft,
  elapsed,
  parseDraft,
  totals,
} from "../lib/record.ts";
import { validDraft } from "./helpers.ts";

const students = [{ id: "student", name: "Synthetic Student" }];
test("several flights share one block without counting written totals twice", () => {
  const draft = validDraft("student");
  assert.deepEqual(totals(draft), { flight: 40, block: 60 });
  assert.equal(duration(totals(draft).flight), "0:40");
  assert.deepEqual(confirmationIssues(draft, students), []);
  draft.reportedFlightMinutes = 80;
  assert.match(
    confirmationIssues(draft, students).join("\n"),
    /Written flight total/,
  );
});
test("unknown preparation, identity, activity, minute-only times, and review block confirmation", () => {
  const draft = validDraft("student");
  draft.identityConfirmed = false;
  draft.preparationMinutes = null;
  draft.reviewComplete = false;
  draft.blocks[0].flights[0].activity = "unknown";
  draft.blocks[0].off = ":00";
  const issues = confirmationIssues(draft, students).join("\n");
  for (const match of [
    /confirm their identity/,
    /preparation minutes/,
    /acknowledge the review/,
    /select dual/,
    /complete UTC/,
  ])
    assert.match(issues, match);
  assert.ok(confirmationIssues(emptyDraft(), students).length > 5);
});
test("midnight must be explicit and flights must stay inside non-overlapping blocks", () => {
  assert.equal(elapsed("23:50", "00:10"), null);
  assert.equal(elapsed("23:50", "00:10+1"), 20);
  assert.equal(elapsed("09:30", "09:30"), null);
  const draft = validDraft("student");
  draft.blocks[0].flights[1].movements[0].takeoff = "10:20";
  assert.match(
    confirmationIssues(draft, students).join("\n"),
    /non-overlapping/,
  );
  draft.blocks[0].flights[1].movements[0].landing = "11:15";
  assert.match(
    confirmationIssues(draft, students).join("\n"),
    /inside their block/,
  );
  draft.blocks.push(structuredClone(draft.blocks[0]));
  assert.match(
    confirmationIssues(draft, students).join("\n"),
    /block periods overlap/,
  );
});
test("impossible dates, made-up identities, and non-domain payloads cannot be confirmed", () => {
  const draft = validDraft("made-up-id");
  draft.date = "2026-02-30";
  const issues = confirmationIssues(draft, students).join("\n");
  assert.match(issues, /valid session date/);
  assert.match(issues, /Select a student/);
  assert.throws(
    () => parseDraft({ ...draft, preparationMinutes: -2 }),
    /whole numbers/,
  );
  assert.throws(
    () => parseDraft({ ...draft, identityConfirmed: "yes" }),
    /true or false/,
  );
  assert.throws(
    () =>
      parseDraft({
        ...draft,
        blocks: [{ off: "", on: "", flights: [{ activity: "DS" }] }],
      }),
    /Unknown flight activity/,
  );
  assert.deepEqual(parseDraft({ ...draft, confirmedAt: "invented" }), draft);
});
