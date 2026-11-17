import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { AssignmentPdfMaterial, AssignmentPdfQuestion } from "./assignment-pdf.ts";
import { pdfPlainText } from "./assignment-pdf.ts";
import { PdfMathText, type RichBlock } from "./pdf-math-text.ts";

const WIDTH = 595.28;
const HEIGHT = 841.89;
const MARGIN = 36;
const GAP = 26;
const COLUMN = (WIDTH - 2 * MARGIN - GAP) / 2;
const BOTTOM = 54;
const INK = rgb(.08, .15, .13);
const MUTED = rgb(.35, .41, .39);
const RULE = rgb(.79, .82, .80);
const GREEN = rgb(.10, .31, .26);

type ChoiceRow = { cells: { label: string; block: RichBlock }[]; height: number };
type QuestionBlock = { question: AssignmentPdfQuestion; prompt: RichBlock; rows: ChoiceRow[]; height: number };

async function questionBlock(text: PdfMathText, question: AssignmentPdfQuestion, width: number): Promise<QuestionBlock> {
  const bodyWidth = width - 17;
  const prompt = await text.layout(question.prompt, bodyWidth, 10.5);
  const cellWidth = (bodyWidth - 12) / 2;
  const options = await Promise.all((question.options ?? []).map(async (option) => ({ label: option.id, block: await text.layout(option.text, cellWidth - 16, 10.2) })));
  // Use a 2x2 choice grid only when all choices fit comfortably. Long choices
  // get the full column width, with their label aligned to the first baseline.
  const grid = options.length === 4 && options.every((option) => option.block.lines.length === 1);
  const rows: ChoiceRow[] = [];
  if (grid) {
    for (let i = 0; i < options.length; i += 2) {
      const cells = options.slice(i, i + 2);
      rows.push({ cells, height: Math.max(...cells.map((cell) => cell.block.height)) + 4 });
    }
  } else {
    for (const option of question.options ?? []) {
      const block = await text.layout(option.text, bodyWidth - 16, 10.2);
      rows.push({ cells: [{ label: option.id, block }], height: block.height + 4 });
    }
  }
  return { question, prompt, rows, height: prompt.height + 6 + rows.reduce((sum, row) => sum + row.height, 0) + (rows.length ? 15 : 42) };
}

function drawQuestion(page: PDFPage, block: QuestionBlock, text: PdfMathText, bold: PDFFont, x: number, top: number, width = COLUMN) {
  page.drawText(`${block.question.position}.`, { x, y: top - 9, font: bold, size: 10, color: INK });
  text.draw(page, block.prompt, x + 17, top, width - 17, true);
  let y = top - block.prompt.height - 6;
  for (const row of block.rows) {
    row.cells.forEach((cell, i) => {
      const left = x + 17 + i * ((width - 17 + 12) / 2);
      page.drawText(`${cell.label}.`, { x: left, y: y - cell.block.lines[0].ascent, font: bold, size: 9.5, color: INK });
      text.draw(page, cell.block, left + 16, y, row.cells.length === 2 ? (width - 29) / 2 - 16 : width - 33);
    });
    y -= row.height;
  }
  if (!block.rows.length) page.drawLine({ start: { x: x + 17, y: y - 20 }, end: { x: x + width, y: y - 20 }, thickness: .5, color: RULE });
}

// Choose a contiguous prefix that fits both columns, then balance their height.
// Reading order is down the left column, then down the right column.
function columns(blocks: QuestionBlock[], available: number) {
  let best = { count: 0, split: 0, height: Infinity };
  let total = 0;
  for (let count = 1; count <= blocks.length; count++) {
    total += blocks[count - 1].height;
    if (total > available * 2) break;
    let left = 0;
    for (let split = 1; split <= count; split++) {
      left += blocks[split - 1].height;
      const height = Math.max(left, total - left);
      if (height <= available && (count > best.count || height < best.height)) best = { count, split, height };
    }
  }
  return best;
}

export async function buildMixedTestPaperPdf(material: AssignmentPdfMaterial, includeKey = false) {
  if (!material.questions.length) throw new Error("The assignment has no questions to export.");
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.TimesRoman);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const serifBold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const small = await doc.embedFont(StandardFonts.Helvetica);
  const text = new PdfMathText(doc, regular);
  doc.setTitle(pdfPlainText(material.title));
  doc.setAuthor("Jaguar Math");
  doc.setSubject(includeKey ? "Personalized paper and private teacher key" : "Personalized student question paper");
  const identity = material.student;
  const label = identity ? `${identity.name}  |  ${identity.className}  |  ${identity.paper}` : material.title;
  const questions = [...material.questions].sort((a, b) => a.position - b.position);
  const blocks: QuestionBlock[] = [];
  for (const question of questions) blocks.push(await questionBlock(text, question, COLUMN));
  const write = (page: PDFPage, value: string, x: number, y: number, size: number, font = small, color = INK) => {
    const clean = pdfPlainText(value);
    page.drawText(clean, { x, y, font, size, color });
  };
  const writeWrapped = async (page: PDFPage, value: string, top: number, size: number) => {
    const block = await text.layout(value, WIDTH - MARGIN * 2, size);
    text.draw(page, block, MARGIN, top, WIDTH - MARGIN * 2);
    return top - block.height;
  };
  const header = async (first: boolean, key = false) => {
    const page = doc.addPage([WIDTH, HEIGHT]);
    let top = HEIGHT - MARGIN;
    write(page, "JAGUAR MATH", MARGIN, top - 8, 8.5, bold, GREEN);
    const tag = key ? "PRIVATE TEACHER KEY" : "MIXED TEST";
    write(page, tag, WIDTH - MARGIN - bold.widthOfTextAtSize(tag, 8), top - 8, 8, bold, MUTED);
    top -= 22;
    if (first || key) {
      // Wrap long titles instead of shrinking or letting them run off the page.
      const title = new PdfMathText(doc, serifBold);
      const titleBlock = await title.layout(material.title, WIDTH - 2 * MARGIN, 21);
      title.draw(page, titleBlock, MARGIN, top, WIDTH - 2 * MARGIN);
      top -= titleBlock.height + 6;
      const points = questions.reduce((sum, question) => sum + question.points, 0);
      top = await writeWrapped(page, `${questions.length} questions  |  ${points} points  |  Choose one answer (A-D) for each question.`, top, 9);
      top -= 8;
    }
    if (identity) {
      top = await writeWrapped(page, `${identity.name}  |  Class ${identity.className}`, top, first ? 11 : 9);
      top = await writeWrapped(page, `Student ID: ${identity.code}  |  ${identity.paper}`, top, 9);
      top -= 5;
    } else top = await writeWrapped(page, "Name: _________________________________    Class: __________    Date: __________", top, 9);
    if (first && !key) {
      top = await writeWrapped(page, "Shade answers on your matching named answer sheet. Use this paper for working.", top, 8.5);
      top -= 4;
    }
    page.drawLine({ start: { x: MARGIN, y: top - 4 }, end: { x: WIDTH - MARGIN, y: top - 4 }, thickness: .8, color: GREEN });
    return { page, top: top - 18 };
  };

  let index = 0;
  while (index < blocks.length) {
    const { page, top } = await header(index === 0);
    const available = top - BOTTOM;
    const fit = columns(blocks.slice(index), available);
    if (!fit.count) {
      // Exceptionally long items use the full page width. If even that cannot
      // fit, continue at a measured line boundary with a repeated question ID.
      const wide = await questionBlock(text, blocks[index].question, WIDTH - 2 * MARGIN);
      if (wide.height <= available) drawQuestion(page, wide, text, bold, MARGIN, top, WIDTH - 2 * MARGIN);
      else {
        let currentPage = page, y = top;
        write(currentPage, `${wide.question.position}.`, MARGIN, y - 9, 10, bold);
        const entries = [wide.prompt, ...await Promise.all((wide.question.options ?? []).map((option) => text.layout(option.text, WIDTH - 2 * MARGIN - 34, 10.2)))];
        for (const [entryIndex, entry] of entries.entries()) {
          if (entryIndex > 0) {
            if (y - 30 < BOTTOM) { const next = await header(false); currentPage = next.page; y = next.top; }
            write(currentPage, `${wide.question.options![entryIndex - 1].id}.`, MARGIN + 17, y - 9, 9.5, bold);
          }
          for (const line of entry.lines) {
            if (y - line.height < BOTTOM) {
              const next = await header(false); currentPage = next.page; y = next.top;
              write(currentPage, `Question ${wide.question.position} (continued)`, MARGIN, y - 9, 9, bold); y -= 22;
            }
            const indent = entryIndex ? 34 : 17;
            text.draw(currentPage, { lines: [line], height: line.height, width: line.width }, MARGIN + indent, y, WIDTH - 2 * MARGIN - indent);
            y -= line.height;
          }
          y -= 8;
        }
      }
      index++;
      continue;
    }
    const pageBlocks = blocks.slice(index, index + fit.count);
    [pageBlocks.slice(0, fit.split), pageBlocks.slice(fit.split)].forEach((column, columnIndex) => {
      let y = top;
      const x = MARGIN + columnIndex * (COLUMN + GAP);
      for (const block of column) { drawQuestion(page, block, text, bold, x, y); y -= block.height; }
    });
    if (fit.split < fit.count) page.drawLine({ start: { x: WIDTH / 2, y: top }, end: { x: WIDTH / 2, y: BOTTOM }, thickness: .4, color: RULE });
    index += fit.count;
  }

  const questionPageCount = doc.getPageCount();
  if (includeKey) {
    let current = await header(true, true);
    for (const question of questions) {
      const option = question.options?.find((item) => item.id === question.correctAnswer);
      const answer = await text.layout(`${question.position}.  ${option ? `${option.id}.  ${option.text}` : question.correctAnswer}`, WIDTH - 2 * MARGIN, 11);
      const explanation = question.explanation ? await text.layout(question.explanation, WIDTH - 2 * MARGIN - 17, 10) : null;
      for (const [blockIndex, block] of [answer, explanation].entries()) {
        if (!block) continue;
        for (const line of block.lines) {
          if (current.top - line.height < BOTTOM) current = await header(false, true);
          text.draw(current.page, { lines: [line], height: line.height, width: line.width }, MARGIN + (blockIndex ? 17 : 0), current.top, WIDTH - 2 * MARGIN - 17);
          current.top -= line.height;
        }
      }
      current.top -= 12;
    }
  }
  doc.getPages().forEach((page, i) => {
    const key = i >= questionPageCount;
    page.drawLine({ start: { x: MARGIN, y: 39 }, end: { x: WIDTH - MARGIN, y: 39 }, thickness: .4, color: RULE });
    const footer = pdfPlainText(label);
    const size = Math.min(7, 420 / Math.max(small.widthOfTextAtSize(footer, 1), 1));
    write(page, footer, MARGIN, 26, size, small, MUTED);
    const pageLabel = `${key ? "Key" : "Paper"} ${key ? i - questionPageCount + 1 : i + 1} / ${key ? doc.getPageCount() - questionPageCount : questionPageCount}`;
    write(page, pageLabel, WIDTH - MARGIN - small.widthOfTextAtSize(pageLabel, 7), 26, 7, small, MUTED);
  });
  return doc.save();
}
