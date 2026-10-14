export type ExamQuestion = { id: string; prompt: string; type: string; options: { id: string; text: string }[] | null; points: number; answer: string; serverRevision: number; isCorrect: boolean | null; pointsAwarded: number | null };
export type ExamLaunch = { id: string; expiresAt: string | null; formCode: string | null; focusViolations: number; questions?: ExamQuestion[] };
