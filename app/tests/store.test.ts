import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Store } from "../lib/store.ts";
import { png, testStore, validDraft } from "./helpers.ts";

test("uploads and saves converge, and all records, originals, aliases, and confirmations survive reopening", () => {
  const { dir, store, cleanup } = testStore();
  try {
    const first = store.upload([{ name: "synthetic.png", bytes: png }]);
    const retry = store.upload([
      { name: "renamed.png", bytes: png },
      { name: "copy.png", bytes: png },
    ]);
    assert.equal(retry.duplicate, true);
    assert.equal(retry.session.id, first.session.id);
    assert.equal(store.list().length, 1);
    assert.equal(retry.session.photos.length, 1);
    const student = store.addStudent("Alex Synthetic");
    const draft = validDraft(student.id);
    const saved = store.save(first.session.id, 1, draft);
    assert.equal(saved.revision, 2);
    assert.equal(saved.confirmedAt, null);
    const repeatedSave = store.save(first.session.id, 1, draft);
    assert.equal(repeatedSave.revision, 2);
    const confirmed = store.save(
      first.session.id,
      saved.revision,
      draft,
      true,
      true,
    );
    assert.ok(confirmed.confirmedAt);
    assert.equal(
      store.save(first.session.id, saved.revision, draft, true, true)
        .confirmedAt,
      confirmed.confirmedAt,
    );
    assert.equal(
      store.db.prepare("SELECT count(*) AS n FROM confirmations").get()!.n,
      1,
    );
    const reopened = new Store(dir);
    try {
      assert.deepEqual(reopened.get(first.session.id), confirmed);
      assert.deepEqual(reopened.photo(confirmed.photos[0].id).bytes, png);
      assert.deepEqual(reopened.students(), [student]);
      assert.equal(reopened.suggestStudent("  A. SYNTHETIC  "), student.id);
      assert.equal(
        reopened.db.prepare("PRAGMA user_version").get()!.user_version,
        2,
      );
    } finally {
      reopened.close();
    }
  } finally {
    cleanup();
  }
});
test("invalid confirmation is atomic, and editing confirmed data requires confirmation again", () => {
  const { store, cleanup } = testStore();
  try {
    const initial = store.upload([
      { name: "synthetic.png", bytes: png },
    ]).session;
    const student = store.addStudent("Alex Synthetic");
    const draft = validDraft(student.id);
    draft.preparationMinutes = null;
    assert.throws(
      () => store.save(initial.id, 1, draft, true, true),
      /preparation/,
    );
    assert.deepEqual(store.get(initial.id), initial);
    assert.equal(store.suggestStudent(draft.handwrittenStudent), null);
    draft.preparationMinutes = 0;
    const confirmed = store.save(initial.id, 1, draft, true);
    const changed = store.save(initial.id, confirmed.revision, {
      ...draft,
      remarks: "Corrected after review",
    });
    assert.equal(changed.confirmedAt, null);
    assert.equal(changed.revision, confirmed.revision + 1);
    assert.equal(
      store.db.prepare("SELECT count(*) AS n FROM confirmations").get()!.n,
      1,
    );
    const reconfirmed = store.save(
      initial.id,
      changed.revision,
      changed.draft,
      true,
    );
    assert.ok(reconfirmed.confirmedAt);
    assert.equal(
      store.db.prepare("SELECT count(*) AS n FROM confirmations").get()!.n,
      2,
    );
    assert.throws(
      () => store.save(initial.id, 1, { ...draft, remarks: "Stale overwrite" }),
      /another tab/,
    );
    assert.equal(store.get(initial.id).draft.remarks, "Corrected after review");
  } finally {
    cleanup();
  }
});
test("identical student names remain separate identities and ambiguous aliases are never merged", () => {
  const { store, cleanup } = testStore();
  try {
    const session = store.upload([
      { name: "synthetic.png", bytes: png },
    ]).session;
    const a = store.addStudent("Alex Synthetic"),
      b = store.addStudent("Alex Synthetic");
    assert.notEqual(a.id, b.id);
    const draft = validDraft(a.id);
    const confirmed = store.save(session.id, 1, draft, true, true);
    assert.throws(
      () =>
        store.save(
          session.id,
          confirmed.revision,
          { ...draft, studentId: b.id },
          true,
          true,
        ),
      /already identifies another student/,
    );
    assert.equal(store.suggestStudent(draft.handwrittenStudent), a.id);
    assert.equal(store.get(session.id).draft.studentId, a.id);
    // A human may select a different identity without memorizing an ambiguous alias.
    assert.equal(
      store.save(
        session.id,
        confirmed.revision,
        { ...draft, studentId: b.id },
        true,
        false,
      ).draft.studentId,
      b.id,
    );
    assert.equal(store.suggestStudent(draft.handwrittenStudent), null);
    const current = store.get(session.id);
    assert.throws(
      () => store.save(session.id, current.revision, current.draft, true, true),
      /ambiguous/,
    );
  } finally {
    cleanup();
  }
});
test("adding pages invalidates confirmation, repeated additions converge, and duplicate photos cannot cross sessions", () => {
  const { store, cleanup } = testStore();
  try {
    const session = store.upload([{ name: "page-1.png", bytes: png }]).session;
    const student = store.addStudent("Alex Synthetic");
    const confirmed = store.save(session.id, 1, validDraft(student.id), true);
    // Different bytes represent a second source photo. Upload parsing is also tested below.
    const second = Buffer.concat([png, Buffer.from("synthetic-page-2")]);
    const added = store.upload(
      [{ name: "page-2.png", bytes: second }],
      session.id,
      confirmed.revision,
    ).session;
    assert.equal(added.photos.length, 2);
    assert.equal(added.confirmedAt, null);
    assert.equal(added.draft.reviewComplete, false);
    const retry = store.upload(
      [{ name: "page-2.png", bytes: second }],
      session.id,
      confirmed.revision,
    );
    assert.equal(retry.duplicate, true);
    assert.equal(retry.session.revision, added.revision);
    assert.throws(
      () =>
        store.upload([
          { name: "old.png", bytes: png },
          {
            name: "new.png",
            bytes: Buffer.concat([png, Buffer.from("third")]),
          },
        ]),
      /already belong/,
    );
    assert.equal(store.list().length, 1);
    assert.throws(
      () =>
        store.upload([{ name: "bad.png", bytes: Buffer.from("not a photo") }]),
      /JPEG, PNG, or WebP/,
    );
    assert.throws(() => store.photo("../../records.sqlite"), /not found/);
  } finally {
    cleanup();
  }
});
test("draft deletion removes its record and uploaded copies, preserves other data, and supports reupload and retries", () => {
  const { store, dir, cleanup } = testStore();
  try {
    const student = store.addStudent("Synthetic Student");
    const session = store.upload([{ name: "draft.png", bytes: png }]).session;
    const other = store.upload([
      { name: "other.png", bytes: Buffer.concat([png, Buffer.from("other")]) },
    ]).session;
    const path = join(dir, "photos", session.photos[0].id);
    assert.ok(existsSync(path));
    store.deleteDraft(session.id, session.revision);
    assert.throws(() => store.get(session.id), /not found/);
    assert.throws(() => store.photo(session.photos[0].id), /not found/);
    assert.equal(existsSync(path), false);
    assert.deepEqual(
      store.list().map((r) => r.id),
      [other.id],
    );
    assert.deepEqual(store.students(), [student]);
    store.deleteDraft(session.id, session.revision);
    const again = store.upload([{ name: "draft.png", bytes: png }]);
    assert.notEqual(again.session.id, session.id);
    assert.equal(again.duplicate, false);
    // Simulate cleanup that was queued before another process reuploaded it.
    store.db
      .prepare("INSERT INTO photo_deletions VALUES (?)")
      .run(again.session.photos[0].id);
    store.deleteDraft(session.id, session.revision);
    assert.deepEqual(store.photo(again.session.photos[0].id).bytes, png);
  } finally {
    cleanup();
  }
});
test("stale deletion and deletion of any record with confirmation history are rejected atomically", () => {
  const { store, cleanup } = testStore();
  try {
    const session = store.upload([{ name: "draft.png", bytes: png }]).session;
    const student = store.addStudent("Synthetic Student");
    const saved = store.save(session.id, 1, validDraft(student.id));
    assert.throws(
      () => store.deleteDraft(session.id, 1),
      /changed in another tab/,
    );
    assert.deepEqual(store.get(session.id), saved);
    const confirmed = store.save(session.id, saved.revision, saved.draft, true);
    assert.equal(confirmed.hasConfirmationHistory, true);
    assert.throws(
      () => store.deleteDraft(session.id, confirmed.revision),
      /confirmation history/,
    );
    const edited = store.save(session.id, confirmed.revision, {
      ...confirmed.draft,
      remarks: "Edited",
    });
    assert.equal(edited.confirmedAt, null);
    assert.equal(edited.hasConfirmationHistory, true);
    assert.throws(
      () => store.deleteDraft(session.id, edited.revision),
      /confirmation history/,
    );
    assert.deepEqual(store.photo(session.photos[0].id).bytes, png);
  } finally {
    cleanup();
  }
});
test("an interrupted file cleanup can be retried after reopening the database", () => {
  const { store, dir, cleanup } = testStore();
  try {
    const session = store.upload([{ name: "draft.png", bytes: png }]).session;
    const path = join(dir, "photos", session.photos[0].id);
    const moved = `${path}.saved`;
    renameSync(path, moved);
    mkdirSync(path); // Force a real filesystem cleanup failure.
    assert.throws(() => store.deleteDraft(session.id, session.revision));
    assert.throws(() => store.get(session.id), /not found/);
    rmSync(path, { recursive: true });
    renameSync(moved, path);
    const reopened = new Store(dir);
    try {
      reopened.deleteDraft(session.id, session.revision);
      assert.equal(existsSync(path), false);
      assert.equal(
        reopened.db.prepare("SELECT count(*) AS n FROM photo_deletions").get()!
          .n,
        0,
      );
    } finally {
      reopened.close();
    }
  } finally {
    cleanup();
  }
});
test("the deletion migration preserves existing drafts and works on a reused development connection", () => {
  const { store, dir, cleanup } = testStore();
  try {
    const session = store.upload([
      { name: "legacy-draft.png", bytes: png },
    ]).session;
    store.db.exec("DROP TABLE photo_deletions; PRAGMA user_version = 1;");
    const refreshed = new Store(dir, store.db);
    assert.deepEqual(refreshed.get(session.id), session);
    assert.equal(refreshed.db, store.db);
    assert.equal(
      store.db.prepare("PRAGMA user_version").get()!.user_version,
      2,
    );
    refreshed.deleteDraft(session.id, session.revision);
    assert.equal(refreshed.list().length, 0);
  } finally {
    cleanup();
  }
});
