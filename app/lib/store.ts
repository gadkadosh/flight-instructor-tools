import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { confirmationIssues, emptyDraft, parseDraft } from "./record.ts";
import type { Draft, Photo, RecordSession, Student } from "./record.ts";

export type Upload = { name: string; bytes: Uint8Array };
type SessionRow = {
  id: string;
  revision: number;
  confirmed_at: string | null;
  updated_at: string;
  extraction_note: string;
  payload: string;
};

export class Store {
  readonly db: DatabaseSync;
  readonly directory: string;

  constructor(directory: string, database?: DatabaseSync) {
    this.directory = directory;
    mkdirSync(join(directory, "photos"), { recursive: true, mode: 0o700 });
    this.db = database ?? new DatabaseSync(join(directory, "records.sqlite"));
    this.db.exec(
      "PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;",
    );
    const migrations = [
      `CREATE TABLE sessions (
        id TEXT PRIMARY KEY, revision INTEGER NOT NULL, payload TEXT NOT NULL,
        confirmed_at TEXT, updated_at TEXT NOT NULL, extraction_note TEXT NOT NULL
      );
      CREATE TABLE photos (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id),
        name TEXT NOT NULL, mime TEXT NOT NULL, position INTEGER NOT NULL
      );
      CREATE TABLE students (id TEXT PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE aliases (alias TEXT PRIMARY KEY, student_id TEXT REFERENCES students(id));
      CREATE TABLE confirmations (
        session_id TEXT NOT NULL REFERENCES sessions(id), revision INTEGER NOT NULL,
        confirmed_at TEXT NOT NULL, payload TEXT NOT NULL,
        PRIMARY KEY(session_id, revision)
      );`,
      `CREATE TABLE photo_deletions (id TEXT PRIMARY KEY);`,
    ];
    this.transaction(() => {
      const version = Number(
        this.db.prepare("PRAGMA user_version").get()!.user_version,
      );
      if (version > migrations.length)
        throw new Error(
          "Database is newer than this app. Use the newer app version.",
        );
      for (let i = version; i < migrations.length; i++) {
        this.db.exec(migrations[i]);
        this.db.exec(`PRAGMA user_version = ${i + 1}`);
      }
    });
  }

  close() {
    this.db.close();
  }

  private transaction<T>(operation: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  get(id: string): RecordSession {
    const row = this.db
      .prepare("SELECT * FROM sessions WHERE id = ?")
      .get(id) as SessionRow | undefined;
    if (!row) throw new Error("Session not found.");
    const photos = (
      this.db
        .prepare(
          "SELECT id, name, mime FROM photos WHERE session_id = ? ORDER BY position, id",
        )
        .all(id) as Photo[]
    ).map((p) => ({ ...p }));
    return {
      id,
      revision: row.revision,
      confirmedAt: row.confirmed_at,
      hasConfirmationHistory: !!this.db
        .prepare("SELECT 1 FROM confirmations WHERE session_id = ? LIMIT 1")
        .get(id),
      updatedAt: row.updated_at,
      extractionNote: row.extraction_note,
      draft: parseDraft(JSON.parse(row.payload)),
      photos,
    };
  }

  list(): RecordSession[] {
    return (
      this.db
        .prepare("SELECT id FROM sessions ORDER BY updated_at DESC, id")
        .all() as { id: string }[]
    ).map((r) => this.get(r.id));
  }

  students(): Student[] {
    return (
      this.db
        .prepare("SELECT id, name FROM students ORDER BY name, id")
        .all() as Student[]
    ).map((s) => ({ ...s }));
  }

  addStudent(name: string): Student {
    name = name.trim();
    if (!name || name.length > 200)
      throw new Error("Enter a student name (up to 200 characters).");
    // Same-name people may be distinct. The user explicitly chooses the identity.
    const student = { id: randomUUID(), name };
    this.db
      .prepare("INSERT INTO students (id, name) VALUES (?, ?)")
      .run(student.id, student.name);
    return student;
  }

  suggestStudent(handwritten: string): string | null {
    const row = this.db
      .prepare("SELECT student_id FROM aliases WHERE alias = ?")
      .get(normalizeAlias(handwritten));
    return row?.student_id ? String(row.student_id) : null;
  }

  upload(
    files: Upload[],
    targetId?: string,
    expectedRevision?: number,
  ): { session: RecordSession; duplicate: boolean } {
    if (!files.length || files.length > 8)
      throw new Error("Choose between 1 and 8 photos per upload.");
    if (files.reduce((sum, f) => sum + f.bytes.length, 0) > 20 * 1024 * 1024)
      throw new Error("Upload at most 20 MiB at a time.");
    const prepared = files.map((f) => {
      const mime = imageType(f.bytes);
      if (!mime)
        throw new Error(
          "Use JPEG, PNG, or WebP photos. Convert HEIC/PDF files first.",
        );
      return {
        ...f,
        mime,
        id: createHash("sha256").update(f.bytes).digest("hex"),
      };
    });
    return this.transaction(() => {
      const existing = prepared.map((f) =>
        this.db.prepare("SELECT session_id FROM photos WHERE id = ?").get(f.id),
      );
      const owners = [
        ...new Set(existing.filter(Boolean).map((r) => String(r!.session_id))),
      ];
      if (
        owners.length === 1 &&
        existing.every(Boolean) &&
        (!targetId || targetId === owners[0])
      )
        return { session: this.get(owners[0]), duplicate: true };
      if (owners.some((id) => id !== targetId))
        throw new Error(
          `Some photos already belong to session ${owners.join(", ")}. Reopen that session to add pages; upload unrelated sheets separately.`,
        );
      const id = targetId ?? randomUUID();
      if (targetId) {
        const session = this.get(targetId);
        if (expectedRevision !== session.revision)
          throw new Error("This session changed. Reload before adding pages.");
      } else {
        this.db
          .prepare("INSERT INTO sessions VALUES (?, 1, ?, NULL, ?, ?)")
          .run(
            id,
            JSON.stringify(emptyDraft()),
            new Date().toISOString(),
            "Not extracted. Enter details manually or try local Ollama.",
          );
      }
      let position = Number(
        this.db
          .prepare("SELECT count(*) AS n FROM photos WHERE session_id = ?")
          .get(id)!.n,
      );
      let added = 0;
      for (const file of prepared) {
        if (this.db.prepare("SELECT id FROM photos WHERE id = ?").get(file.id))
          continue;
        writeFileSync(join(this.directory, "photos", file.id), file.bytes, {
          mode: 0o600,
        });
        this.db
          .prepare("INSERT INTO photos VALUES (?, ?, ?, ?, ?)")
          .run(file.id, id, file.name.slice(0, 200), file.mime, position++);
        added++;
      }
      if (targetId && added) {
        const draft = this.get(id).draft;
        draft.reviewComplete = false;
        this.db
          .prepare(
            "UPDATE sessions SET revision = revision + 1, confirmed_at = NULL, payload = ?, updated_at = ? WHERE id = ?",
          )
          .run(JSON.stringify(draft), new Date().toISOString(), id);
      }
      return { session: this.get(id), duplicate: added === 0 };
    });
  }

  save(
    id: string,
    revision: number,
    input: unknown,
    confirm = false,
    rememberAlias = false,
    extractionNote?: string,
  ): RecordSession {
    const draft = parseDraft(input);
    return this.transaction(() => {
      const current = this.get(id);
      const payload = JSON.stringify(draft);
      const unchanged = JSON.stringify(current.draft) === payload;
      // A retry of the same save converges, even when the response was lost.
      if (current.revision !== revision && !unchanged)
        throw new Error(
          "This session changed in another tab. Reload before saving your changes.",
        );
      if (confirm) {
        const issues = confirmationIssues(draft, this.students());
        if (!current.photos.length)
          issues.push("Keep at least one source photo linked to the session.");
        if (issues.length) throw new Error(issues.join("\n"));
        const alias = normalizeAlias(draft.handwrittenStudent);
        const known = this.db
          .prepare("SELECT student_id FROM aliases WHERE alias = ?")
          .get(alias);
        if (rememberAlias) {
          if (known && known.student_id !== draft.studentId)
            throw new Error(
              "This alias already identifies another student or is ambiguous. Leave it unremembered; ambiguous aliases cannot be reassigned.",
            );
          this.db
            .prepare("INSERT OR IGNORE INTO aliases VALUES (?, ?)")
            .run(alias, draft.studentId);
        }
        // Once confirmed for two different people, an alias can never suggest either one.
        if (known && known.student_id !== draft.studentId)
          this.db
            .prepare("UPDATE aliases SET student_id = NULL WHERE alias = ?")
            .run(alias);
      }
      const nextRevision = current.revision + (unchanged ? 0 : 1);
      const confirmedAt = confirm
        ? unchanged && current.confirmedAt
          ? current.confirmedAt
          : new Date().toISOString()
        : unchanged
          ? current.confirmedAt
          : null;
      if (
        !unchanged ||
        confirmedAt !== current.confirmedAt ||
        (extractionNote !== undefined &&
          extractionNote !== current.extractionNote)
      ) {
        this.db
          .prepare(
            "UPDATE sessions SET revision = ?, payload = ?, confirmed_at = ?, updated_at = ?, extraction_note = ? WHERE id = ?",
          )
          .run(
            nextRevision,
            payload,
            confirmedAt,
            new Date().toISOString(),
            extractionNote ?? current.extractionNote,
            id,
          );
      }
      if (confirm)
        this.db
          .prepare("INSERT OR IGNORE INTO confirmations VALUES (?, ?, ?, ?)")
          .run(id, nextRevision, confirmedAt, payload);
      return this.get(id);
    });
  }

  deleteDraft(id: string, revision: number): void {
    this.transaction(() => {
      const current = this.db
        .prepare("SELECT revision, confirmed_at FROM sessions WHERE id = ?")
        .get(id);
      // A lost deletion response can be retried safely.
      if (!current) return;
      if (
        current.confirmed_at ||
        this.db
          .prepare("SELECT 1 FROM confirmations WHERE session_id = ? LIMIT 1")
          .get(id)
      ) {
        throw new Error("Records with confirmation history cannot be deleted.");
      }
      if (current.revision !== revision)
        throw new Error(
          "This draft changed in another tab. Reload before deleting it.",
        );
      // Cleanup remains retryable after the draft has been removed from SQLite.
      this.db
        .prepare(
          "INSERT OR IGNORE INTO photo_deletions SELECT id FROM photos WHERE session_id = ?",
        )
        .run(id);
      this.db.prepare("DELETE FROM photos WHERE session_id = ?").run(id);
      this.db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
    });
    this.transaction(() => {
      for (const photo of this.db
        .prepare("SELECT id FROM photo_deletions")
        .all()) {
        const photoId = String(photo.id);
        // A reupload may have reclaimed these bytes. The writer lock protects
        // this check and removal from concurrent uploads.
        if (
          !this.db.prepare("SELECT 1 FROM photos WHERE id = ?").get(photoId)
        ) {
          rmSync(join(this.directory, "photos", photoId), { force: true });
        }
        this.db
          .prepare("DELETE FROM photo_deletions WHERE id = ?")
          .run(photoId);
      }
    });
  }

  photo(id: string): { bytes: Uint8Array; mime: string } {
    const row = this.db.prepare("SELECT mime FROM photos WHERE id = ?").get(id);
    if (!row || !/^[a-f0-9]{64}$/.test(id)) throw new Error("Photo not found.");
    return {
      bytes: readFileSync(join(this.directory, "photos", id)),
      mime: String(row.mime),
    };
  }
}

function normalizeAlias(alias: string): string {
  return alias
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("de-DE")
    .replace(/\s+/g, " ");
}

function imageType(bytes: Uint8Array): string | null {
  const b = Buffer.from(bytes);
  if (
    b.length >= 8 &&
    b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "image/png";
  if (b.length >= 3 && b[0] === 255 && b[1] === 216 && b[2] === 255)
    return "image/jpeg";
  if (
    b.length >= 12 &&
    b.toString("ascii", 0, 4) === "RIFF" &&
    b.toString("ascii", 8, 12) === "WEBP"
  )
    return "image/webp";
  return null;
}

// One connection per server process, including Next development hot reloads.
const globalStore = globalThis as typeof globalThis & { flightStore?: Store };
export function getStore(): Store {
  // Hot reloads replace class code but can retain its old instance. Reuse the
  // connection with the current methods and migrations rather than stale code.
  if (
    !globalStore.flightStore ||
    Object.getPrototypeOf(globalStore.flightStore) !== Store.prototype
  ) {
    globalStore.flightStore = new Store(
      join(process.cwd(), "local"),
      globalStore.flightStore?.db,
    );
  }
  return globalStore.flightStore;
}
