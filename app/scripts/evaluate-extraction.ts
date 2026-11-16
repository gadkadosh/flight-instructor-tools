import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { extractPhotos, ollamaConfig } from "../lib/extraction.ts";
import { extractWithChatGPT } from "../lib/chatgpt-extraction.ts";
import { chatGPT } from "../lib/chatgpt.ts";

const [sessionId, model, expectedPath] = process.argv.slice(2);
if (!sessionId)
  throw new Error(
    "Usage: npm run evaluate -- <session-id> [ollama-model|chatgpt] [expected-json-path]",
  );
const subscription = model === "chatgpt";
const config = subscription
  ? { model: (await chatGPT.access()).model, base: "https://api.openai.com/v1" }
  : ollamaConfig({
      ...process.env,
      ...(model ? { OLLAMA_MODEL: model } : {}),
    });
if (!config?.model)
  throw new Error(
    "Select an Ollama vision model, or connect ChatGPT and select a model in extraction settings.",
  );
const directory = join(process.cwd(), "local");
const db = new DatabaseSync(join(directory, "records.sqlite"), {
  readOnly: true,
});
const photos = db
  .prepare("SELECT id FROM photos WHERE session_id = ? ORDER BY position, id")
  .all(sessionId);
db.close();
if (!photos.length) throw new Error("Session has no photos.");
const start = Date.now();
const requests: unknown[] = [];
const request: typeof fetch = async (url, options) => {
  const body = JSON.parse(String(options?.body));
  const response = await fetch(url, options);
  requests.push({
    ...body,
    ...(body.messages
      ? {
          messages: body.messages.map((m: { images?: string[] }) => ({
            ...m,
            ...(m.images
              ? { images: m.images.map(() => "<source photo bytes>") }
              : {}),
          })),
        }
      : {}),
    ...(body.input
      ? {
          input: body.input.map(
            (m: { content: Record<string, unknown>[] }) => ({
              ...m,
              content: m.content.map((c) =>
                c.type === "input_image"
                  ? { ...c, image_url: "<source photo bytes>" }
                  : c,
              ),
            }),
          ),
        }
      : {}),
    status: response.status,
    response: subscription
      ? await response.clone().text()
      : await response.clone().json(),
  });
  return response;
};
const source = photos.map((p) => ({
  bytes: readFileSync(join(directory, "photos", String(p.id))),
}));
const result = subscription
  ? await extractWithChatGPT(source, () => chatGPT.access(), request)
  : await extractPhotos(
      source,
      { model: config.model, base: config.base },
      request,
    );
const actual = result.draft
  ? { ...result.draft, flights: result.draft.blocks.flatMap((b) => b.flights) }
  : null;
const differences: string[] = [];
function compare(expected: unknown, actual: unknown, path = "record") {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length)
      differences.push(
        `${path}: expected ${expected.length} entries, received ${Array.isArray(actual) ? actual.length : "none"}`,
      );
    expected.forEach((value, i) =>
      compare(
        value,
        Array.isArray(actual) ? actual[i] : undefined,
        `${path}[${i}]`,
      ),
    );
  } else if (expected && typeof expected === "object") {
    for (const [key, value] of Object.entries(expected))
      compare(
        value,
        actual && typeof actual === "object"
          ? (actual as Record<string, unknown>)[key]
          : undefined,
        `${path}.${key}`,
      );
  } else if (expected !== actual)
    differences.push(
      `${path}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
}
// The expected reading is used only AFTER inference, never sent to the model.
if (expectedPath)
  compare(JSON.parse(readFileSync(expectedPath, "utf8")), actual);
const output = join(
  directory,
  "evaluation",
  `${sessionId}-${config.model.replace(/[^a-z0-9_-]/gi, "_")}-${Date.now()}.json`,
);
mkdirSync(join(directory, "evaluation"), { recursive: true, mode: 0o700 });
writeFileSync(
  output,
  JSON.stringify(
    {
      model: config.model,
      seconds: (Date.now() - start) / 1000,
      ...result,
      requests,
      differences,
    },
    null,
    2,
  ),
  { mode: 0o600 },
);
console.log(
  JSON.stringify(
    {
      output,
      seconds: (Date.now() - start) / 1000,
      hasDraft: !!result.draft,
      differences,
      note: result.note,
    },
    null,
    2,
  ),
);
if (!result.draft || differences.length) process.exitCode = 1;
