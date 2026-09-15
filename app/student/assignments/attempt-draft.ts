export type PendingAnswer = { answer: string; revision: number };
export type SubmissionSnapshot = {
  responses: { questionId: string; answer: string; revision: number }[];
  clientSubmittedAt: string;
  timed: boolean;
};
export type StoredDraft = {
  version: 3;
  updatedAt: string;
  answers: Record<string, PendingAnswer>;
  pending: Record<string, PendingAnswer>;
  submission?: SubmissionSnapshot;
};

export function createStoredDraft(
  answers: Record<string, PendingAnswer>,
  pending: Record<string, PendingAnswer>,
  submission: SubmissionSnapshot | null,
  updatedAt = new Date().toISOString(),
): StoredDraft {
  return { version: 3, updatedAt, answers, pending, ...(submission ? { submission } : {}) };
}

export function acknowledgePendingAnswers(pending: Record<string, PendingAnswer>, sent: [string, PendingAnswer][]) {
  for (const [questionId, answer] of sent) {
    if (pending[questionId]?.revision === answer.revision) delete pending[questionId];
  }
}

export function readStoredSubmission(value: unknown, validQuestionIds: Set<string>): SubmissionSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<SubmissionSnapshot>;
  if (typeof candidate.clientSubmittedAt !== "string" || Number.isNaN(new Date(candidate.clientSubmittedAt).getTime()) || typeof candidate.timed !== "boolean" || !Array.isArray(candidate.responses) || candidate.responses.length > 200) return null;
  if (candidate.responses.some((response) => !response || typeof response.questionId !== "string" || !validQuestionIds.has(response.questionId) || typeof response.answer !== "string" || response.answer.length > 20_000 || !Number.isSafeInteger(response.revision) || response.revision < 0)) return null;
  if (new Set(candidate.responses.map((response) => response.questionId)).size !== candidate.responses.length) return null;
  return candidate as SubmissionSnapshot;
}
