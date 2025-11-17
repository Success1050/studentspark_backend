import sharp from "sharp";

export async function compressImage(base64) {
  return sharp(Buffer.from(base64, "base64"))
    .resize({ width: 1200 }) // reduce resolution
    .jpeg({ quality: 70 }) // compress
    .toBuffer();
}
