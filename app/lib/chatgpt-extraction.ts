import OpenAI from "openai";
import sharp from "sharp";
import { chatGPT } from "./chatgpt.ts";
import type { ExtractionPhoto, ExtractionResult } from "./extraction.ts";
import { draftFromSheet, schemaFor, sheetTemplate } from "./sheet.ts";
import {
  transcriptionInstructions,
  mappingInstructions,
} from "./sheet-prompts.ts";

export const readingSchema = schemaFor({
  sourceReading: "",
  sheet: sheetTemplate,
});

// Unlike the small local runner, preserve camera detail for cloud handwriting
// recognition. Bake rotation into the pixels; the stored original stays intact.
export async function chatGPTImage(bytes: Uint8Array) {
  const buffer = await sharp(bytes, { limitInputPixels: 40_000_000 })
    .autoOrient()
    .png()
    .toBuffer();
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

export async function extractWithChatGPT(
  photos: ExtractionPhoto[],
  access = () => chatGPT.access(),
  request: typeof fetch = fetch,
): Promise<ExtractionResult> {
  try {
    const { token, model } = await access();
    if (!model) throw new Error("Choose a ChatGPT model in settings first.");
    const client = new OpenAI({
      apiKey: token,
      baseURL: "https://api.openai.com/v1",
      fetch: request,
      maxRetries: 0,
      timeout: 180_000,
    });
    const images = await Promise.all(photos.map((p) => chatGPTImage(p.bytes)));
    const stream = await client.responses.create(
      {
        model,
        store: false,
        stream: true,
        instructions: `${transcriptionInstructions}\n\n${mappingInstructions}\n\nReturn a JSON object with sourceReading (the literal transcription as a string) and sheet (the structured sheet). First read every occupied row; then structure it without dropping rows. Keep unresolved characters marked with ? and explain uncertainties.`,
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: `Read these ${images.length} pages from one proposed session, in order.`,
              },
              ...images.map((image_url) => ({
                type: "input_image" as const,
                image_url,
                detail: "original" as const,
              })),
            ],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "flight_sheet_reading",
            strict: true,
            schema: readingSchema as Record<string, unknown>,
          },
        },
      },
      { signal: AbortSignal.timeout(180_000) },
    );
    let output = "";
    let completed = false;
    for await (const event of stream) {
      if (event.type === "response.output_text.delta") output += event.delta;
      if (output.length > 100_000)
        throw new Error("ChatGPT returned an oversized reading.");
      if (event.type === "response.completed") completed = true;
      if (event.type === "response.failed")
        throw new Error(
          `${event.response.error?.message ?? "ChatGPT extraction failed."}${event.response.error?.code ? ` (${event.response.error.code})` : ""}`,
        );
      if (event.type === "error")
        throw new Error(
          `${event.message}${event.code ? ` (${event.code})` : ""}${event.param ? ` · ${event.param}` : ""}`,
        );
      if (event.type === "response.incomplete")
        throw new Error(
          "ChatGPT did not complete the reading. Try again or enter the draft manually.",
        );
    }
    if (!completed)
      throw new Error(
        "ChatGPT's response was interrupted. No draft was replaced.",
      );
    const value = JSON.parse(output);
    if (
      typeof value.sourceReading !== "string" ||
      !value.sourceReading.trim() ||
      value.sourceReading.length > 10000
    )
      throw new Error("ChatGPT returned no usable source transcription.");
    return {
      draft: draftFromSheet(value.sheet, value.sourceReading),
      sourceReading: value.sourceReading,
      note: `ChatGPT plan · ${model} · ${new Date().toISOString()}. Verify the transcription and draft against the originals.`,
    };
  } catch (error) {
    // Do not expose request options: they contain photos and authorization.
    const detail =
      error instanceof Error
        ? error.message.slice(0, 600)
        : "Unknown extraction error.";
    return {
      draft: null,
      sourceReading: "",
      note: `ChatGPT extraction failed: ${detail} Your saved draft and photos are retained. Manage usage or reconnect in ChatGPT settings.`,
    };
  }
}
