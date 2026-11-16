import { test } from "node:test";
import assert from "node:assert/strict";
import { extractPhotos, ollamaConfig } from "../lib/extraction.ts";
import { png, sheetReading } from "./helpers.ts";

test("unconfigured extraction never substitutes fixtures and never contacts a provider", async () => {
  let calls = 0;
  const result = await extractPhotos([{ bytes: png }], null, async () => {
    calls++;
    throw new Error("must not call");
  });
  assert.equal(calls, 0);
  assert.equal(result.draft, null);
  assert.match(result.note, /unconfigured/);
});
test("Ollama receives actual source bytes and cannot authorize identity or review", async () => {
  let calls = 0;
  const result = await extractPhotos(
    [{ bytes: png }],
    { model: "test-local-vision", base: "http://127.0.0.1:11434" },
    async (url, options) => {
      assert.equal(url, "http://127.0.0.1:11434/api/chat");
      const body = JSON.parse(String(options?.body));
      assert.equal(body.model, "test-local-vision");
      assert.equal(body.options.presence_penalty, 0);
      // A real full-resolution sheet needed 4472 input tokens and was rejected
      // by the server's default 4096-token context before generation.
      assert.ok(body.options.num_ctx >= 4472 + body.options.num_predict);
      calls++;
      assert.equal(options?.redirect, "error");
      if (calls === 1) {
        assert.deepEqual(body.messages[1].images, [png.toString("base64")]);
        assert.equal(body.format, undefined);
        return Response.json({
          message: { content: "Synthetic raw transcription" },
        });
      }
      assert.equal(body.messages[1].images, undefined);
      assert.equal(body.messages[1].content, "Synthetic raw transcription");
      assert.equal(body.format.properties.preparation.type, "string");
      assert.ok(body.messages[0].content.includes(JSON.stringify(body.format)));
      return Response.json({
        message: {
          content: JSON.stringify({
            ...sheetReading(),
            studentId: "model-invented-identity",
            identityConfirmed: true,
            reviewComplete: true,
          }),
        },
      });
    },
  );
  assert.equal(result.draft?.studentId, "");
  assert.equal(result.draft?.identityConfirmed, false);
  assert.equal(result.draft?.reviewComplete, false);
  assert.equal(calls, 2);
  assert.equal(result.draft?.blocks[1].flights[0].landings, 3);
  assert.equal(result.draft?.sourceReading, "Synthetic raw transcription");
  assert.match(result.note, /test-local-vision/);
});
test("offline, malformed, and invalid model results leave the existing draft for the caller to retain", async () => {
  for (const response of [
    () => Promise.reject(new Error("offline")),
    async () => new Response("unavailable", { status: 503 }),
    async () => Response.json({ message: { content: "not json" } }),
    async () =>
      Response.json({
        message: {
          content: JSON.stringify({
            ...sheetReading(),
            blocks: null,
          }),
        },
      }),
  ]) {
    const result = await extractPhotos(
      [{ bytes: png }],
      { model: "test", base: "http://localhost:11434" },
      response,
    );
    assert.equal(result.draft, null);
    assert.match(result.note, /failed/);
    assert.match(result.note, /retained/);
  }
});
test("Ollama rejection details are retained so context failures can be diagnosed", async () => {
  const detail =
    "request (4472 tokens) exceeds the available context size (4096 tokens), try increasing it";
  const result = await extractPhotos(
    [{ bytes: png }],
    { model: "test", base: "http://localhost:11434" },
    async () => Response.json({ error: detail }, { status: 400 }),
  );
  assert.equal(result.draft, null);
  assert.match(result.note, /HTTP 400/);
  assert.ok(result.note.includes(detail));
  assert.match(result.note, /saved draft and photos are retained/);
});
test("a failed interpretation retains the raw reading and never returns a partial replacement draft", async () => {
  let calls = 0;
  const result = await extractPhotos(
    [{ bytes: png }],
    { model: "test", base: "http://localhost:11434" },
    async () => {
      calls++;
      return calls === 1
        ? Response.json({ message: { content: "Unreviewed raw table" } })
        : Response.json({ error: "mapping failed" }, { status: 400 });
    },
  );
  assert.equal(calls, 2);
  assert.equal(result.draft, null);
  assert.equal(result.sourceReading, "Unreviewed raw table");
  assert.match(result.note, /mapping failed/);
});
test("plain-text and successful-status errors include bounded provider details", async () => {
  for (const response of [
    new Response("model unavailable" + "x".repeat(1000), { status: 503 }),
    Response.json({ error: "model unavailable" + "x".repeat(1000) }),
  ]) {
    const result = await extractPhotos(
      [{ bytes: png }],
      { model: "test", base: "http://localhost:11434" },
      async () => response,
    );
    assert.equal(result.draft, null);
    assert.match(result.note, /model unavailable/);
    assert.ok(result.note.length < 500);
  }
});
test("configuration keeps photo requests on loopback and rejects remote endpoints and URL credentials", () => {
  assert.equal(ollamaConfig({}), null);
  assert.deepEqual(ollamaConfig({ OLLAMA_MODEL: "qwen3.5:4b" }), {
    model: "qwen3.5:4b",
    base: "http://127.0.0.1:11434",
  });
  for (const base of [
    "https://example.com",
    "http://192.168.0.2:11434",
    "http://user:pass@localhost:11434",
    "http://localhost:11434/path",
    "http://localhost:11434?redirect=elsewhere",
  ]) {
    assert.throws(
      () => ollamaConfig({ OLLAMA_MODEL: "test", OLLAMA_BASE_URL: base }),
      /loopback/,
    );
  }
});
