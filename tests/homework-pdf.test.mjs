import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import { assignmentPdfFilename, buildAssignmentAnswerKeyPdf, pdfPlainText } from "../lib/assignment-pdf.ts";
import { homeworkPdfIsAvailable } from "../lib/homework-pdf-release.ts";

test("releases only homework PDFs whose teacher release and deadline have passed", () => {
  const now = Date.parse("2026-09-14T18:00:00.000Z");
  assert.equal(homeworkPdfIsAvailable({ kind: "homework", dueAt: "2026-09-14T17:59:00.000Z", releasedAt: "2026-09-13T18:00:00.000Z" }, now), true);
  assert.equal(homeworkPdfIsAvailable({ kind: "homework", dueAt: "2026-09-14T18:01:00.000Z", releasedAt: "2026-09-13T18:00:00.000Z" }, now), false);
  assert.equal(homeworkPdfIsAvailable({ kind: "homework", dueAt: "2026-09-14T17:59:00.000Z", releasedAt: null }, now), false);
  assert.equal(homeworkPdfIsAvailable({ kind: "test", dueAt: "2026-09-14T17:59:00.000Z", releasedAt: "2026-09-13T18:00:00.000Z" }, now), false);
});

test("normalizes common math notation and creates a safe download name", () => {
  assert.equal(pdfPlainText("Evaluate $\\frac{2}{3}\\times 9 \\le 7$ — explain."), "Evaluate (2)/(3) x 9 <= 7 - explain.");
  assert.equal(assignmentPdfFilename("Álgebra / práctica #1"), "Algebra___practica_#1_questions_and_answers.pdf");
});

test("builds a multi-page questions-and-answers PDF with metadata", async () => {
  const questions = Array.from({ length: 18 }, (_, index) => ({
    position: index + 1,
    variantIndex: 1,
    prompt: `Calculate $\\frac{${index + 1}}{4}\\times 12$ and show your reasoning.`,
    type: index % 2 ? "numeric" : "multiple_choice",
    options: index % 2 ? null : [
      { id: "A", text: "3" }, { id: "B", text: "6" }, { id: "C", text: "9" }, { id: "D", text: "12" },
    ],
    points: 2,
    correctAnswer: index % 2 ? String((index + 1) * 3) : "D",
    numericTolerance: 0,
    explanation: `Multiply (${index + 1})/(4) by 12.`,
  }));
  const bytes = await buildAssignmentAnswerKeyPdf({ title: "Arithmetic practice", description: "Complete every question.", kind: "homework", dueAt: "2026-09-14T17:00:00.000Z", questions });
  assert.equal(Buffer.from(bytes.subarray(0, 5)).toString("ascii"), "%PDF-");
  const document = await PDFDocument.load(bytes);
  assert.ok(document.getPageCount() >= 4);
  assert.equal(document.getTitle(), "Arithmetic practice");
  assert.equal(document.getAuthor(), "Jaguar Math");
});
