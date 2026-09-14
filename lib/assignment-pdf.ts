import { PDFDocument, StandardFonts, type PDFFont, type PDFPage, rgb } from "pdf-lib";

export type AssignmentPdfOption = { id: string; text: string };
export type AssignmentPdfQuestion = {
  position: number;
  variantIndex: number;
  prompt: string;
  type: string;
  options: AssignmentPdfOption[] | null;
  points: number;
  correctAnswer: string;
  numericTolerance: number;
  explanation: string | null;
};
export type AssignmentPdfMaterial = {
  title: string;
  description: string | null;
  kind: string;
  dueAt: string | null;
  questions: AssignmentPdfQuestion[];
};

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 52;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const COLORS = {
  ink: rgb(0.09, 0.2, 0.17),
  green: rgb(0.08, 0.28, 0.23),
  muted: rgb(0.34, 0.45, 0.41),
  coral: rgb(0.73, 0.27, 0.19),
  rule: rgb(0.82, 0.79, 0.73),
};

const LATEX_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\\left|\\right/g, ""],
  [/\\times|\\cdot/g, " x "],
  [/\\div/g, " / "],
  [/\\approx/g, " ~= "],
  [/\\leq?|≤/g, " <= "],
  [/\\geq?|≥/g, " >= "],
  [/\\neq?|≠/g, " != "],
  [/\\pm|±/g, " +/- "],
  [/\\infty|∞/g, "infinity"],
  [/\\pi|π/g, "pi"],
  [/\\theta|θ/g, "theta"],
  [/\\degree|°/g, " degrees"],
  [/\\%/g, "%"],
  [/\\,/g, " "],
  [/[−–—]/g, "-"],
  [/[“”]/g, '"'],
  [/[‘’]/g, "'"],
  [/[→⇒]/g, "->"],
  [/×/g, "x"],
  [/÷/g, "/"],
  [/√/g, "sqrt"],
];

export function pdfPlainText(value: string) {
  let output = value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#(?:39|x27);/gi, "'");
  for (let index = 0; index < 4; index += 1) {
    output = output
      .replace(/\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g, "($1)/($2)")
      .replace(/\\sqrt\s*\{([^{}]+)\}/g, "sqrt($1)")
      .replace(/\\(?:text|mathrm|mathbf|operatorname)\s*\{([^{}]+)\}/g, "$1")
      .replace(/\^\s*\{([^{}]+)\}/g, "^($1)")
      .replace(/_\s*\{([^{}]+)\}/g, "_($1)");
  }
  for (const [pattern, replacement] of LATEX_REPLACEMENTS) output = output.replace(pattern, replacement);
  return output
    .replace(/\$/g, "")
    .replace(/\\[a-zA-Z]+/g, "")
    .replace(/[{}]/g, "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "?")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
}

export function assignmentPdfFilename(title: string) {
  const stem = pdfPlainText(title).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/\s+/g, "_").replace(/^[_.]+|[_.]+$/g, "").slice(0, 80) || "assignment";
  return `${stem}_questions_and_answers.pdf`;
}

function wrapLine(text: string, font: PDFFont, size: number, width: number) {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [""];
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= width) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    if (font.widthOfTextAtSize(word, size) <= width) {
      line = word;
      continue;
    }
    let fragment = "";
    for (const character of word) {
      const next = `${fragment}${character}`;
      if (fragment && font.widthOfTextAtSize(next, size) > width) {
        lines.push(fragment);
        fragment = character;
      } else fragment = next;
    }
    line = fragment;
  }
  if (line) lines.push(line);
  return lines;
}

function wrappedLines(text: string, font: PDFFont, size: number, width: number) {
  return pdfPlainText(text).split("\n").flatMap((line) => wrapLine(line, font, size, width));
}

function formsFor(questions: AssignmentPdfQuestion[]) {
  const sorted = [...questions].sort((left, right) => left.position - right.position || left.variantIndex - right.variantIndex);
  const maximumVersion = Math.max(1, ...sorted.map((question) => question.variantIndex));
  return Array.from({ length: maximumVersion }, (_, index) => {
    const version = index + 1;
    const byPosition = new Map<number, AssignmentPdfQuestion>();
    for (const question of sorted) if (question.variantIndex === 1 || question.variantIndex === version) byPosition.set(question.position, question);
    return { version, questions: [...byPosition.values()].sort((left, right) => left.position - right.position) };
  });
}

class PdfLayout {
  readonly document: PDFDocument;
  readonly regular: PDFFont;
  readonly bold: PDFFont;
  page!: PDFPage;
  y = 0;
  pageNumber = 0;
  runningTitle = "";

  constructor(document: PDFDocument, regular: PDFFont, bold: PDFFont) {
    this.document = document;
    this.regular = regular;
    this.bold = bold;
  }

  newPage() {
    this.page = this.document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this.pageNumber += 1;
    this.y = PAGE_HEIGHT - MARGIN;
    if (this.pageNumber > 1) {
      this.page.drawText(this.runningTitle, { x: MARGIN, y: PAGE_HEIGHT - 32, size: 8, font: this.bold, color: COLORS.muted, maxWidth: CONTENT_WIDTH - 60 });
      this.page.drawLine({ start: { x: MARGIN, y: PAGE_HEIGHT - 40 }, end: { x: PAGE_WIDTH - MARGIN, y: PAGE_HEIGHT - 40 }, thickness: 0.7, color: COLORS.rule });
      this.y = PAGE_HEIGHT - 58;
    }
  }

  ensure(height: number) {
    if (this.y - height < MARGIN + 20) this.newPage();
  }

  text(value: string, options: { font?: PDFFont; size?: number; lineHeight?: number; color?: ReturnType<typeof rgb>; indent?: number; gapAfter?: number } = {}) {
    const font = options.font ?? this.regular;
    const size = options.size ?? 10;
    const lineHeight = options.lineHeight ?? size * 1.38;
    const indent = options.indent ?? 0;
    const lines = wrappedLines(value, font, size, CONTENT_WIDTH - indent);
    for (const line of lines) {
      this.ensure(lineHeight);
      this.page.drawText(line, { x: MARGIN + indent, y: this.y - size, size, font, color: options.color ?? COLORS.ink });
      this.y -= lineHeight;
    }
    this.y -= options.gapAfter ?? 0;
  }

  rule(gap = 11) {
    this.ensure(gap * 2 + 1);
    this.y -= gap;
    this.page.drawLine({ start: { x: MARGIN, y: this.y }, end: { x: PAGE_WIDTH - MARGIN, y: this.y }, thickness: 0.6, color: COLORS.rule });
    this.y -= gap;
  }

  finishFooters() {
    const count = this.document.getPageCount();
    this.document.getPages().forEach((page, index) => {
      const label = `Jaguar Math  |  Questions and answers  |  ${index + 1} of ${count}`;
      page.drawText(label, { x: MARGIN, y: 24, size: 8, font: this.regular, color: COLORS.muted });
    });
  }
}

function dueLabel(dueAt: string | null) {
  if (!dueAt) return "No deadline";
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) return "No deadline";
  return `Due ${new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Bogota", timeZoneName: "short" }).format(due)}`;
}

function answerLabel(question: AssignmentPdfQuestion) {
  if (question.type !== "multiple_choice") return pdfPlainText(question.correctAnswer);
  const option = question.options?.find((item) => item.id === question.correctAnswer);
  return option ? `${option.id}. ${pdfPlainText(option.text)}` : pdfPlainText(question.correctAnswer);
}

function drawDocumentHeader(layout: PdfLayout, material: AssignmentPdfMaterial, version: number, versionCount: number) {
  layout.text("JAGUAR MATH", { font: layout.bold, size: 10, color: COLORS.coral, lineHeight: 13, gapAfter: 8 });
  layout.text(material.title, { font: layout.bold, size: 23, lineHeight: 28, color: COLORS.green, gapAfter: 5 });
  const versionLabel = versionCount > 1 ? `  |  Version ${String.fromCharCode(64 + version)}` : "";
  layout.text(`${material.kind.toUpperCase()}${versionLabel}  |  ${dueLabel(material.dueAt)}`, { font: layout.bold, size: 9, color: COLORS.muted, gapAfter: 10 });
  if (material.description) layout.text(material.description, { size: 10, color: COLORS.muted, gapAfter: 10 });
  layout.text("Name: ____________________________________    Date: ____________________", { size: 10, gapAfter: 5 });
  layout.rule(8);
}

function drawQuestion(layout: PdfLayout, question: AssignmentPdfQuestion) {
  layout.ensure(56);
  layout.text(`${question.position}.  ${question.points} ${question.points === 1 ? "point" : "points"}`, { font: layout.bold, size: 9, color: COLORS.coral, lineHeight: 12, gapAfter: 3 });
  layout.text(question.prompt, { size: 11, lineHeight: 15.5, gapAfter: 5 });
  if (question.options?.length) {
    for (const option of question.options) layout.text(`${option.id}.  ${option.text}`, { size: 10, lineHeight: 14, indent: 14, gapAfter: 2 });
  } else {
    layout.text("Answer: ______________________________________________", { size: 10, color: COLORS.muted, indent: 14, gapAfter: 7 });
  }
  layout.rule(7);
}

function drawAnswer(layout: PdfLayout, question: AssignmentPdfQuestion) {
  layout.ensure(46);
  layout.text(`${question.position}.  ${answerLabel(question)}${question.numericTolerance > 0 ? ` (tolerance +/- ${question.numericTolerance})` : ""}`, { font: layout.bold, size: 10.5, lineHeight: 15, color: COLORS.green, gapAfter: 3 });
  if (question.explanation) layout.text(question.explanation, { size: 9.5, lineHeight: 13.5, color: COLORS.muted, indent: 14, gapAfter: 7 });
  else layout.y -= 5;
}

export async function buildAssignmentAnswerKeyPdf(material: AssignmentPdfMaterial) {
  if (!material.questions.length) throw new Error("The assignment has no questions to export.");
  const document = await PDFDocument.create();
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  document.setTitle(pdfPlainText(material.title));
  document.setAuthor("Jaguar Math");
  document.setSubject("Assignment questions and answer key");
  document.setCreator("Jaguar Math");
  const layout = new PdfLayout(document, regular, bold);
  layout.runningTitle = pdfPlainText(material.title).slice(0, 70);
  const forms = formsFor(material.questions);

  for (const form of forms) {
    layout.newPage();
    drawDocumentHeader(layout, material, form.version, forms.length);
    for (const question of form.questions) drawQuestion(layout, question);
    layout.newPage();
    layout.text("ANSWER KEY", { font: bold, size: 10, color: COLORS.coral, lineHeight: 13, gapAfter: 8 });
    layout.text(`${material.title}${forms.length > 1 ? ` - Version ${String.fromCharCode(64 + form.version)}` : ""}`, { font: bold, size: 20, lineHeight: 25, color: COLORS.green, gapAfter: 5 });
    layout.text("Correct answers and teacher explanations", { size: 10, color: COLORS.muted, gapAfter: 10 });
    layout.rule(8);
    for (const question of form.questions) drawAnswer(layout, question);
  }
  layout.finishFooters();
  return document.save();
}
