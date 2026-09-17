import assert from "node:assert/strict";
import test from "node:test";
import { normalizeFinalGradeOverride } from "../lib/classroom-final-grade.ts";

test("manual topic final grades accept bounded scores and trim comments", () => {
  assert.deepEqual(normalizeFinalGradeOverride("17.5", "  Strong recovery  ", 20), { score: 17.5, comment: "Strong recovery" });
});

test("manual topic final grades reject scores outside the topic maximum", () => {
  assert.throws(() => normalizeFinalGradeOverride(-1, "", 20), /between 0 and 20/);
  assert.throws(() => normalizeFinalGradeOverride(21, "", 20), /between 0 and 20/);
});

test("manual topic final grades reject oversized comments", () => {
  assert.throws(() => normalizeFinalGradeOverride(18, "x".repeat(501), 20), /under 500 characters/);
});
