import fs from "fs";
import path from "path";
import os from "os";
import { promisify } from "util";
import pdfPoppler from "pdf-poppler";

const unlink = promisify(fs.unlink);

export async function convertPdfToImages(pdfBuffer) {
  const tmpDir = os.tmpdir(); // Cross-platform temp directory
  const timestamp = Date.now();

  const tempInput = path.join(tmpDir, `input_${timestamp}.pdf`);
  const tempOutputPrefix = `output_${timestamp}`;

  // Save buffer → temp file
  fs.writeFileSync(tempInput, pdfBuffer);

  const options = {
    format: "jpeg",
    out_dir: tmpDir,
    out_prefix: tempOutputPrefix,
    page: null, // all pages
  };

  // Convert PDF → images
  await pdfPoppler.convert(tempInput, options);

  // Read all generated JPEG files
  const files = fs
    .readdirSync(tmpDir)
    .filter(
      (file) => file.startsWith(tempOutputPrefix) && file.endsWith(".jpg")
    );

  // Convert each image → base64
  const base64Images = files.map((file) => {
    const imgPath = path.join(tmpDir, file);
    const data = fs.readFileSync(imgPath).toString("base64");

    // Cleanup each file
    unlink(imgPath).catch(() => {});

    return data;
  });

  // Cleanup input PDF
  unlink(tempInput).catch(() => {});

  return base64Images;
}
