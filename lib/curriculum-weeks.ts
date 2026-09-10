import "server-only";

import curriculumSource from "@/data/curriculum-weeks.json";

export type CurriculumWeek = {
  trimester: string;
  label: string;
  sortOrder: number;
  unit: string;
  topic: string;
};

const curriculum = curriculumSource as Record<"11" | "12", CurriculumWeek[]>;

export const defaultCurrentWeek = "A3";
export const curriculumWeekOptions = curriculum["11"].map(({ label, sortOrder, trimester }) => ({ label, sortOrder, trimester }));

export function curriculumTopic(gradeLevel: number, weekLabel: string) {
  const grade = gradeLevel === 12 ? "12" : "11";
  return curriculum[grade].find((week) => week.label === weekLabel) ?? null;
}

export function isCurriculumWeek(weekLabel: string) {
  return curriculumWeekOptions.some((week) => week.label === weekLabel);
}
