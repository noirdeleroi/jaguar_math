import type { GradebookRosterStudent, WorkStatus } from "./classroom-stars";

export type GradebookExportValue = number | string | null | undefined;

export function workStatusGrade(status: WorkStatus | undefined) {
  if (status === "ok") return 2;
  if (status === "late") return 1;
  return 0;
}

export function gradebookColumnValues(
  roster: GradebookRosterStudent[],
  enrolledStudentIds: ReadonlySet<string>,
  valueForStudent: (studentId: string) => GradebookExportValue,
) {
  return [...roster]
    .sort((first, second) => first.sortOrder - second.sortOrder)
    .map((entry) => {
      if (!entry.studentId || !enrolledStudentIds.has(entry.studentId)) return "0";
      const value = valueForStudent(entry.studentId);
      if (value === null || value === undefined) return "0";
      const text = String(value).trim();
      if (!text || /^[-–—−]$/.test(text)) return "0";
      // The official gradebook uses a decimal comma. Keep the raw score and
      // precision (no percent sign or grouping) so each line pastes as one grade.
      return text.replace(/^(\d+)\.(\d+)$/, "$1,$2");
    });
}

export function gradebookColumnClipboardText(
  roster: GradebookRosterStudent[],
  enrolledStudentIds: ReadonlySet<string>,
  valueForStudent: (studentId: string) => GradebookExportValue,
) {
  return gradebookColumnValues(roster, enrolledStudentIds, valueForStudent).join("\n");
}
