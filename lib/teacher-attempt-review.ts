export type TeacherReviewableAttempt = {
  attempt_id: string | null;
  status: "submitted" | "in_progress" | "not_started";
};

export function teacherCanReviewAttempt(attempt: TeacherReviewableAttempt) {
  return attempt.status !== "not_started" && Boolean(attempt.attempt_id);
}

export function teacherAttemptStatusLabel(status: "submitted" | "in_progress", expiresAt: string | null, now = Date.now()) {
  if (status === "submitted") return "Submitted attempt";
  if (expiresAt && new Date(expiresAt).getTime() <= now) return "Time ended · saved answers";
  return "In-progress attempt · saved answers";
}
