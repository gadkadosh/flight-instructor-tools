"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createStudent,
  deleteDraft,
  extractSession,
  saveSession,
} from "../app/actions";
import { confirmationIssues, duration, totals } from "../../lib/record.ts";
import type { Draft, RecordSession, Student } from "../../lib/record.ts";
import Field, { numberOrNull } from "./Field";
import PhotoReview from "./PhotoReview";
import FlightBlocks from "./FlightBlocks";
import type { ExtractionProvider } from "../../lib/extraction-provider.ts";

export default function Editor({
  initial,
  students: initialStudents,
  extractor,
  suggestedStudentId: initialSuggestion,
  upload,
}: {
  initial: RecordSession;
  students: Student[];
  extractor: ExtractionProvider | null;
  suggestedStudentId: string | null;
  upload?: string;
}) {
  const router = useRouter();
  const [record, setRecord] = useState(initial);
  const [draft, setDraft] = useState(initial.draft);
  const [students, setStudents] = useState(initialStudents);
  const [suggestion, setSuggestion] = useState(initialSuggestion);
  const [newStudent, setNewStudent] = useState("");
  const [rememberAlias, setRememberAlias] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(
    upload === "existing"
      ? "These photos are already saved. Reopened the existing record."
      : upload === "new"
        ? "Originals saved. Review manually or request a handwriting reading."
        : "",
  );
  const dirty = JSON.stringify(draft) !== JSON.stringify(record.draft);
  const issues = confirmationIssues(draft, students);
  const calculated = totals(draft);
  const confirmed = !!record.confirmedAt && !dirty;

  useEffect(() => {
    const prevent = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault();
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty]);

  function change<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({
      ...d,
      [key]: value,
      reviewComplete: key === "reviewComplete" ? (value as boolean) : false,
      identityConfirmed:
        key === "handwrittenStudent" || key === "studentId"
          ? false
          : key === "identityConfirmed"
            ? (value as boolean)
            : d.identityConfirmed,
    }));
  }
  async function save(confirm: boolean) {
    setBusy(confirm ? "Confirming…" : "Saving…");
    setError("");
    setNotice("");
    try {
      const result = await saveSession(
        record.id,
        record.revision,
        draft,
        confirm,
        rememberAlias,
      );
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setRecord(result.value);
      setDraft(result.value.draft);
      setNotice(
        confirm
          ? "Record explicitly confirmed. Any further changes will require renewed confirmation."
          : "Draft saved on this machine.",
      );
    } catch {
      setError("Save response was lost. Retry the same save safely.");
    } finally {
      setBusy("");
    }
  }
  async function extract() {
    setBusy(
      `Reading photos with ${extractor?.provider === "chatgpt" ? "ChatGPT" : "Ollama"}… This can take a few minutes.`,
    );
    setError("");
    setNotice("");
    try {
      const result = await extractSession(record.id, record.revision, extractor);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setRecord(result.value.session);
      setDraft(result.value.session.draft);
      setSuggestion(result.value.suggestedStudentId);
      setNotice(result.value.session.extractionNote);
    } catch {
      setError(
        "Could not receive the extraction result. Reload to check the saved draft.",
      );
    } finally {
      setBusy("");
    }
  }
  async function addStudent() {
    setBusy("Adding student…");
    setError("");
    try {
      const result = await createStudent(newStudent);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setStudents((s) => [...s, result.value]);
      change("studentId", result.value.id);
      setNewStudent("");
    } catch {
      setError("Could not add the student. Reload to check before retrying.");
    } finally {
      setBusy("");
    }
  }

  async function removeDraft() {
    if (
      !window.confirm(
        "Delete this draft and its uploaded photo copies? Any unsaved changes will be discarded. Your originals in Photos are unaffected. This cannot be undone.",
      )
    )
      return;
    setBusy("Deleting draft…");
    setError("");
    try {
      const result = await deleteDraft(record.id, record.revision);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDraft(record.draft);
      router.replace("/");
      router.refresh();
    } catch {
      setError(
        "The deletion response was lost. You can safely retry deleting this draft.",
      );
    } finally {
      setBusy("");
    }
  }

  return (
    <main className="review-workspace">
      <header className="masthead">
        <Link
          className="brand"
          href="/"
          onClick={(e) => {
            if (dirty) {
              e.preventDefault();
              setError("Save your draft before returning to the workspace.");
            }
          }}
        >
          <span className="brand-icon">↗</span> Flight Instructor Tools
        </Link>
        <span className="local">
          <i /> Local workspace
        </span>
      </header>
      <div className="review-heading">
        <div>
          <p className="eyebrow">REVIEW WORKSPACE</p>
          <h1>{draft.handwrittenStudent || "A new teaching record"}</h1>
          <p className="muted">
            {record.photos.length} linked{" "}
            {record.photos.length === 1 ? "page" : "pages"} · Revision{" "}
            {record.revision} · Flight and block times in UTC
          </p>
        </div>
        <span className={`badge ${confirmed ? "confirmed" : "draft"}`}>
          {dirty
            ? "Unsaved changes"
            : confirmed
              ? "Confirmed"
              : "Draft · needs review"}
        </span>
      </div>
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="review-grid">
        <PhotoReview
          record={record}
          extractor={extractor}
          busy={!!busy}
          dirty={dirty}
          onExtract={extract}
          onUploaded={(session) => {
            setRecord(session);
            setDraft(session.draft);
            setNotice(
              "Session pages saved. Review the complete grouping before confirming.",
            );
          }}
          onUploadBusy={(uploading) =>
            setBusy(uploading ? "Adding session pages…" : "")
          }
        />
        <section className="editor-panel">
          <div className="panel-heading">
            <h2>Teaching record</h2>
            <span className="muted">You have the final say</span>
            {!record.hasConfirmationHistory && !record.confirmedAt && (
              <button
                className="text-button danger"
                disabled={!!busy}
                onClick={removeDraft}
              >
                Delete draft
              </button>
            )}
          </div>
          <fieldset disabled={!!busy} className="editor-fields">
            <section className="form-section">
              <div className="step-title">
                <span>01</span>
                <h3>Student & session</h3>
              </div>
              <div className="fields">
                <Field
                  label="Student name as written"
                  value={draft.handwrittenStudent}
                  onChange={(v) => change("handwrittenStudent", v)}
                  wide
                />
                <label className="wide">
                  <span>Student identity</span>
                  <select
                    value={draft.studentId}
                    onChange={(e) => change("studentId", e.target.value)}
                  >
                    <option value="">Select the actual student…</option>
                    {students.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} · {s.id.slice(0, 6)}
                      </option>
                    ))}
                  </select>
                </label>
                {suggestion &&
                  students.some((s) => s.id === suggestion) &&
                  !draft.studentId && (
                    <button
                      className="suggestion wide"
                      onClick={() => change("studentId", suggestion)}
                    >
                      Remembered alias suggests{" "}
                      {students.find((s) => s.id === suggestion)?.name}. Select
                      this student →
                    </button>
                  )}
                <div className="new-student wide">
                  <Field
                    label="Or create a student identity"
                    value={newStudent}
                    onChange={setNewStudent}
                    placeholder="Full confirmed name"
                  />
                  <button
                    className="secondary"
                    disabled={!newStudent.trim()}
                    onClick={addStudent}
                  >
                    Add student
                  </button>
                </div>
                <label className="check wide">
                  <input
                    type="checkbox"
                    checked={draft.identityConfirmed}
                    onChange={(e) =>
                      change("identityConfirmed", e.target.checked)
                    }
                  />
                  <span>
                    I checked the sheet and confirm this is the selected
                    student.
                  </span>
                </label>
                <Field
                  label="Session date (UTC)"
                  type="date"
                  value={draft.date}
                  onChange={(v) => change("date", v)}
                />
                <Field
                  label="Aircraft registration"
                  value={draft.aircraft}
                  onChange={(v) => change("aircraft", v)}
                  placeholder="D-…"
                />
                <Field
                  label="Preparation (minutes)"
                  type="number"
                  value={draft.preparationMinutes}
                  onChange={(v) =>
                    change("preparationMinutes", numberOrNull(v))
                  }
                  placeholder="Unknown; not zero"
                />
              </div>
            </section>
            <FlightBlocks
              blocks={draft.blocks}
              onChange={(blocks) => change("blocks", blocks)}
            />
            <section className="form-section">
              <div className="step-title">
                <span>03</span>
                <h3>Totals & review notes</h3>
              </div>
              <div className="totals">
                <div>
                  <span>Calculated flight</span>
                  <strong>{duration(calculated.flight)}</strong>
                </div>
                <div>
                  <span>Calculated block</span>
                  <strong>{duration(calculated.block)}</strong>
                </div>
                <div>
                  <span>Preparation</span>
                  <strong>{duration(draft.preparationMinutes)}</strong>
                </div>
              </div>
              <p className="hint">
                Written totals are cross-checks across all grouped pages. Leave
                absent totals blank. They are never added as activities.
              </p>
              <div className="fields">
                <Field
                  label="Written flight total (minutes)"
                  type="number"
                  value={draft.reportedFlightMinutes}
                  onChange={(v) =>
                    change("reportedFlightMinutes", numberOrNull(v))
                  }
                />
                <Field
                  label="Written block total (minutes)"
                  type="number"
                  value={draft.reportedBlockMinutes}
                  onChange={(v) =>
                    change("reportedBlockMinutes", numberOrNull(v))
                  }
                />
                <Field
                  label="Charter information (LOCAL, verbatim)"
                  value={draft.charterLocal}
                  onChange={(v) => change("charterLocal", v)}
                  wide
                />
                <label className="wide">
                  <span>Session remarks</span>
                  <textarea
                    value={draft.remarks}
                    onChange={(e) => change("remarks", e.target.value)}
                    rows={3}
                  />
                </label>
                <label className="wide">
                  <span>Uncertainties & how you resolved them</span>
                  <textarea
                    value={draft.uncertainties}
                    onChange={(e) => change("uncertainties", e.target.value)}
                    placeholder="Keep ambiguous readings and review decisions here."
                    rows={3}
                  />
                </label>
              </div>
            </section>
            <section className="form-section confirm-section">
              <div className="step-title">
                <span>04</span>
                <h3>Make it a reviewed record</h3>
              </div>
              <label className="check">
                <input
                  type="checkbox"
                  checked={draft.reviewComplete}
                  onChange={(e) => change("reviewComplete", e.target.checked)}
                />
                <span>
                  I reviewed all photos, grouping, times, totals, identity, and
                  SOLO scope. I resolved the uncertainties above.
                </span>
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={rememberAlias}
                  onChange={(e) => setRememberAlias(e.target.checked)}
                />
                <span>
                  Remember this exact written name as an unambiguous alias for
                  this student when I confirm.
                </span>
              </label>
              {issues.length > 0 ? (
                <details className="validation">
                  <summary>
                    {issues.length} {issues.length === 1 ? "item" : "items"} to
                    resolve before confirmation
                  </summary>
                  <ul>
                    {issues.map((issue) => (
                      <li key={issue}>{issue}</li>
                    ))}
                  </ul>
                </details>
              ) : (
                <p className="ready">Ready for your explicit confirmation.</p>
              )}
              {confirmed && (
                <p className="ready">
                  Confirmed {new Date(record.confirmedAt!).toLocaleString()}.
                  Editing creates a draft requiring renewed confirmation.
                </p>
              )}
            </section>
          </fieldset>
          <div className="save-bar">
            <span aria-live="polite">
              {busy || (dirty ? "Changes are not saved yet" : "Saved locally")}
            </span>
            <button
              className="secondary"
              disabled={!!busy}
              onClick={() => save(false)}
            >
              Save draft
            </button>
            <button
              className="primary"
              disabled={!!busy || issues.length > 0 || confirmed}
              onClick={() => save(true)}
            >
              Confirm record ✓
            </button>
          </div>
        </section>
      </div>
      <footer>
        Drafts may be incomplete. Confirmations apply only to the reviewed
        revision.
      </footer>
    </main>
  );
}
