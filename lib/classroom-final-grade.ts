export const FINAL_GRADE_COMMENT_MAX_LENGTH = 500;

export function normalizeFinalGradeOverride(scoreValue: unknown, commentValue: unknown, maximum: number) {
  const score = typeof scoreValue === "number" ? scoreValue : Number(scoreValue);
  if (!Number.isFinite(score) || score < 0 || score > maximum) {
    throw new Error(`Enter a final grade between 0 and ${maximum}.`);
  }
  if (typeof commentValue !== "string") throw new Error("The grade comment must be text.");
  const comment = commentValue.trim();
  if (comment.length > FINAL_GRADE_COMMENT_MAX_LENGTH) {
    throw new Error(`Keep the grade comment under ${FINAL_GRADE_COMMENT_MAX_LENGTH} characters.`);
  }
  return { score, comment };
}
