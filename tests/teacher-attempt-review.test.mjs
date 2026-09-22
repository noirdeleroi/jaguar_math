import assert from "node:assert/strict";
import test from "node:test";
import { teacherAttemptStatusLabel, teacherCanReviewAttempt } from "../lib/teacher-attempt-review.ts";

test("teachers can review every started attempt regardless of submission", () => {
  assert.equal(teacherCanReviewAttempt({ attempt_id: "attempt-1", status: "in_progress" }), true);
  assert.equal(teacherCanReviewAttempt({ attempt_id: "attempt-2", status: "submitted" }), true);
  assert.equal(teacherCanReviewAttempt({ attempt_id: null, status: "not_started" }), false);
});

test("labels live and timed-out answer snapshots without calling them submitted", () => {
  const now = Date.parse("2026-09-22T18:00:00.000Z");
  assert.equal(teacherAttemptStatusLabel("in_progress", "2026-09-22T18:05:00.000Z", now), "In-progress attempt · saved answers");
  assert.equal(teacherAttemptStatusLabel("in_progress", "2026-09-22T17:55:00.000Z", now), "Time ended · saved answers");
  assert.equal(teacherAttemptStatusLabel("submitted", "2026-09-22T17:55:00.000Z", now), "Submitted attempt");
});
