export type SkillProgress = { domain: string; skill_code: string; skill_name: string; attempted_evidence: number; correct_evidence: number; accuracy: number; earned_points: number; possible_points: number };
export type SkillEvidence = { skill_code: string; assignment_title: string; question_position: number; submitted_at: string; is_correct: boolean; earned_points: number; possible_points: number };

export const progressStatus = (progress: Pick<SkillProgress, "attempted_evidence" | "accuracy">) => {
  if (progress.attempted_evidence < 3) return "Not enough data";
  if (Number(progress.accuracy) < 60) return "Needs work";
  if (Number(progress.accuracy) < 80) return "Developing";
  return "Strong";
};

export const progressPercent = (progress: Pick<SkillProgress, "accuracy">) => Math.round(Number(progress.accuracy));

export const progressByDomain = <T extends Pick<SkillProgress, "domain">>(rows: T[]) => {
  const grouped = new Map<string, T[]>();
  rows.forEach((row) => grouped.set(row.domain, [...(grouped.get(row.domain) ?? []), row]));
  return [...grouped.entries()];
};
