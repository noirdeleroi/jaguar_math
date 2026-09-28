export type AttemptReviewState = "correct" | "incorrect" | "unanswered" | "unscored";

export function attemptReviewState(studentAnswer: string | null, isCorrect: boolean | null): AttemptReviewState {
  if (!studentAnswer?.trim()) return "unanswered";
  if (isCorrect === true) return "correct";
  if (isCorrect === false) return "incorrect";
  return "unscored";
}

export function attemptReviewLabel(state: AttemptReviewState) {
  if (state === "correct") return "Correct";
  if (state === "incorrect") return "Incorrect";
  if (state === "unanswered") return "Not answered";
  return "Not yet scored";
}

export function homeworkResultsAreAvailable(kind: string, dueAt: string | null, now = Date.now()) {
  if (kind !== "homework" || !dueAt) return false;
  const deadline = new Date(dueAt).getTime();
  return !Number.isNaN(deadline) && deadline <= now;
}
