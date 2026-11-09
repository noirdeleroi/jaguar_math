import { PDFDocument } from "pdf-lib";
import {
  buildAssignmentAnswerKeyPdf,
  type AssignmentPdfMaterial,
} from "./assignment-pdf.ts";
import { buildScanSheetsPdf } from "./paper-scan-pdf.ts";
import {
  CHOICES,
  printedScanChoice,
  scanPaperLabel,
  type ScanSheet,
} from "./paper-scan-layout.ts";

export type PaperQuestion = {
  id: string;
  prompt: string;
  options: { id: string; text: string }[];
};
export type PaperKey = { correct_answer: string; explanation: string | null };

export function personalizedPaperMaterial(
  title: string,
  sheet: ScanSheet,
  questions: Map<string, PaperQuestion>,
  keys: Map<string, PaperKey> = new Map(),
): AssignmentPdfMaterial {
  return {
    title,
    kind: "Mixed Test",
    description: null,
    dueAt: null,
    student: {
      name: sheet.studentName,
      className: sheet.className,
      code: sheet.studentCode,
      paper: scanPaperLabel(sheet),
    },
    questions: sheet.questions.map((slot) => {
      const q = questions.get(slot.questionId);
      if (!q) throw new Error("An issued paper question is unavailable.");
      const order = slot.optionOrder ?? [...CHOICES];
      if (
        order.length !== 4 ||
        new Set(order).size !== 4 ||
        CHOICES.some((id) => !order.includes(id))
      )
        throw new Error("Invalid issued answer order.");
      const key = keys.get(q.id);
      return {
        position: slot.position,
        variantIndex: 1,
        type: "multiple_choice",
        prompt: q.prompt,
        points: slot.points,
        options: order.map((id, index) => {
          const option = q.options.find((o) => o.id === id);
          if (!option) throw new Error("An issued option is unavailable.");
          return { id: CHOICES[index], text: option.text };
        }),
        correctAnswer: key ? printedScanChoice(slot, key.correct_answer) : "",
        explanation: key?.explanation ?? null,
        numericTolerance: 0,
      };
    }),
  };
}

export async function buildPersonalizedPapersPdf(
  title: string,
  sheets: ScanSheet[],
  questions: Map<string, PaperQuestion>,
  kind: "questions" | "packet" | "key" = "packet",
  keys: Map<string, PaperKey> = new Map(),
) {
  const doc = await PDFDocument.create();
  doc.setTitle(
    `${title} - ${kind === "key" ? "Private teacher keys" : "Personalized student papers"}`,
  );
  doc.setAuthor("Jaguar Math");
  const append = async (bytes: Uint8Array) => {
    const source = await PDFDocument.load(bytes);
    for (const page of await doc.copyPages(source, source.getPageIndices()))
      doc.addPage(page);
  };
  for (const sheet of sheets) {
    const material = personalizedPaperMaterial(
      title,
      sheet,
      questions,
      kind === "key" ? keys : undefined,
    );
    await append(
      await buildAssignmentAnswerKeyPdf(material, {
        questionsOnly: kind !== "key",
      }),
    );
    // Keep each student's question pages immediately followed by their QR sheet.
    if (kind === "packet")
      await append(await buildScanSheetsPdf(title, [sheet]));
  }
  return doc.save();
}
