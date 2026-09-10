import "server-only";

import writeExcelFile from "write-excel-file/node";
import type { ClassroomStarState, WorkStatus } from "@/lib/classroom-stars";

type StyledCell = string | number | Date | null | { value: string | number | Date; type?: StringConstructor | NumberConstructor | DateConstructor | "Formula"; fontWeight?: "bold"; backgroundColor?: string; color?: string; align?: "left" | "center" | "right"; wrap?: boolean; format?: string };

const green = "#17342E";
const gold = "#E4BD55";

function columnName(number: number) {
  let result = "";
  for (let value = number; value > 0; value = Math.floor((value - 1) / 26)) result = String.fromCharCode(65 + ((value - 1) % 26)) + result;
  return result;
}

function header(value: string): StyledCell {
  return { value, fontWeight: "bold", backgroundColor: green, color: "#FFFFFF", align: "center", wrap: true };
}

function subheader(value: string): StyledCell {
  return { value, fontWeight: "bold", backgroundColor: gold, color: green, align: "center", wrap: true };
}

function statusLabel(status: WorkStatus | undefined) {
  return status ? { done: "Done", late: "Late", missing: "Missing", ok: "OK", not_ok: "Not OK" }[status] : "";
}

function sheetName(value: string, used: Set<string>) {
  const base = value.replace(/[\\/?*\[\]:]/g, " ").trim().slice(0, 31) || "Class";
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) {
    const label = ` ${suffix}`;
    candidate = `${base.slice(0, 31 - label.length)}${label}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

export async function buildClassroomStarsWorkbook(states: ClassroomStarState[]) {
  const usedNames = new Set<string>();
  const sheets: Array<{ data: StyledCell[][]; sheet: string; columns: Array<{ width: number }>; stickyRowsCount?: number; stickyColumnsCount?: number; fontFamily?: string; fontSize?: number }> = [];
  for (const state of states) {
    const maxPosition = Math.max(10, ...state.workItems.map((item) => item.position));
    const groupWidth = 1 + maxPosition * 2;
    const totalColumn = 3 + state.weeks.length * groupWidth;
    const width = totalColumn;
    const rows: StyledCell[][] = Array.from({ length: state.students.length + 4 }, () => Array.from({ length: width }, () => null));
    rows[0][0] = header("Jaguar Student ID");
    rows[0][1] = header("Student Name");
    rows[1][0] = subheader("");
    rows[1][1] = subheader("");
    const starColumns: number[] = [];
    state.weeks.forEach((week, weekIndex) => {
      const start = 2 + weekIndex * groupWidth;
      starColumns.push(start);
      rows[0][start] = header(week.label);
      rows[1][start] = subheader("Stars");
      for (let position = 1; position <= maxPosition; position += 1) {
        const homeworkColumn = start + position * 2 - 1;
        const classworkColumn = start + position * 2;
        rows[1][homeworkColumn] = subheader(`HW${position}`);
        rows[1][classworkColumn] = subheader(`CW${position}`);
        const homework = state.workItems.find((item) => item.weekLabel === week.label && item.kind === "homework" && item.position === position);
        const classwork = state.workItems.find((item) => item.weekLabel === week.label && item.kind === "classwork" && item.position === position);
        rows[2][homeworkColumn] = homework?.title ?? "";
        rows[2][classworkColumn] = classwork?.title ?? "";
        rows[3][homeworkColumn] = homework?.activityDate ?? "";
        rows[3][classworkColumn] = classwork?.activityDate ?? "";
      }
    });
    rows[0][totalColumn - 1] = header("Total Stars");

    state.students.forEach((student, studentIndex) => {
      const rowIndex = studentIndex + 4;
      rows[rowIndex][0] = student.id;
      rows[rowIndex][1] = student.fullName;
      state.weeks.forEach((week, weekIndex) => {
        const start = 2 + weekIndex * groupWidth;
        rows[rowIndex][start] = student.totals[week.label] ?? 0;
        for (let position = 1; position <= maxPosition; position += 1) {
          const homework = state.workItems.find((item) => item.weekLabel === week.label && item.kind === "homework" && item.position === position);
          const classwork = state.workItems.find((item) => item.weekLabel === week.label && item.kind === "classwork" && item.position === position);
          rows[rowIndex][start + position * 2 - 1] = statusLabel(homework?.statuses[student.id]);
          rows[rowIndex][start + position * 2] = statusLabel(classwork?.statuses[student.id]);
        }
      });
      const formula = starColumns.map((column) => `${columnName(column + 1)}${rowIndex + 1}`).join(",");
      rows[rowIndex][totalColumn - 1] = formula ? { type: "Formula", value: `=SUM(${formula})`, fontWeight: "bold" } : 0;
    });

    const columns = Array.from({ length: width }, (_, index) => ({ width: index === 0 ? 38 : index === 1 ? 30 : index === totalColumn - 1 ? 13 : 14 }));
    sheets.push({ data: rows, sheet: sheetName(state.classroom.name, usedNames), columns, stickyRowsCount: 4, stickyColumnsCount: 2, fontFamily: "Aptos", fontSize: 10 });
  }

  const reference = states[0];
  const weekRows: StyledCell[][] = [[header("Order"), header("Week"), header("Unit"), header("Focus")], ...(reference?.weeks ?? []).map((week) => [week.sortOrder, week.label, week.title ?? "", week.focus ?? ""] as StyledCell[])];
  sheets.push({ data: weekRows, sheet: sheetName("Weeks", usedNames), columns: [{ width: 10 }, { width: 12 }, { width: 32 }, { width: 48 }], stickyRowsCount: 1, fontFamily: "Aptos", fontSize: 10 });
  return writeExcelFile(sheets).toBuffer();
}
