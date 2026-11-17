import type { PageRow, SheetRow } from "./paper-scan-types.ts";

// Follow the review queue in the same class/name order as the grading roster.
// Accepted pages, missing scans, duplicates, and unidentified students are not
// inspections that can be reached through a named student's paper.
export function nextSheetNeedingInspection<T extends Pick<SheetRow, "id" | "class_name" | "student_name">>(
  sheets: T[],
  pages: Pick<PageRow, "sheet_id" | "status">[],
  currentSheetId: string,
): T | undefined {
  const needsReview = new Set(pages.filter((page) => page.status === "review" && page.sheet_id).map((page) => page.sheet_id));
  const ordered = [...sheets].sort((a, b) => a.class_name.localeCompare(b.class_name) || a.student_name.localeCompare(b.student_name) || a.id.localeCompare(b.id));
  const current = ordered.findIndex((sheet) => sheet.id === currentSheetId);
  for (let step = 1; step <= ordered.length; step++) {
    const candidate = ordered[(current + step) % ordered.length];
    if (candidate.id !== currentSheetId && needsReview.has(candidate.id)) return candidate;
  }
  return undefined;
}
