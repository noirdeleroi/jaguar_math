import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { personalizedPaperMaterial, type PaperQuestion, type PaperKey } from "./paper-scan-papers.ts";
import { buildMixedTestPaperPdf } from "./mixed-test-pdf.ts";
import { PdfMathText } from "./pdf-math-text.ts";
import { pdfPlainText } from "./assignment-pdf.ts";
import { scanPaperLabel, type ScanSheet } from "./paper-scan-layout.ts";
import { feedbackScore, type FeedbackRow } from "./mixed-feedback.ts";

export type FeedbackPacket = {
  title: string; sheet: ScanSheet; rows: FeedbackRow[];
  questions: Map<string, PaperQuestion>; keys: Map<string, PaperKey>;
  scans: Uint8Array[];
};

export async function buildFeedbackPdf(packet: FeedbackPacket) {
  if (packet.scans.length !== Math.ceil(packet.sheet.questions.length / 60))
    throw new Error("Every marked answer page must be included in the feedback.");
  const doc = await PDFDocument.create();
  doc.setTitle(`${packet.title} - Personal feedback`); doc.setAuthor("Jaguar Math");
  const regular = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const rich = new PdfMathText(doc, regular);
  const W = 595.28, H = 841.89, M = 42, content = W - 2 * M;
  const ink = rgb(.09, .2, .17), green = rgb(.11, .35, .29), muted = rgb(.35, .45, .40), coral = rgb(.65, .23, .16);
  let page = doc.addPage([W, H]), y = H - M;
  const write = (value: string, x: number, top: number, size = 11, strong = false, color = ink) =>
    page.drawText(pdfPlainText(value), { x, y: top - size, size, font: strong ? bold : regular, color });
  const paragraph = async (value: string, size = 11, gap = 12) => {
    const block = await rich.layout(value, content, size);
    if (y - block.height < 65) { page = doc.addPage([W, H]); y = H - M; }
    rich.draw(page, block, M, y, content); y -= block.height + gap;
  };
  write("JAGUAR MATH  /  PERSONAL FEEDBACK", M, y, 10, true, green); y -= 35;
  await paragraph(packet.title, 25, 14);
  await paragraph(`${packet.sheet.studentName}  |  ${packet.sheet.className}`, 12, 5);
  write(`${scanPaperLabel(packet.sheet)}  |  Student ${packet.sheet.studentCode}`, M, y, 9, false, muted); y -= 35;
  const score = feedbackScore(packet.rows);
  page.drawRectangle({ x: M, y: y - 85, width: content, height: 85, color: rgb(.92, .95, .92) });
  write(`${score.outOfTen}/10`, M + 18, y - 13, 30, true, green);
  write(`${score.correct}/${score.total} questions correct`, M + 170, y - 22, 13, true);
  write(`${score.score}/${score.max} points`, M + 170, y - 45, 10, false, muted); y -= 105;
  const missed = packet.rows.filter(r => !r.isCorrect).map(r => r.position);
  await paragraph(missed.length ? `Focus your revision on questions ${missed.join(", ")}. Compare the answers below, then try those questions again using your question paper.`
    : "Excellent work - every answer is correct. Keep your paper as a revision resource.", 11, 16);
  const columns = [M + 10, M + 85, M + 215, M + 320, M + 430];
  const header = () => {
    page.drawRectangle({ x: M, y: y - 28, width: content, height: 28, color: green });
    ["Question", "Your answer", "Correct answer", "Result", "Points"].forEach((s, i) => write(s, columns[i], y - 8, 9, true, rgb(1, 1, 1)));
    y -= 28;
  };
  header();
  for (const [i, row] of packet.rows.entries()) {
    if (y < 105) { page = doc.addPage([W, H]); y = H - M; write("YOUR ANSWER CHECK / CONTINUED", M, y, 10, true, green); y -= 28; header(); }
    page.drawRectangle({ x: M, y: y - 26, width: content, height: 26, color: i % 2 ? rgb(.98, .97, .94) : rgb(1, 1, 1) });
    const values = [String(row.position), row.selected, row.correct, row.isCorrect ? "Correct" : "Review", `${row.points}/${row.maxPoints}`];
    values.forEach((s, j) => write(s, columns[j], y - 8, 10, j === 3, j === 3 ? row.isCorrect ? green : coral : ink)); y -= 26;
  }
  y -= 22;
  await paragraph("The following pages contain your own question paper and your scanned answer sheet. The answer check uses your final marked answers, including any teacher corrections.", 10, 10);
  await paragraph("If you think an answer was read incorrectly, ask Mr. Korshunov to review your scan.", 10);
  for (const p of doc.getPages()) p.drawText("Jaguar Math | Your personal test feedback", { x: M, y: 28, size: 8, font: regular, color: muted });
  const paper = await PDFDocument.load(await buildMixedTestPaperPdf(personalizedPaperMaterial(packet.title, packet.sheet, packet.questions)));
  for (const p of await doc.copyPages(paper, paper.getPageIndices())) doc.addPage(p);
  for (const [i, bytes] of packet.scans.entries()) {
    page = doc.addPage([W, H]);
    write(`YOUR SCANNED ANSWER SHEET${packet.scans.length > 1 ? ` / PAGE ${i + 1}` : ""}`, M, H - M, 11, true, green);
    const identity = await rich.layout(`${packet.sheet.studentName} | ${packet.sheet.className}`, content, 10);
    rich.draw(page, identity, M, H - M - 24, content);
    const image = await doc.embedPng(bytes);
    const availableHeight = H - 2 * M - 55 - identity.height;
    const scale = Math.min(content / image.width, availableHeight / image.height);
    const width = image.width * scale, height = image.height * scale;
    page.drawImage(image, { x: (W - width) / 2, y: M + (availableHeight - height) / 2, width, height });
    write("Original scan - final marked answers are shown in your answer check.", M, 31, 8, false, muted);
  }
  return doc.save();
}
