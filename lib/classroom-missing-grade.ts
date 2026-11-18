import type { ClassroomGrade } from "./classroom-stars.ts";

// A submitted attempt or completed rubric always takes precedence over an entry
// used to fill a missing cell. Zero is a real grade, not an empty cell.
export function withMissingGrades(
  generated: Record<string, ClassroomGrade>,
  entries: { student_id: string; score: number | string }[],
  maxScore: number | null,
): Record<string, ClassroomGrade> {
  const scores = { ...generated };
  if (maxScore === null || !Number.isFinite(maxScore) || maxScore <= 0) return scores;
  for (const entry of entries) {
    const score = Number(entry.score);
    if (!scores[entry.student_id] && Number.isFinite(score) && score >= 0 && score <= maxScore) {
      scores[entry.student_id] = { attemptId: null, isManual: true, score, maxScore, percent: Math.round(score / maxScore * 100) };
    }
  }
  return scores;
}
