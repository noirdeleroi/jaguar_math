import type { BubbleReading, ScanQuestion } from "./paper-scan-layout.ts";

export function scanPageResults(
  questions: ScanQuestion[],
  readings: BubbleReading[],
  keys: Record<string, string>,
  alignmentProblem = false,
) {
  const rows = questions.map((question) => {
    const reading = readings.find((r) => r.position === question.position);
    const resolved = Boolean(
      reading &&
        !alignmentProblem &&
        (reading.resolved || reading.status === "clear"),
    );
    const choice =
      reading?.choice ??
      (reading?.status === "faint" && !reading.resolved
        ? (reading.candidateChoice ?? null)
        : null);
    const answerKey = keys[question.questionId];
    const comparison = choice
      ? choice === answerKey
        ? "correct"
        : "incorrect"
      : reading?.status === "blank"
        ? "blank"
        : "unresolved";
    const points = comparison === "correct" ? question.points : 0;
    return {
      position: question.position,
      choice,
      answerKey,
      comparison,
      resolved,
      points,
      maxPoints: question.points,
      status: reading?.status ?? "unreadable",
    };
  });
  return {
    rows,
    score: rows.reduce((sum, row) => sum + row.points, 0),
    maxScore: rows.reduce((sum, row) => sum + row.maxPoints, 0),
    unresolved: rows.filter((row) => !row.resolved).length,
    correct: rows.filter((row) => row.comparison === "correct").length,
    incorrect: rows.filter((row) => row.comparison === "incorrect").length,
    blank: rows.filter((row) => row.comparison === "blank").length,
  };
}
