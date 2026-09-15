import assert from "node:assert/strict";
import test from "node:test";
import { acknowledgePendingAnswers, createStoredDraft, readStoredSubmission } from "../app/student/assignments/attempt-draft.ts";

const questionIds = new Set(["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"]);

test("persists a timed final snapshot so an offline reload can retry it", () => {
  const submission = {
    responses: [{ questionId: [...questionIds][0], answer: "42", revision: 123 }],
    clientSubmittedAt: "2026-09-14T15:00:00.000Z",
    timed: true,
  };
  const draft = createStoredDraft({}, {}, submission, "2026-09-14T15:00:00.000Z");
  assert.deepEqual(readStoredSubmission(JSON.parse(JSON.stringify(draft)).submission, questionIds), submission);
});

test("rejects corrupted or cross-attempt submission snapshots", () => {
  const invalid = {
    responses: [{ questionId: "33333333-3333-4333-8333-333333333333", answer: "stale", revision: 1 }],
    clientSubmittedAt: "2026-09-14T15:00:00.000Z",
    timed: true,
  };
  assert.equal(readStoredSubmission(invalid, questionIds), null);
  assert.equal(readStoredSubmission({ ...invalid, responses: [], clientSubmittedAt: "not-a-date" }, questionIds), null);
});

test("a slow acknowledgement cannot erase an answer edited while it was in flight", () => {
  const pending = { question: { answer: "new answer", revision: 2 }, unchanged: { answer: "done", revision: 7 } };
  acknowledgePendingAnswers(pending, [["question", { answer: "old answer", revision: 1 }], ["unchanged", { answer: "done", revision: 7 }]]);
  assert.deepEqual(pending, { question: { answer: "new answer", revision: 2 } });
});
