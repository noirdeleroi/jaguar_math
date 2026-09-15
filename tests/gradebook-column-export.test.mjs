import assert from "node:assert/strict";
import test from "node:test";
import { gradebookColumnClipboardText, gradebookColumnValues, workStatusGrade } from "../lib/gradebook-column-export.ts";

const roster = [
  { gradebookCode: "20", gradebookName: "Second Student", sortOrder: 2, studentId: "student-2" },
  { gradebookCode: "10", gradebookName: "First Student", sortOrder: 1, studentId: "student-1" },
  { gradebookCode: "30", gradebookName: "Missing Student", sortOrder: 3, studentId: null },
];

test("gradebook column export follows official order and preserves missing students", () => {
  const values = gradebookColumnValues(roster, new Set(["student-1", "student-2"]), (studentId) => studentId === "student-1" ? 8.5 : null);
  assert.deepEqual(values, ["8.5", "-", "-"]);
  assert.equal(gradebookColumnClipboardText(roster, new Set(["student-1", "student-2"]), () => 2), "2\n2\n-");
});

test("students linked to profiles but not enrolled export as missing", () => {
  const linkedRoster = [{ gradebookCode: "10", gradebookName: "Moved Student", sortOrder: 1, studentId: "student-3" }];
  assert.deepEqual(gradebookColumnValues(linkedRoster, new Set(), () => 100), ["-"]);
});

test("HW and CW statuses use spreadsheet-ready numeric grades", () => {
  assert.equal(workStatusGrade("ok"), 2);
  assert.equal(workStatusGrade("late"), 1);
  assert.equal(workStatusGrade("not_ok"), 0);
  assert.equal(workStatusGrade(undefined), 0);
});
