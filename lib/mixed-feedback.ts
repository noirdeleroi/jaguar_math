import { CHOICES, printedScanChoice, type ScanSheet } from "./paper-scan-layout.ts";

export type FeedbackGrade = { id: string; status: string; score: number | null; max_score: number | null };
export type FeedbackPage = { sheet_page: number | null; status: string; image_path: string };
export type FeedbackResponse = { question_id: string; student_answer: string | null; is_correct: boolean | null; points_awarded: number | null };
export type FeedbackRow = { position: number; selected: string; correct: string; isCorrect: boolean; points: number; maxPoints: number };
export type FeedbackSummary = {
  graded: number; ready: string[]; sent: number; excluded: number;
  failed: number; processing: number; uncertain: number; gmailConnected: boolean;
  previewSheetId: string | null;
};

export function validFeedbackEmail(email: string | null | undefined): email is string {
  return Boolean(email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && !/[\r\n]/.test(email));
}

export function finalFeedbackGrade(questions: unknown[], pages: FeedbackPage[], grade: FeedbackGrade | undefined): grade is FeedbackGrade & { score: number; max_score: number } {
  const required = Math.ceil(questions.length / 60);
  const active = pages.filter(p => ["accepted", "review"].includes(p.status));
  return Boolean(questions.length && grade?.status === "submitted" && grade.score !== null &&
    Number.isFinite(Number(grade.score)) && Number(grade.score) >= 0 && Number(grade.max_score) > 0 &&
    active.length === required && active.every(p => p.status === "accepted" && p.image_path) &&
    Array.from({ length: required }, (_, i) => i + 1).every(n => active.some(p => p.sheet_page === n)));
}

export function feedbackRows(sheet: ScanSheet, grade: FeedbackGrade, responses: FeedbackResponse[], keys: Map<string, { correct_answer: string }>): FeedbackRow[] {
  if (responses.length !== sheet.questions.length || new Set(responses.map(r => r.question_id)).size !== responses.length)
    throw new Error("The marked answers are incomplete. Review this paper first.");
  const byQuestion = new Map(responses.map(r => [r.question_id, r]));
  const rows = sheet.questions.map(slot => {
    const response = byQuestion.get(slot.questionId), key = keys.get(slot.questionId);
    const order = slot.optionOrder ?? [...CHOICES];
    if (!response || response.is_correct === null || response.points_awarded === null || !key ||
      order.length !== 4 || new Set(order).size !== 4 || CHOICES.some(c => !order.includes(c)))
      throw new Error("The answer key or marked answers are incomplete.");
    const correct = printedScanChoice(slot, key.correct_answer);
    const selected = response.student_answer ? printedScanChoice(slot, response.student_answer) : "Blank / invalid";
    if (!correct || !selected || response.is_correct !== (selected === correct) ||
      Number(response.points_awarded) !== (response.is_correct ? Number(slot.points) : 0))
      throw new Error("The marked answers do not match the current answer key. Review this paper first.");
    return { position: slot.position, selected, correct, isCorrect: response.is_correct, points: Number(response.points_awarded), maxPoints: Number(slot.points) };
  });
  const sum = (field: "points" | "maxPoints") => rows.reduce((n, r) => n + r[field], 0);
  if (grade.status !== "submitted" || grade.score === null || grade.max_score === null ||
    Math.abs(sum("points") - Number(grade.score)) > 0.00001 || Math.abs(sum("maxPoints") - Number(grade.max_score)) > 0.00001)
    throw new Error("The final score does not match the marked answers.");
  return rows.sort((a, b) => a.position - b.position);
}

export function feedbackScore(rows: FeedbackRow[]) {
  const score = rows.reduce((n, r) => n + r.points, 0), max = rows.reduce((n, r) => n + r.maxPoints, 0);
  return { correct: rows.filter(r => r.isCorrect).length, total: rows.length, score, max,
    outOfTen: Number((score / max * 10).toFixed(1)) };
}
