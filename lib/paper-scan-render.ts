import { createCanvas, DOMMatrix, ImageData, Path2D } from "@napi-rs/canvas";
import sharp from "sharp";
import { join } from "node:path";

// PDF.js runs only on our server. No PDF scripts, network resources or embedded
// attachments execute; only a bounded raster is passed to the OMR engine.
export async function renderScanPage(
  bytes: Buffer,
  pageNumber: number,
  mime: string,
) {
  if (mime !== "application/pdf") {
    if (pageNumber !== 1) throw new Error("Images have only one page.");
    const image = sharp(bytes, { limitInputPixels: 25_000_000 }).rotate();
    const metadata = await image.metadata();
    if (!["jpeg", "png"].includes(metadata.format ?? ""))
      throw new Error("Upload a PDF, PNG or JPEG scan.");
    return {
      bytes: await image
        .resize({
          width: 2200,
          height: 2600,
          fit: "inside",
          withoutEnlargement: true,
        })
        .flatten({ background: "white" })
        .png()
        .toBuffer(),
      pageCount: 1,
    };
  }
  Object.assign(globalThis, { DOMMatrix, ImageData, Path2D });
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // These local assets are explicitly traced into the serverless function.
  // A literal require.resolve is replaced with a module ID by Turbopack.
  const root = join(process.cwd(), "node_modules", "pdfjs-dist");
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: true,
    disableFontFace: true,
    stopAtErrors: true,
    maxImageSize: 25_000_000,
    wasmUrl: join(root, "wasm").replaceAll("\\", "/") + "/",
    standardFontDataUrl:
      join(root, "standard_fonts").replaceAll("\\", "/") + "/",
    cMapUrl: join(root, "cmaps").replaceAll("\\", "/") + "/",
  });
  try {
    const doc = await task.promise;
    if (doc.numPages > 200)
      throw new Error(
        "Each PDF must contain at most 200 pages. Split larger batches.",
      );
    if (pageNumber < 1 || pageNumber > doc.numPages)
      throw new Error("Page is outside the document.");
    const page = await doc.getPage(pageNumber);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({
      scale: Math.min(2.5, 2600 / Math.max(base.width, base.height)),
    });
    const canvas = createCanvas(
      Math.ceil(viewport.width),
      Math.ceil(viewport.height),
    );
    await page.render({
      canvas: canvas as unknown as HTMLCanvasElement,
      canvasContext: canvas.getContext(
        "2d",
      ) as unknown as CanvasRenderingContext2D,
      viewport,
    }).promise;
    return { bytes: await canvas.encode("png"), pageCount: doc.numPages };
  } finally {
    await task.destroy();
  }
}
