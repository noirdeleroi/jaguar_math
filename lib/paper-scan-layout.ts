// Coordinates are PDF points, measured from the top left. Change the template
// version whenever geometry changes; issued sheets retain their version.
export const SCAN_TEMPLATE = 1;
export const SHEET_WIDTH = 595.28;
export const SHEET_HEIGHT = 841.89;
export const QUESTIONS_PER_PAGE = 60;
export const CHOICES = ["A", "B", "C", "D"] as const;
export const MARKERS = [
  { x: 32, y: 32 },
  { x: 563.28, y: 32 },
  { x: 563.28, y: 809.89 },
  { x: 32, y: 809.89 },
];
export const QR = { x: 443, y: 65, size: 112, modules: 33, quiet: 4 };
export type ScanChoice = (typeof CHOICES)[number];
export type ScanQuestion = {
  position: number;
  questionId: string;
  points: number;
  options: string[];
};
export type ScanSheet = {
  id: string;
  token: string;
  studentId: string;
  studentName: string;
  studentCode: string;
  classId: string;
  className: string;
  version: number;
  questions: ScanQuestion[];
};
export type BubbleReading = {
  position: number;
  choice: ScanChoice | null;
  // A visible suggestion for review only. It never contributes to a final grade.
  candidateChoice?: ScanChoice;
  status: "clear" | "blank" | "multiple" | "faint" | "irregular" | "unreadable";
  densities: number[];
  resolved?: boolean;
};
export function pageQuestions(questions: ScanQuestion[], page: number) {
  return questions.slice(
    (page - 1) * QUESTIONS_PER_PAGE,
    page * QUESTIONS_PER_PAGE,
  );
}
export function bubblePosition(index: number, choice: number) {
  return {
    x: 99 + Math.floor(index / 30) * 256 + choice * 39,
    y: 240 + (index % 30) * 17,
  };
}
export function qrPayload(token: string, page: number) {
  return `JM1:${token.toUpperCase()}:${page}`;
}
export function parseQrPayload(value: string) {
  const match = /^JM1:([0-9A-F]{32}):([1-4])$/.exec(value);
  return match
    ? { token: match[1].toLowerCase(), page: Number(match[2]) }
    : null;
}
export function mixedQuestionError(
  groups: { type: string; options: { id: string }[] | null }[][],
) {
  return groups.some((group) =>
    group.some(
      (q) =>
        q.type !== "multiple_choice" ||
        q.options?.length !== 4 ||
        CHOICES.some((id) => !q.options?.some((o) => o.id === id)),
    ),
  )
    ? "Mixed Tests require multiple-choice questions with exactly A, B, C and D option IDs in every version."
    : null;
}
