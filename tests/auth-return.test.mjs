import assert from "node:assert/strict";
import test from "node:test";
import { safeReturnPath } from "../lib/auth-return.ts";

test("returns students to their assessment after signing in", () => {
  assert.equal(safeReturnPath("/student/assignments/attempt-1", "student"), "/student/assignments/attempt-1");
  assert.equal(safeReturnPath("/teacher/assignments/attempt-1", "student"), null);
});

test("rejects external and malformed return paths", () => {
  assert.equal(safeReturnPath("https://example.com", "student"), null);
  assert.equal(safeReturnPath("//example.com/student", "student"), null);
  assert.equal(safeReturnPath("/student\\..\\teacher", "student"), null);
});
