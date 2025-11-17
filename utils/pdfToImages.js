import fs from "fs";
import os from "os";
import pdf from "pdf-poppler";

export async function convertPdfToImages(pdfBuffer) {
  const tmpDir = os.tmpdir();
  const timestamp = Date.now();

  const tempPdfPath = `${tmpDir}/input_${timestamp}.pdf`;
  const outPrefix = `output_${timestamp}`;

  // 1. Write PDF buffer → temp file
  fs.writeFileSync(tempPdfPath, pdfBuffer);

  const options = {
    format: "jpeg",
    out_dir: tmpDir,
    out_prefix: outPrefix,
    page: null, // convert all pages
    poppler_path: "/usr/bin",
  };

  try {
    // 2. Convert PDF → Images
    await pdf.convert(tempPdfPath, options);

    // 3. Read all generated image files
    const allFiles = fs.readdirSync(tmpDir);
    const outputFiles = allFiles.filter(
      (f) => f.startsWith(outPrefix) && f.endsWith(".jpg")
    );

    const base64Images = outputFiles.map((filename) => {
      const filePath = `${tmpDir}/${filename}`;
      const data = fs.readFileSync(filePath).toString("base64");

      // delete image file
      fs.unlinkSync(filePath);

      return data;
    });

    // delete temp PDF file
    fs.unlinkSync(tempPdfPath);

    return base64Images;
  } catch (err) {
    console.error("PDF conversion failed:", err);
    throw err;
  }
}
