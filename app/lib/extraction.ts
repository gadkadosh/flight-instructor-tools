import { transcriptionInstructions, mappingInstructions } from "./sheet-prompts.ts";
import { draftFromSheet, sheetSchema } from "./sheet.ts";
import type { Draft } from "./record.ts";
import { visionImage } from "./vision-image.ts";

export type ExtractionPhoto = { bytes: Uint8Array };
export type OllamaConfig = { model: string; base: string };
export type ExtractionResult = {
  draft: Draft | null;
  note: string;
  sourceReading: string;
};

export function ollamaConfig(
  env: Record<string, string | undefined> = process.env,
): OllamaConfig | null {
  const model = env.OLLAMA_MODEL?.trim();
  if (!model) return null;
  const url = new URL(env.OLLAMA_BASE_URL || "http://127.0.0.1:11434");
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "OLLAMA_BASE_URL must be an HTTP loopback address without a path or credentials.",
    );
  }
  return { model, base: url.origin };
}

type Message = { role: "system" | "user"; content: string; images?: string[] };
async function chat(
  config: OllamaConfig,
  messages: Message[],
  signal: AbortSignal,
  request: typeof fetch,
  format?: object,
): Promise<string> {
  const response = await request(`${config.base}/api/chat`, {
    method: "POST",
    redirect: "error",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.model,
      stream: false,
      think: false,
      format,
      // The installed Qwen model defaults to presence_penalty=1.5. Transcribing
      // repeated airfields and clock digits must not be penalized.
      options: {
        temperature: 0,
        presence_penalty: 0,
        num_ctx: 16384,
        num_predict: 4096,
      },
      messages,
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    let detail = body;
    try {
      const error = JSON.parse(body).error;
      detail = typeof error === "string" ? error : "";
    } catch {
      /* Some server errors are plain text. */
    }
    throw new Error(
      `Ollama returned HTTP ${response.status}${detail.trim() ? `: ${detail.trim().slice(0, 350)}` : ". Check the server and installed vision model."}`,
    );
  }
  const result = await response.json();
  if (result.error)
    throw new Error(
      typeof result.error === "string"
        ? result.error.slice(0, 350)
        : "Ollama reported an error.",
    );
  if (result.done_reason === "length")
    throw new Error(
      "Ollama reached the output limit before completing the reading.",
    );
  const content = result.message?.content;
  if (typeof content !== "string" || !content.trim() || content.length > 10000)
    throw new Error("Ollama returned an empty or oversized reading.");
  return content;
}

export async function extractPhotos(
  photos: ExtractionPhoto[],
  config = ollamaConfig(),
  request: typeof fetch = fetch,
): Promise<ExtractionResult> {
  if (!config)
    return {
      draft: null,
      sourceReading: "",
      note: "Extraction is unconfigured. Set OLLAMA_MODEL in .env.local, or enter this draft manually.",
    };
  let sourceReading = "";
  try {
    const signal = AbortSignal.timeout(180_000);
    const images: string[] = [];
    for (const photo of photos)
      images.push(
        Buffer.from(await visionImage(photo.bytes)).toString("base64"),
      );
    sourceReading = await chat(
      config,
      [
        { role: "system", content: transcriptionInstructions },
        {
          role: "user",
          content: `Transcribe these ${photos.length} proposed session pages in order.`,
          images,
        },
      ],
      signal,
      request,
    );
    const mapped = await chat(
      config,
      [
        { role: "system", content: mappingInstructions },
        { role: "user", content: sourceReading },
      ],
      signal,
      request,
      sheetSchema,
    );
    const draft = draftFromSheet(JSON.parse(mapped), sourceReading);
    return {
      draft,
      sourceReading,
      note: `Experimental local reading · ${config.model} · ${new Date().toISOString()}. Transcription and interpretation are separate; verify both against the photos.`,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown extraction error.";
    return {
      draft: null,
      sourceReading,
      note: `Local extraction failed: ${message.slice(0, 500)} Your saved draft and photos are retained.`,
    };
  }
}
