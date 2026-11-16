import Link from "next/link";
import { getStore } from "../../lib/store.ts";
import { extractionProvider } from "../../lib/extraction-provider.ts";
import { duration, totals } from "../../lib/record.ts";
import UploadForm from "../components/UploadForm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function Home() {
  const sessions = getStore().list();
  let extraction = "Unconfigured · manual entry available";
  try {
    const config = await extractionProvider();
    if (config)
      extraction = `${config.provider === "chatgpt" ? "ChatGPT plan" : "Ollama"} · ${config.model} · experimental`;
  } catch {
    extraction = "Extraction settings unavailable · manual entry available";
  }
  return (
    <main className="workspace">
      <header className="masthead">
        <Link className="brand" href="/">
          <span className="brand-icon">↗</span> Flight Instructor Tools
        </Link>
        <span className="local">
          <i /> Local workspace
        </span>
      </header>
      <div className="page-heading">
        <div>
          <p className="eyebrow">PHOTO TO TEACHING RECORD</p>
          <h1>
            Less paperwork.
            <br />
            <span>More time in the air.</span>
          </h1>
          <p className="intro">
            Bring your sheets. Review the details. Keep a record you trust.
          </p>
        </div>
        <div className="workflow">
          <span>01 &nbsp; Upload</span>
          <span>02 &nbsp; Review</span>
          <span>03 &nbsp; Confirm</span>
        </div>
      </div>
      <UploadForm />
      <p className="provider">
        {extraction}. Extraction runs only when you request it.{" "}
        <Link href="/settings/chatgpt">Extraction settings →</Link>
      </p>
      <section className="records">
        <div className="section-heading">
          <div>
            <p className="eyebrow">YOUR WORKSPACE</p>
            <h2>
              Teaching records <span className="count">{sessions.length}</span>
            </h2>
          </div>
          <span className="muted">Saved on this machine</span>
        </div>
        {sessions.length === 0 ? (
          <div className="empty">
            <span className="empty-icon">≡</span>
            <h3>Your next session starts here</h3>
            <p>
              Upload the pages from one session together.
              <br />
              Incomplete records are welcome; confirmation comes after review.
            </p>
          </div>
        ) : (
          <div className="record-list">
            {sessions.map((s) => (
              <Link
                href={`/sessions/${s.id}`}
                className="record-row"
                key={s.id}
              >
                <div className="record-icon">↗</div>
                <div className="record-title">
                  <strong>
                    {s.draft.handwrittenStudent || "Unidentified student"}
                  </strong>
                  <span>
                    {s.draft.date || "Date to review"} ·{" "}
                    {s.draft.aircraft || "Aircraft to review"} ·{" "}
                    {s.photos.length} {s.photos.length === 1 ? "page" : "pages"}
                  </span>
                </div>
                <div className="record-duration">
                  {duration(totals(s.draft).block)}
                  <span>block time</span>
                </div>
                <span
                  className={`badge ${s.confirmedAt ? "confirmed" : "draft"}`}
                >
                  {s.confirmedAt ? "Confirmed" : "Draft"}
                </span>
                <span aria-hidden>→</span>
              </Link>
            ))}
          </div>
        )}
      </section>
      <footer>
        Originals stay linked. Drafts stay editable. You decide when a record is
        ready.
      </footer>
    </main>
  );
}
