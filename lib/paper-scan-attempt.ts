import { CHOICES, QUESTIONS_PER_PAGE } from "./paper-scan-layout.ts";
import type { ScanQuestion } from "./paper-scan-layout.ts";
import type { PageRow } from "./paper-scan-types.ts";

export type AttemptScanPage = Pick<PageRow,
  "id" | "sheet_page" | "status" | "readings" | "decisions" | "problem" | "revision"
>;
export type AttemptScan = {
  assignmentId: string;
  sheetId: string;
  questions: Pick<ScanQuestion, "questionId" | "position">[];
  pages: AttemptScanPage[];
};

export function attemptScanEvidence(scan: AttemptScan, questionId: string) {
  const index = scan.questions.findIndex((q) => q.questionId === questionId);
  if (index < 0) return undefined;
  const sheetPage = Math.floor(index / QUESTIONS_PER_PAGE) + 1;
  const page = scan.pages.find((p) => p.sheet_page === sheetPage && ["accepted", "review"].includes(p.status));
  if (!page) return undefined;
  const position = scan.questions[index].position;
  return {
    page,
    position,
    index: index % QUESTIONS_PER_PAGE,
    reading: page.readings.find((r) => r.position === position),
  };
}

export function correctedScanDecisions(page: AttemptScanPage, position: number, choice: string) {
  if (page.status !== "accepted") throw new Error("Finish inspecting this page in grading before changing individual answers.");
  if (![...CHOICES, "blank", "invalid"].includes(choice)) throw new Error("Choose A, B, C, D, Blank, or Invalid.");
  const initial = page.decisions ?? page.readings;
  if (!initial.some((r) => r.position === position)) throw new Error("This answer is missing from the scan. Open grading to inspect the page.");
  return initial.map((r) => r.position === position ? {
    ...r,
    choice: CHOICES.find((c) => c === choice) ?? null,
    status: choice === "blank" ? "blank" as const : choice === "invalid" ? "irregular" as const : "clear" as const,
    resolved: true,
    reviewed: true,
  } : { ...r, resolved: true });
}
