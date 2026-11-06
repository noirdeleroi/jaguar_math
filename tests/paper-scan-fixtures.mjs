import { randomUUID } from "node:crypto";
import { PDFDocument, rgb } from "pdf-lib";
import { buildScanSheetsPdf } from "../lib/paper-scan-pdf.ts";
import {
  bubblePosition,
  QUESTIONS_PER_PAGE,
  SHEET_HEIGHT,
} from "../lib/paper-scan-layout.ts";
import { renderScanPage } from "../lib/paper-scan-render.ts";
import sharp from "sharp";

export function fixtureSheet(count = 12, overrides = {}) {
  return {
    id: randomUUID(),
    token: randomUUID().replaceAll("-", ""),
    studentId: randomUUID(),
    studentName: "Sample Student - Sofia Garcia",
    studentCode: "11001",
    classId: randomUUID(),
    className: "11A",
    version: 1,
    questions: Array.from({ length: count }, (_, i) => ({
      position: i + 1,
      questionId: randomUUID(),
      points: 1,
      options: ["A", "B", "C", "D"],
    })),
    ...overrides,
  };
}
// These are synthetic marks on the same PDF the teacher downloads, not physical
// scanner validation. Rasterization and distortion happen after marks are drawn.
export async function filledPdf(
  sheets,
  answers = (index) => index % 4,
  variants = {},
) {
  const doc = await PDFDocument.load(
    await buildScanSheetsPdf("Algebra - scan validation", sheets),
  );
  let pageIndex = 0;
  for (const sheet of sheets)
    for (
      let p = 0;
      p < Math.ceil(sheet.questions.length / QUESTIONS_PER_PAGE);
      p++
    ) {
      const page = doc.getPage(pageIndex++);
      for (
        let i = 0;
        i <
        Math.min(
          QUESTIONS_PER_PAGE,
          sheet.questions.length - p * QUESTIONS_PER_PAGE,
        );
        i++
      ) {
        const questionIndex = p * QUESTIONS_PER_PAGE + i;
        const answer = answers(questionIndex, sheet);
        if (answer === null) continue;
        for (const c of Array.isArray(answer) ? answer : [answer]) {
          const pos = bubblePosition(i, c);
          const variant = variants[questionIndex];
          if (variant === "cross") {
            page.drawLine({
              start: { x: pos.x - 10, y: SHEET_HEIGHT - pos.y - 10 },
              end: { x: pos.x + 10, y: SHEET_HEIGHT - pos.y + 10 },
              thickness: 2,
              color: rgb(0, 0, 0),
            });
            page.drawLine({
              start: { x: pos.x - 10, y: SHEET_HEIGHT - pos.y + 10 },
              end: { x: pos.x + 10, y: SHEET_HEIGHT - pos.y - 10 },
              thickness: 2,
              color: rgb(0, 0, 0),
            });
          } else
            page.drawCircle({
              x: pos.x,
              y: SHEET_HEIGHT - pos.y,
              size: 5.6,
              color:
                variant === "faint"
                  ? rgb(0.7, 0.7, 0.7)
                  : rgb(0.07, 0.07, 0.07),
            });
          if (variant === "filled-cross") page.drawLine({ start: { x: pos.x - 12, y: SHEET_HEIGHT - pos.y }, end: { x: pos.x + 12, y: SHEET_HEIGHT - pos.y }, thickness: 1.2, color: rgb(0,0,0) });
        }
      }
    }
  return Buffer.from(await doc.save());
}

export async function rasterizePdf(bytes) {
  const source = await PDFDocument.load(bytes);
  const doc = await PDFDocument.create();
  for (let n = 1; n <= source.getPageCount(); n++) {
    const image = await renderScanPage(bytes, n, "application/pdf");
    const jpeg = await sharp(image.bytes)
      .grayscale()
      .blur(0.35)
      .jpeg({ quality: 78 })
      .toBuffer();
    const embedded = await doc.embedJpg(jpeg);
    const page = doc.addPage([595.28, 841.89]);
    page.drawImage(embedded, { x: 0, y: 0, width: 595.28, height: 841.89 });
  }
  return Buffer.from(await doc.save());
}
