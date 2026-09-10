import "server-only";

import { createHash } from "crypto";
import readExcelFile from "read-excel-file/node";
import type { WorkKind, WorkStatus } from "@/lib/classroom-stars";

type Cell = string | number | boolean | Date | null;
type Sheet = { sheet: string; data: Cell[][] };

export type StudentMatchCandidate = {
  id: string;
  fullName: string;
  email: string | null;
  aliases: string[];
};

type ExcelStudent = { name: string; rowIndex: number };
type ParsedWeek = { label: string; sort_order: number; title: string; focus: string };
type ParsedWorkItem = { week_label: string; kind: WorkKind; position: number; title: string; activity_date: string };
type ParsedStatus = { excel_name: string; week_label: string; kind: WorkKind; position: number; status: WorkStatus };

export type MatchReportRow = {
  excelName: string;
  outcome: "matched" | "ambiguous" | "excel_only";
  matchedStudentId?: string;
  matchedStudentName?: string;
  confidence?: number;
  reason: string;
  suggestions?: string[];
};

export type WorkbookPreview = {
  fileName: string;
  fileSha256: string;
  sheetName: string;
  weeks: ParsedWeek[];
  starTotals: Array<{ excel_name: string; week_label: string; total: number }>;
  workItems: ParsedWorkItem[];
  workStatuses: ParsedStatus[];
  matches: MatchReportRow[];
  missingFromWorkbook: Array<{ studentId: string; studentName: string }>;
};

function plain(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokens(value: string) {
  return [...new Set(plain(value).split(/\s+/).filter(Boolean))];
}

function signature(value: string) {
  return tokens(value).sort().join(" ");
}

function levenshtein(first: string, second: string) {
  if (!first.length) return second.length;
  if (!second.length) return first.length;
  const previous = Array.from({ length: second.length + 1 }, (_, index) => index);
  for (let row = 1; row <= first.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= second.length; column += 1) {
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + (first[row - 1] === second[column - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[second.length];
}

export function nameMatchScore(first: string, second: string) {
  const firstPlain = plain(first);
  const secondPlain = plain(second);
  if (!firstPlain || !secondPlain) return { score: 0, reason: "no comparable name" };
  if (firstPlain === secondPlain) return { score: 1, reason: "same normalized name" };
  if (signature(first) === signature(second)) return { score: 0.995, reason: "same name in a different order" };

  const left = new Set(tokens(first));
  const right = new Set(tokens(second));
  const common = [...left].filter((token) => right.has(token)).length;
  const smaller = Math.min(left.size, right.size);
  const larger = Math.max(left.size, right.size);
  if (common >= 2 && common === smaller) {
    return { score: common >= 3 ? 0.97 : 0.94, reason: "matching first/surname combination" };
  }
  if (common >= 3) return { score: Math.min(0.95, 0.82 + common / larger * 0.15), reason: "strong multi-name overlap" };

  const firstCompact = firstPlain.replaceAll(" ", "");
  const secondCompact = secondPlain.replaceAll(" ", "");
  const similarity = 1 - levenshtein(firstCompact, secondCompact) / Math.max(firstCompact.length, secondCompact.length);
  if (similarity >= 0.88) return { score: similarity * 0.92, reason: "minor spelling variation" };
  return { score: common / Math.max(left.size, right.size), reason: "weak name overlap" };
}

function matchStudents(excelStudents: ExcelStudent[], candidates: StudentMatchCandidate[]) {
  const proposals = excelStudents.map((excelStudent) => {
    const ranked = candidates.map((candidate) => {
      const best = candidate.aliases.reduce((winner, alias) => {
        const result = nameMatchScore(excelStudent.name, alias);
        return result.score > winner.score ? result : winner;
      }, { score: 0, reason: "no comparable name" });
      return { candidate, ...best };
    }).sort((first, second) => second.score - first.score);
    return { excelStudent, ranked };
  }).sort((first, second) => (second.ranked[0]?.score ?? 0) - (first.ranked[0]?.score ?? 0));

  const usedStudentIds = new Set<string>();
  const result = new Map<string, MatchReportRow>();
  for (const proposal of proposals) {
    const available = proposal.ranked.filter((item) => !usedStudentIds.has(item.candidate.id));
    const best = available[0];
    const runnerUp = available[1];
    const margin = best ? best.score - (runnerUp?.score ?? 0) : 0;
    if (best && best.score >= 0.9 && margin >= 0.08) {
      usedStudentIds.add(best.candidate.id);
      result.set(proposal.excelStudent.name, {
        excelName: proposal.excelStudent.name,
        outcome: "matched",
        matchedStudentId: best.candidate.id,
        matchedStudentName: best.candidate.fullName,
        confidence: Math.round(best.score * 100),
        reason: best.reason,
      });
    } else if (best && best.score >= 0.6) {
      result.set(proposal.excelStudent.name, {
        excelName: proposal.excelStudent.name,
        outcome: "ambiguous",
        confidence: Math.round(best.score * 100),
        reason: "More than one existing student could match; skipped for safety.",
        suggestions: available.slice(0, 3).map((item) => item.candidate.fullName),
      });
    } else {
      result.set(proposal.excelStudent.name, {
        excelName: proposal.excelStudent.name,
        outcome: "excel_only",
        reason: "No safe match among students already enrolled in this Jaguar class.",
      });
    }
  }
  return excelStudents.map((student) => result.get(student.name)!);
}

function statusValue(value: Cell, kind: WorkKind): WorkStatus | null {
  const normalized = plain(value);
  if (kind === "homework") {
    if (normalized === "done" || normalized === "ok") return "ok";
    if (normalized === "late") return "late";
    if (normalized === "missing" || normalized === "not ok" || normalized === "not_ok") return "not_ok";
  } else {
    if (normalized === "ok") return "ok";
    if (normalized === "not ok" || normalized === "not_ok") return "not_ok";
  }
  return null;
}

function isoDate(value: Cell) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const stringValue = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(stringValue) ? stringValue : "";
}

function classKey(value: string) {
  return plain(value).replace(/\bmath\b/g, "").replaceAll(" ", "");
}

export async function previewClassroomWorkbook(buffer: Buffer, fileName: string, classroomName: string, candidates: StudentMatchCandidate[]): Promise<WorkbookPreview> {
  const sheets = await readExcelFile(buffer) as Sheet[];
  const classSheet = sheets.find((sheet) => classKey(sheet.sheet) === classKey(classroomName));
  if (!classSheet) throw new Error(`No worksheet safely matches ${classroomName}. Available sheets: ${sheets.map((sheet) => sheet.sheet).join(", ")}.`);
  const rows = classSheet.data;
  const firstRow = rows[0] ?? [];
  const secondRow = rows[1] ?? [];
  const nameColumn = firstRow.findIndex((value) => plain(value) === "student name");
  if (nameColumn < 0) throw new Error("The matched class worksheet has no Student Name column.");
  const excelStudents = rows.slice(4).map((row, index) => ({ name: String(row[nameColumn] ?? "").trim(), rowIndex: index + 4 })).filter((student) => student.name);
  const duplicateNames = [...new Set(excelStudents.filter((student, index) => excelStudents.findIndex((candidate) => plain(candidate.name) === plain(student.name)) !== index).map((student) => student.name))];
  if (duplicateNames.length) throw new Error(`The worksheet contains duplicate Student Name rows: ${duplicateNames.join(", ")}. Resolve them before importing so no student can be matched incorrectly.`);
  const matches = matchStudents(excelStudents, candidates);
  const weekStarts = firstRow.map((value, index) => ({ label: String(value ?? "").trim(), index })).filter((item) => item.index > nameColumn && item.label && plain(item.label) !== "total stars");

  const grade = classroomName.match(/\b(11|12)[a-z]?\b/i)?.[1];
  const weeksSheet = sheets.find((sheet) => grade && plain(sheet.sheet) === `grade ${grade} weeks`) ?? sheets.find((sheet) => plain(sheet.sheet) === "weeks");
  const weekMetadata = new Map<string, { title: string; focus: string }>();
  if (weeksSheet) {
    const header = weeksSheet.data[0] ?? [];
    const weekColumn = header.findIndex((value) => plain(value) === "week");
    const unitColumn = header.findIndex((value) => plain(value) === "unit");
    const focusColumn = header.findIndex((value) => plain(value) === "focus");
    for (const row of weeksSheet.data.slice(1)) {
      const label = String(row[weekColumn] ?? "").trim();
      if (label) weekMetadata.set(label, { title: String(row[unitColumn] ?? "").trim(), focus: String(row[focusColumn] ?? "").trim() });
    }
  }
  const weeks = weekStarts.map((week, index) => ({ label: week.label, sort_order: index + 1, title: weekMetadata.get(week.label)?.title ?? "", focus: weekMetadata.get(week.label)?.focus ?? "" }));
  const starTotals: WorkbookPreview["starTotals"] = [];
  const workItems: ParsedWorkItem[] = [];
  const workStatuses: ParsedStatus[] = [];

  for (let weekIndex = 0; weekIndex < weekStarts.length; weekIndex += 1) {
    const week = weekStarts[weekIndex];
    const endColumn = weekStarts[weekIndex + 1]?.index ?? firstRow.findIndex((value, index) => index > week.index && plain(value) === "total stars");
    const boundary = endColumn > week.index ? endColumn : firstRow.length;
    for (const student of excelStudents) {
      const total = Number(rows[student.rowIndex]?.[week.index] ?? 0);
      starTotals.push({ excel_name: student.name, week_label: week.label, total: Number.isFinite(total) ? Math.max(0, Math.trunc(total)) : 0 });
    }
    for (let column = week.index + 1; column < boundary; column += 1) {
      const header = String(secondRow[column] ?? "").trim().match(/^(HW|CW)\s*(\d+)$/i);
      if (!header) continue;
      const kind: WorkKind = header[1].toUpperCase() === "HW" ? "homework" : "classwork";
      const position = Number(header[2]);
      const title = String(rows[2]?.[column] ?? "").trim();
      const activityDate = isoDate(rows[3]?.[column] ?? null);
      const statuses = excelStudents.flatMap((student) => {
        const status = statusValue(rows[student.rowIndex]?.[column] ?? null, kind);
        return status ? [{ excel_name: student.name, week_label: week.label, kind, position, status }] : [];
      });
      if (!title && !activityDate && !statuses.length) continue;
      workItems.push({ week_label: week.label, kind, position, title: title || `${kind === "homework" ? "HW" : "CW"} ${position}`, activity_date: activityDate });
      workStatuses.push(...statuses);
    }
  }

  const matchedStudentIds = new Set(matches.flatMap((match) => match.matchedStudentId ? [match.matchedStudentId] : []));
  return {
    fileName,
    fileSha256: createHash("sha256").update(buffer).digest("hex"),
    sheetName: classSheet.sheet,
    weeks,
    starTotals,
    workItems,
    workStatuses,
    matches,
    missingFromWorkbook: candidates.filter((candidate) => !matchedStudentIds.has(candidate.id)).map((candidate) => ({ studentId: candidate.id, studentName: candidate.fullName })),
  };
}

export function importPayload(preview: WorkbookPreview) {
  const studentIdByExcelName = new Map(preview.matches.flatMap((match) => match.outcome === "matched" && match.matchedStudentId ? [[match.excelName, match.matchedStudentId] as const] : []));
  return {
    weeks: preview.weeks,
    starTotals: preview.starTotals.flatMap((star) => {
      const studentId = studentIdByExcelName.get(star.excel_name);
      return studentId ? [{ student_id: studentId, week_label: star.week_label, total: star.total }] : [];
    }),
    workItems: preview.workItems,
    workStatuses: preview.workStatuses.flatMap((status) => {
      const studentId = studentIdByExcelName.get(status.excel_name);
      return studentId ? [{ student_id: studentId, week_label: status.week_label, kind: status.kind, position: status.position, status: status.status }] : [];
    }),
  };
}
