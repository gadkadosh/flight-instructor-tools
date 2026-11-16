import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { visionImage } from "../lib/vision-image.ts";
import { png } from "./helpers.ts";

test("sideways camera pixels become upright for the model, with no changes to the stored input", async () => {
  const original = await sharp({
    create: { width: 6, height: 4, channels: 3, background: "#176658" },
  })
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toBuffer();
  const before = Buffer.from(original);
  const normalized = await visionImage(original);
  const metadata = await sharp(normalized).metadata();
  assert.equal(metadata.width, 4);
  assert.equal(metadata.height, 6);
  assert.equal(metadata.orientation, undefined);
  assert.equal(metadata.format, "png");
  assert.deepEqual(original, before);
  const expected = await sharp(original).autoOrient().raw().toBuffer();
  assert.deepEqual(await sharp(normalized).raw().toBuffer(), expected);
});
test("images without a rotation tag retain their original bytes", async () => {
  assert.equal(await visionImage(png), png);
});
test("large camera images use a bounded model copy while the original remains full resolution", async () => {
  const original = await sharp({
    create: { width: 3000, height: 1500, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  const normalized = await visionImage(original);
  const metadata = await sharp(normalized).metadata();
  assert.equal(metadata.width, 2560);
  assert.equal(metadata.height, 1280);
  assert.equal((await sharp(original).metadata()).width, 3000);
});
