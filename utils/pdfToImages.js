import fs from "fs";
import os from "os";
import { fromBuffer } from "pdf2pic";
import { randomUUID } from "crypto";

export async function convertPdfToImages(pdfBuffer) {
  const tmpDir = os.tmpdir();
  const savePath = `${tmpDir}/pdf2pic_${Date.now()}_${randomUUID()}`;

  fs.mkdirSync(savePath, { recursive: true });

  const options = {
    density: 120,
    saveFilename: "page",
    savePath,
    format: "jpg",
    width: 1200,
    height: 1200,
  };

  try {
    const converter = fromBuffer(pdfBuffer, options);

    const results = await converter.bulk(-1, { responseType: "base64" });

    const base64Images = results
      .filter((r) => r && r.base64)
      .map((r) => r.base64);

    if (!base64Images.length)
      throw new Error("PDF conversion returned no images");

    return base64Images;
  } catch (err) {
    console.error("PDF conversion failed:", err);
    throw err;
  } finally {
    // Cleanup safely
    try {
      if (fs.existsSync(savePath))
        fs.rmSync(savePath, { recursive: true, force: true });
    } catch (cleanupErr) {
      console.warn("Cleanup warning:", cleanupErr.message);
    }
  }
}
