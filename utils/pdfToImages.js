import fs from "fs";
import os from "os";
import { fromBuffer } from "pdf2pic";

export async function convertPdfToImages(pdfBuffer) {
  const tmpDir = os.tmpdir();
  const timestamp = Date.now();

  const savePath = `${tmpDir}/pdf2pic_${timestamp}`;
  if (!fs.existsSync(savePath)) {
    fs.mkdirSync(savePath, { recursive: true });
  }

  const options = {
    density: 150,
    saveFilename: "page",
    savePath,
    format: "jpg",
    width: 2000,
    height: 2000,
  };

  try {
    const converter = fromBuffer(pdfBuffer, options);

    const results = await converter.bulk(-1, { responseType: "base64" });

    const base64Images = results.map((r) => r.base64);

    // Cleanup
    try {
      const files = fs.readdirSync(savePath);
      for (const file of files) {
        fs.unlinkSync(`${savePath}/${file}`);
      }
      fs.rmdirSync(savePath);
    } catch (cleanupErr) {
      console.warn("Cleanup warning:", cleanupErr.message);
    }

    return base64Images;
  } catch (err) {
    console.error("PDF conversion failed:", err);

    // Always cleanup even on failure
    try {
      if (fs.existsSync(savePath)) {
        const files = fs.readdirSync(savePath);
        for (const file of files) {
          fs.unlinkSync(`${savePath}/${file}`);
        }
        fs.rmdirSync(savePath);
      }
    } catch {}

    throw err;
  }
}
