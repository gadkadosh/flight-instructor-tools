import Link from "next/link";
import { chatGPT, chatGPTUsageUrl } from "../../../../lib/chatgpt.ts";
import type { ChatGPTModel } from "../../../../lib/chatgpt.ts";
import {
  acknowledgeChatGPT,
  configureExtraction,
  connectChatGPT,
  disconnectChatGPT,
} from "./actions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function ChatGPTSettings({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const settings = await chatGPT.settings();
  const active = settings.accounts.find((a) => a.id === settings.activeId);
  let models: ChatGPTModel[] = [];
  let error = (await searchParams).error;
  if (active?.sharing) {
    try {
      models = await chatGPT.models();
    } catch (cause) {
      error ??=
        cause instanceof Error ? cause.message : "Model discovery failed.";
    }
  }
  return (
    <main className="workspace settings-page">
      <header className="masthead">
        <Link className="brand" href="/">
          ↗ Flight Instructor Tools
        </Link>
        <Link href="/">Back to records →</Link>
      </header>
      <p className="eyebrow">HANDWRITING EXTRACTION</p>
      <h1>Connect ChatGPT</h1>
      <p className="intro">
        Use your ChatGPT plan to read flight-school sheets, then review the
        proposed record beside the originals.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <section className="settings-card">
        {active?.sharing && !settings.welcomed && (
          <div className="notice" role="status">
            <strong>You’re using your ChatGPT plan.</strong>
            <p>
              Eligible requests use your plan allowance or available credits
              according to your ChatGPT usage settings.
            </p>
            <form action={acknowledgeChatGPT}>
              <button>Got it</button>
            </form>
          </div>
        )}
        <h2>ChatGPT account</h2>
        <p>
          Photos are sent to OpenAI only when you choose{" "}
          <strong>Read with ChatGPT</strong>. Uploading and manual editing stay
          local.
        </p>
        {settings.accounts.length > 0 && (
          <form action={configureExtraction} className="settings-form">
            <input type="hidden" name="provider" value="chatgpt" />
            <label>
              Saved connection
              <select name="accountId" defaultValue={settings.activeId ?? ""}>
                {!settings.activeId && (
                  <option value="">Choose a connection</option>
                )}
                {settings.accounts.map((a, index) => (
                  <option key={a.id} value={a.id}>
                    {a.email ?? "Registration pending"} · Connection {index + 1}
                    {a.connected ? "" : " · reconnect"}
                  </option>
                ))}
              </select>
            </label>
            <button className="secondary">Select account</button>
          </form>
        )}
        {active && (
          <p>
            {active.email ?? "Registration pending"} ·{" "}
            {active.sharing
              ? "ChatGPT plan usage enabled"
              : active.connected
                ? "Plan usage disabled"
                : "Disconnected"}
          </p>
        )}
        <div className="settings-controls">
          {active && (
            <form action={connectChatGPT}>
              <input type="hidden" name="accountId" value={active.id} />
              <button className="secondary">Reconnect with ChatGPT</button>
            </form>
          )}
          <form action={connectChatGPT}>
            <button>Continue with ChatGPT</button>
          </form>
          {active?.connected && (
            <form action={disconnectChatGPT}>
              <button className="text-button">Disconnect</button>
            </form>
          )}
          <a href={chatGPTUsageUrl} target="_blank" rel="noreferrer">
            Manage usage ↗
          </a>
        </div>
      </section>
      <section className="settings-card">
        <h2>Extraction model</h2>
        {models.length > 0 ? (
          <form action={configureExtraction} className="settings-form">
            <input type="hidden" name="provider" value="chatgpt" />
            <input type="hidden" name="accountId" value={active!.id} />
            <label>
              Model available to your account
              <select
                name="model"
                defaultValue={
                  models.some((m) => m.slug === active?.model)
                    ? active!.model
                    : models[0].slug
                }
              >
                {models.map((m) => (
                  <option key={m.slug} value={m.slug}>
                    {m.displayName}
                  </option>
                ))}
              </select>
            </label>
            <button>Use ChatGPT for extraction</button>
          </form>
        ) : (
          <p>
            Connect an eligible account and enable ChatGPT plan usage to load
            its available models.
          </p>
        )}
        <p className="hint">
          {active?.sharing ? "Using ChatGPT plan · " : ""}
          <a href={chatGPTUsageUrl} target="_blank" rel="noreferrer">
            Manage usage
          </a>
          . Choose a model that accepts images. Availability depends on your
          account.
        </p>
        <p>
          Current selection:{" "}
          {settings.provider === "chatgpt"
            ? `ChatGPT${active?.model ? ` · ${active.model}` : " · model not selected"}`
            : "Local Ollama"}
          .
        </p>
        <form action={configureExtraction}>
          <input type="hidden" name="provider" value="ollama" />
          <button className="secondary">Use local Ollama</button>
        </form>
        <p className="hint">
          Ollama uses OLLAMA_MODEL from .env.local. Manual entry is always
          available.
        </p>
      </section>
    </main>
  );
}
