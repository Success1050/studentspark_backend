import { fromBuffer } from "pdf2pic";

export async function convertPdfToImages(pdfBuffer) {
  const options = {
    density: 150,
    format: "jpeg",
    quality: 80,
  };

  const converter = fromBuffer(pdfBuffer, options);

  const pages = await converter.bulk(-1); // convert all pages

  const base64Images = pages.map((page) => {
    return page.base64; // already base64
  });

  return base64Images;
}
