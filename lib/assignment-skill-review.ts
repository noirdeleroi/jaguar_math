export type AssignmentSkillResponse = { question_id: string; is_correct: boolean | null; points_awarded: number | null };
export type AssignmentQuestionPoints = { question_id: string; points: number };
export type AssignmentSkillLink = { question_id: string; skill_code: string; weight: number };
export type AssignmentSkillReview = { code: string; earned: number; possible: number; mistakeCount: number; missedPoints: number };

export function buildAssignmentSkillReview(responses: AssignmentSkillResponse[], questions: AssignmentQuestionPoints[], links: AssignmentSkillLink[]): AssignmentSkillReview[] {
  const responseByQuestion = new Map(responses.filter((response) => response.is_correct !== null).map((response) => [response.question_id, response]));
  const pointsByQuestion = new Map(questions.map((question) => [question.question_id, Number(question.points)]));
  const totals = new Map<string, { earned: number; possible: number; mistakenQuestionIds: Set<string> }>();
  for (const link of links) {
    const response = responseByQuestion.get(link.question_id); const points = pointsByQuestion.get(link.question_id);
    if (!response || points === undefined) continue;
    const weight = Number(link.weight); const current = totals.get(link.skill_code) ?? { earned: 0, possible: 0, mistakenQuestionIds: new Set<string>() };
    current.earned += Number(response.points_awarded ?? 0) * weight;
    current.possible += points * weight;
    if (response.is_correct === false) current.mistakenQuestionIds.add(link.question_id);
    totals.set(link.skill_code, current);
  }
  return [...totals.entries()].filter(([, total]) => total.mistakenQuestionIds.size > 0).map(([code, total]) => ({ code, earned: total.earned, possible: total.possible, mistakeCount: total.mistakenQuestionIds.size, missedPoints: Math.max(0, total.possible - total.earned) })).sort((left, right) => right.mistakeCount - left.mistakeCount || right.missedPoints - left.missedPoints || left.code.localeCompare(right.code));
}
