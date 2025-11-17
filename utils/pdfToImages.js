import fs from "fs";
import os from "os";
import { fromBuffer } from "pdf2pic";

export async function convertPdfToImages(pdfBuffer) {
  const tmpDir = os.tmpdir();
  const timestamp = Date.now();
  const outPrefix = `output_${timestamp}`;
  const savePath = `${tmpDir}/${outPrefix}`;

  if (!fs.existsSync(savePath)) fs.mkdirSync(savePath, { recursive: true });

  const options = {
    density: 150,
    saveFilename: "page",
    savePath,
    format: "jpg",
    width: 2000,
    height: 2000,
  };

  const convert = fromBuffer(pdfBuffer, options);

  // Convert page by page
  const base64Images = [];
  let page = 1;

  while (true) {
    try {
      const result = await convert(page, { responseType: "base64" });
      if (!result || !result.base64) break;

      base64Images.push(result.base64);
      page++;
    } catch (err) {
      // No more pages or error
      break;
    }
  }

  // Cleanup files
  try {
    if (fs.existsSync(savePath)) {
      fs.readdirSync(savePath).forEach((f) =>
        fs.unlinkSync(`${savePath}/${f}`)
      );
      fs.rmdirSync(savePath);
    }
  } catch {}

  if (base64Images.length === 0) {
    console.warn("No images were generated from the PDF.");
  }

  return base64Images;
}
