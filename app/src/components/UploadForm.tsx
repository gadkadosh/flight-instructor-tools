"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { uploadPhotos } from "../app/actions";
import type { RecordSession } from "../../lib/record.ts";

export default function UploadForm({
  sessionId,
  revision,
  onUploaded,
  disabled = false,
  onBusyChange,
}: {
  sessionId?: string;
  revision?: number;
  onUploaded?: (session: RecordSession) => void;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);

  async function upload() {
    setBusy(true);
    onBusyChange?.(true);
    setError("");
    try {
      const form = new FormData();
      files.forEach((file) => form.append("photos", file));
      if (sessionId) {
        form.set("sessionId", sessionId);
        form.set("revision", String(revision));
      }
      const result = await uploadPhotos(form);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setFiles([]);
      if (input.current) input.current.value = "";
      if (sessionId) {
        if (onUploaded) onUploaded(result.value.session);
        else router.refresh();
      } else
        router.push(
          `/sessions/${result.value.session.id}?upload=${result.value.duplicate ? "existing" : "new"}`,
        );
    } catch {
      setError(
        "Upload failed. Your files may already be saved; retry to reopen them.",
      );
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  }
  return (
    <section
      className={`upload-panel ${dragging ? "dragging" : ""}`}
      aria-label={sessionId ? "Add session pages" : "Upload session photos"}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (!busy && !disabled) setFiles(Array.from(e.dataTransfer.files));
      }}
    >
      <div className="upload-symbol" aria-hidden>
        ↑
      </div>
      <div className="upload-copy">
        <h2>
          {sessionId
            ? "Add pages to this session"
            : "Give your handwritten sheets a fresh start"}
        </h2>
        <p>
          {files.length
            ? files.map((f) => f.name).join(", ")
            : "Drop photos here, or choose files. JPEG, PNG or WebP · up to 8 pages / 20 MiB."}
        </p>
        <small>
          {sessionId
            ? "New pages require another review and confirmation."
            : "Group pages from the same session. Upload unrelated sessions separately."}
        </small>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        disabled={busy || disabled}
        className="file-input"
        aria-label="Choose session photos"
        onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
      />
      <div className="upload-buttons">
        <button
          className={files.length ? "secondary" : "primary"}
          disabled={busy || disabled}
          onClick={() => input.current?.click()}
        >
          Choose photos
        </button>
        {files.length > 0 && (
          <button
            className="primary"
            disabled={busy || disabled}
            onClick={upload}
          >
            {busy
              ? "Saving photos…"
              : sessionId
                ? "Add pages"
                : "Create / reopen draft →"}
          </button>
        )}
      </div>
      {error && (
        <p className="error full" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
