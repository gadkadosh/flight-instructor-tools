import sharp from "sharp";

// Browsers honor EXIF orientation; model decoders need not do so. Bake the
// rotation into a PNG request copy and keep the stored original untouched.
// Bound the model copy so a full camera image does not consume the context and
// memory needed to read the sheet, especially with the local MLX runner.
export async function visionImage(bytes: Uint8Array): Promise<Uint8Array> {
  const image = sharp(bytes, { limitInputPixels: 40_000_000 });
  const { orientation, width = 0, height = 0 } = await image.metadata();
  if ((!orientation || orientation === 1) && Math.max(width, height) <= 2560)
    return bytes;
  return image
    .autoOrient()
    .resize({
      width: 2560,
      height: 2560,
      fit: "inside",
      withoutEnlargement: true,
    })
    .png()
    .toBuffer();
}
