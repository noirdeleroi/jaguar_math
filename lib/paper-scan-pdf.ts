import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import QRCode from "qrcode";
import {
  bubblePosition,
  CHOICES,
  MARKERS,
  pageQuestions,
  QR,
  qrPayload,
  QUESTIONS_PER_PAGE,
  scanPaperLabel,
  SHEET_HEIGHT,
  SHEET_WIDTH,
  type ScanSheet,
} from "./paper-scan-layout.ts";

export async function buildScanSheetsPdf(title: string, sheets: ScanSheet[]) {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const safe = (s: string) =>
    s.normalize("NFKD").replace(/[^\x20-\x7e\xa0-\xff]/g, "");
  doc.setTitle(safe(`${title} - personalized answer sheets`));
  for (const sheet of sheets) {
    const count = Math.ceil(sheet.questions.length / QUESTIONS_PER_PAGE);
    for (let pageNumber = 1; pageNumber <= count; pageNumber++) {
      const page = doc.addPage([SHEET_WIDTH, SHEET_HEIGHT]);
      const text = (
        value: string,
        x: number,
        y: number,
        size = 10,
        strong = false,
        maxWidth = 480,
      ) => {
        const font = strong ? bold : regular;
        let label = safe(value);
        while (
          font.widthOfTextAtSize(label, size) > maxWidth &&
          label.length > 1
        )
          label = label.slice(0, -1);
        page.drawText(label, {
          x,
          y: SHEET_HEIGHT - y,
          size,
          font,
          color: rgb(0.07, 0.13, 0.11),
        });
      };
      for (const marker of MARKERS)
        page.drawRectangle({
          x: marker.x - 6,
          y: SHEET_HEIGHT - marker.y - 6,
          width: 12,
          height: 12,
          color: rgb(0, 0, 0),
        });
      text("JAGUAR MATH  /  MIXED TEST", 55, 60, 10, true);
      text(title, 55, 87, 17, true, 365);
      text(sheet.studentName, 55, 116, 14, true, 365);
      text(
        `Class: ${sheet.className}    Student ID: ${sheet.studentCode}`,
        55,
        138,
        10,
        false,
        365,
      );
      text(
        `${scanPaperLabel(sheet)}  -  Use your named question paper`,
        55,
        159,
        10,
        true,
        365,
      );
      text(
        `Page ${pageNumber} of ${count}  |  ${sheet.questions.length} questions total`,
        55,
        178,
      );
      const qr = QRCode.create(qrPayload(sheet.token, pageNumber), {
        version: 4,
        errorCorrectionLevel: "H",
      });
      const unit = QR.size / (QR.modules + 2 * QR.quiet);
      for (let row = 0; row < qr.modules.size; row++)
        for (let col = 0; col < qr.modules.size; col++)
          if (qr.modules.get(row, col)) {
            page.drawRectangle({
              x: QR.x + (col + QR.quiet) * unit,
              y: SHEET_HEIGHT - QR.y - (row + QR.quiet + 1) * unit,
              width: unit + 0.02,
              height: unit + 0.02,
              color: rgb(0, 0, 0),
            });
          }
      text(
        "Shade ONE circle fully with dark pencil or black/blue pen. Erase changes completely.",
        55,
        203,
        9,
      );
      text(
        "Keep all four black squares and the QR code visible. Print at 100%, single-sided.",
        55,
        217,
        9,
      );
      const questions = pageQuestions(sheet.questions, pageNumber);
      for (let i = 0; i < questions.length; i++) {
        const base = bubblePosition(i, 0);
        text(
          String(questions[i].position).padStart(3, " "),
          base.x - 43,
          base.y + 3,
          10,
          true,
        );
        for (let c = 0; c < 4; c++) {
          const point = bubblePosition(i, c);
          // Pale blue ink stays outside the measured interior. Works in grayscale.
          page.drawCircle({
            x: point.x,
            y: SHEET_HEIGHT - point.y,
            size: 6.2,
            borderWidth: 0.8,
            borderColor: rgb(0.28, 0.47, 0.58),
          });
          text(CHOICES[c], point.x + 10, point.y + 3, 8);
        }
      }
      text(`Sheet ${sheet.id}  |  Template JM1`, 55, 784, 8);
      text(
        "Do not fold, crop, or write in the answer grid except to shade your choices.",
        55,
        798,
        8,
      );
    }
  }
  return doc.save();
}
