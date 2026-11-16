"use client";

import { useState } from "react";
import type { RecordSession } from "../../lib/record.ts";
import UploadForm from "./UploadForm";
import type { ExtractionProvider } from "../../lib/extraction-provider.ts";

export default function PhotoReview({
  record,
  extractor,
  busy,
  dirty,
  onExtract,
  onUploaded,
  onUploadBusy,
}: {
  record: RecordSession;
  extractor: ExtractionProvider | null;
  busy: boolean;
  dirty: boolean;
  onExtract: () => void;
  onUploaded: (session: RecordSession) => void;
  onUploadBusy: (busy: boolean) => void;
}) {
  const [page, setPage] = useState(0);
  const [zoom, setZoom] = useState(100);
  const [rotation, setRotation] = useState(0);
  const photo = record.photos[page];
  const provider = extractor?.provider === "chatgpt" ? "ChatGPT" : "Ollama";
  return (
    <aside className="original-panel">
      <div className="panel-heading">
        <h2>Original sheets</h2>
        <span className="muted">Always linked</span>
      </div>
      <div className="photo-tabs" role="group" aria-label="Source pages">
        {record.photos.map((p, i) => (
          <button
            key={p.id}
            className={page === i ? "selected" : ""}
            onClick={() => {
              setPage(i);
              setZoom(100);
              setRotation(0);
            }}
            aria-pressed={page === i}
          >
            Page {i + 1}
          </button>
        ))}
      </div>
      <div className="photo-toolbar">
        <label>
          Zoom{" "}
          <input
            aria-label="Photo zoom"
            type="range"
            min="50"
            max="200"
            step="10"
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
          />
        </label>
        <button
          className="text-button"
          onClick={() => setRotation((r) => (r + 90) % 360)}
        >
          Rotate ↻
        </button>
        {photo && (
          <a href={`/photos/${photo.id}`} target="_blank" rel="noreferrer">
            Open original ↗
          </a>
        )}
      </div>
      <div className="photo-stage">
        {photo && (
          <img
            src={`/photos/${photo.id}`}
            alt={`Original session sheet ${page + 1}: ${photo.name}`}
            style={{
              width: `${zoom}%`,
              transform: `rotate(${rotation}deg)`,
            }}
          />
        )}
      </div>
      <p className="photo-name">{photo?.name}</p>
      <p className="hint">
        Compare every reading with the original. Minute shorthand expands when
        its hour is established; unresolved times need a full hour before
        confirmation.
      </p>
      <div className="extraction-box">
        <p className="eyebrow">HANDWRITING EXPERIMENT</p>
        <h3>
          {extractor
            ? `${provider} · ${extractor.model}`
            : "Extraction is unconfigured"}
        </h3>
        <p>
          {extractor
            ? "Creates a proposed reading from all linked pages. This replaces the saved draft fields and requires a fresh review."
            : "Connect ChatGPT or configure a local Ollama model in extraction settings. Manual entry is always available."}
        </p>
        {extractor?.provider === "chatgpt" && (
          <p className="hint">
            Sends all linked photos to OpenAI. Using ChatGPT plan (
            {extractor.accountLabel}) ·{" "}
            <a
              href="https://chatgpt.com/settings/usage"
              target="_blank"
              rel="noreferrer"
            >
              Manage usage ↗
            </a>
          </p>
        )}
        <button
          className="secondary"
          disabled={!!busy || dirty || !extractor}
          onClick={onExtract}
        >
          {extractor?.provider === "chatgpt"
            ? "Read with ChatGPT"
            : "Read / replace draft with Ollama"}
        </button>
        <p>
          <a href="/settings/chatgpt">Extraction settings →</a>
        </p>
        {dirty && (
          <small>Save your changes before requesting extraction.</small>
        )}
        <p className="hint">{record.extractionNote}</p>
        {record.draft.sourceReading && (
          <details>
            <summary>Source transcription · AI, unreviewed</summary>
            <pre className="source-reading">{record.draft.sourceReading}</pre>
          </details>
        )}
      </div>
      {!dirty ? (
        <UploadForm
          sessionId={record.id}
          revision={record.revision}
          onUploaded={onUploaded}
          disabled={busy}
          onBusyChange={onUploadBusy}
        />
      ) : (
        <p className="hint">
          Save your draft before adding more pages to this session.
        </p>
      )}
    </aside>
  );
}
