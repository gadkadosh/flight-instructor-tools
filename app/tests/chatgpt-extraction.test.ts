import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { extractWithChatGPT, chatGPTImage } from "../lib/chatgpt-extraction.ts";
import { sheetReading } from "./helpers.ts";

const png = await sharp({
  create: { width: 2, height: 3, channels: 3, background: "white" },
})
  .png()
  .toBuffer();

const access = async () => ({
  token: "synthetic-subscription-token",
  model: "synthetic-vision",
  accountId: "synthetic",
});
const event = (type: string, fields = {}) =>
  `event: ${type}\ndata: ${JSON.stringify({ type, ...fields })}\n\n`;
function stream(
  text: string,
  terminal = event("response.completed", { response: { status: "completed" } }),
) {
  return new Response(
    event("response.output_text.delta", { delta: text }) + terminal,
    { headers: { "Content-Type": "text/event-stream" } },
  );
}

test("subscription extraction sends the photo, requires completed inference, and produces an unconfirmed normalized draft", async () => {
  let calls = 0;
  const reading = {
    sourceReading: "Literal synthetic row transcription",
    sheet: {
      ...sheetReading(),
      studentId: "injected",
      identityConfirmed: true,
      reviewComplete: true,
    },
  };
  const result = await extractWithChatGPT(
    [{ bytes: png }],
    access,
    async (input, init) => {
      calls++;
      assert.equal(String(input), "https://api.openai.com/v1/responses");
      assert.equal(
        new Headers(init?.headers).get("Authorization"),
        "Bearer synthetic-subscription-token",
      );
      const body = JSON.parse(String(init?.body));
      assert.equal(body.store, false);
      assert.equal(body.stream, true);
      assert.equal(body.model, "synthetic-vision");
      assert.equal(body.text.format.type, "json_schema");
      assert.equal(body.input[0].content[1].detail, "original");
      const image = Buffer.from(
        body.input[0].content[1].image_url.split(",")[1],
        "base64",
      );
      assert.deepEqual(
        await sharp(image).raw().toBuffer(),
        await sharp(png).raw().toBuffer(),
      );
      assert.ok(!("temperature" in body));
      assert.ok(!("max_output_tokens" in body));
      return stream(JSON.stringify(reading));
    },
  );
  assert.equal(calls, 1);
  assert.equal(result.draft?.sourceReading, reading.sourceReading);
  assert.equal(result.draft?.date, "2027-04-17");
  assert.equal(result.draft?.studentId, "");
  assert.equal(result.draft?.identityConfirmed, false);
  assert.equal(result.draft?.reviewComplete, false);
  assert.equal(result.draft?.blocks[1].flights[0].landings, 3);
  assert.deepEqual(result.draft?.blocks[1].flights[0].movements[1], {
    takeoff: "11:55",
    landing: "12:00",
  });
  assert.match(result.note, /ChatGPT plan/);
});

test("interrupted, failed, incomplete, malformed, and quota-limited readings never replace a draft or retry billing", async () => {
  const reading = JSON.stringify({
    sourceReading: "Synthetic",
    sheet: sheetReading(),
  });
  for (const response of [
    stream(reading, ""),
    stream(
      reading,
      event("response.failed", {
        response: {
          error: {
            code: "subscription_sharing_usage_limit_exceeded",
            message: "Usage limit reached",
          },
        },
      }),
    ),
    stream(reading, event("response.incomplete", { response: {} })),
    stream("malformed JSON"),
    stream(
      JSON.stringify({ sourceReading: "Synthetic", sheet: { blocks: null } }),
    ),
    Response.json(
      {
        error: {
          code: "subscription_sharing_usage_limit_exceeded",
          message: "Usage limit reached",
        },
      },
      { status: 429 },
    ),
  ]) {
    let calls = 0;
    const result = await extractWithChatGPT(
      [{ bytes: png }],
      access,
      async () => {
        calls++;
        return response;
      },
    );
    assert.equal(result.draft, null);
    assert.equal(calls, 1);
    assert.match(result.note, /saved draft and photos are retained/);
  }
});

test("without a selected subscription model, no photo leaves the machine", async () => {
  const result = await extractWithChatGPT(
    [{ bytes: png }],
    async () => ({ ...(await access()), model: undefined }),
    async () => {
      assert.fail("must not contact OpenAI");
    },
  );
  assert.equal(result.draft, null);
  assert.match(result.note, /Choose a ChatGPT model/);
});

test("ChatGPT image preparation preserves full detail and bakes camera orientation into the pixels", async () => {
  const original = await sharp({
    create: { width: 2800, height: 1200, channels: 3, background: "white" },
  })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
  const url = await chatGPTImage(original);
  const metadata = await sharp(
    Buffer.from(url.split(",")[1], "base64"),
  ).metadata();
  assert.equal(metadata.width, 1200);
  assert.equal(metadata.height, 2800);
  assert.equal(metadata.orientation, undefined);
  assert.equal((await sharp(original).metadata()).orientation, 6);
});
