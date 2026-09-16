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
      if (!entry.studentId || !enrolledStudentIds.has(entry.studentId)) return "-";
      const value = valueForStudent(entry.studentId);
      return value === null || value === undefined || value === "" ? "0" : String(value);
    });
}

export function gradebookColumnClipboardText(
  roster: GradebookRosterStudent[],
  enrolledStudentIds: ReadonlySet<string>,
  valueForStudent: (studentId: string) => GradebookExportValue,
) {
  return gradebookColumnValues(roster, enrolledStudentIds, valueForStudent).join("\n");
}
