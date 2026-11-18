import assert from "node:assert/strict";
import test from "node:test";
import { teacherAttemptStatusLabel, teacherCanReviewAttempt } from "../lib/teacher-attempt-review.ts";
import { attemptScanEvidence, correctedScanDecisions } from "../lib/paper-scan-attempt.ts";

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

test("attempt scan evidence follows the issued question order and resets crops on the second answer sheet", () => {
  const questions = Array.from({ length: 65 }, (_, i) => ({ questionId: `q-${64 - i}`, position: i + 1 }));
  const scan = { questions, pages: [
    { id: "duplicate", sheet_page: 2, status: "duplicate", readings: [] },
    { id: "page-2", sheet_page: 2, status: "accepted", readings: [{ position: 61, choice: "D" }] },
    { id: "page-1", sheet_page: 1, status: "review", readings: [{ position: 60, choice: "A" }] },
  ] };
  assert.equal(attemptScanEvidence(scan, "q-5").index, 59);
  assert.equal(attemptScanEvidence(scan, "q-5").page.id, "page-1");
  const second = attemptScanEvidence(scan, "q-4");
  assert.equal(second.index, 0);
  assert.equal(second.position, 61);
  assert.equal(second.page.id, "page-2");
  assert.equal(second.reading.choice, "D");
  assert.equal(attemptScanEvidence(scan, "not-issued"), undefined);
  assert.equal(attemptScanEvidence({ ...scan, pages: [] }, "q-4"), undefined);
});

test("single scan corrections preserve the other reviewed answers and original recognition evidence", () => {
  const readings = [
    { position: 1, choice: "B", status: "clear", densities: [0, .8, 0, 0], confidence: 97 },
    { position: 2, choice: "D", status: "clear", densities: [0, 0, 0, .9], confidence: 99 },
  ];
  const page = { status: "accepted", readings, decisions: [{ ...readings[0], choice: "A", resolved: true, reviewed: true }, { ...readings[1], resolved: true }], problem: null };
  const before = structuredClone(page);
  const next = correctedScanDecisions(page, 2, "C");
  assert.deepEqual(next[0], page.decisions[0], "keep earlier teacher correction");
  assert.equal(next[1].choice, "C");
  assert.equal(next[1].resolved, true);
  assert.equal(next[1].reviewed, true);
  assert.deepEqual(next[1].densities, readings[1].densities);
  assert.equal(next[1].confidence, 99);
  assert.deepEqual(page, before, "never modify source readings or persisted decisions");
  assert.equal(correctedScanDecisions({ ...page, decisions: null }, 1, "D")[1].resolved, true, "accepted automatic readings remain resolved");
  assert.deepEqual(correctedScanDecisions(page, 1, "blank")[0], { ...page.decisions[0], choice: null, status: "blank" });
  assert.equal(correctedScanDecisions(page, 1, "invalid")[0].status, "irregular");
  assert.throws(() => correctedScanDecisions(page, 1, "E"), /Choose/);
  assert.throws(() => correctedScanDecisions(page, 99, "A"), /missing/);
  assert.throws(() => correctedScanDecisions({ ...page, status: "review" }, 1, "A"), /Finish inspecting/);
});
