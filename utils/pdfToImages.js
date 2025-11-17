import fs from "fs";
import os from "os";
import { fromBuffer } from "pdf2pic";

export async function convertPdfToImages(pdfBuffer) {
  const tmpDir = os.tmpdir();
  const timestamp = Date.now();
  const outPrefix = `output_${timestamp}`;
  const savePath = `${tmpDir}/${outPrefix}`;

  // Create output directory
  if (!fs.existsSync(savePath)) {
    fs.mkdirSync(savePath, { recursive: true });
  }

  const options = {
    density: 100, // DPI (higher = better quality but larger files)
    saveFilename: "page", // prefix for output files
    savePath: savePath, // directory to save images
    format: "jpg", // output format
    width: 2000, // optional: max width
    height: 2000, // optional: max height
  };

  try {
    // 1. Convert PDF buffer to images
    const convert = fromBuffer(pdfBuffer, options);

    // 2. Get PDF info to know how many pages
    const storeAsImage = convert.bulk(-1, { responseType: "base64" });
    const results = await storeAsImage;

    // 3. Extract base64 data from results
    const base64Images = results.map((result) => {
      return result.base64;
    });

    // 4. Cleanup: Delete generated files
    try {
      const files = fs.readdirSync(savePath);
      files.forEach((file) => {
        fs.unlinkSync(`${savePath}/${file}`);
      });
      fs.rmdirSync(savePath);
    } catch (cleanupErr) {
      console.warn("Cleanup warning:", cleanupErr.message);
    }

    return base64Images;
  } catch (err) {
    console.error("PDF conversion failed:", err);

    // Cleanup on error
    try {
      if (fs.existsSync(savePath)) {
        const files = fs.readdirSync(savePath);
        files.forEach((file) => {
          fs.unlinkSync(`${savePath}/${file}`);
        });
        fs.rmdirSync(savePath);
      }
    } catch (cleanupErr) {
      console.warn("Cleanup error:", cleanupErr.message);
    }

    throw err;
  }
}
