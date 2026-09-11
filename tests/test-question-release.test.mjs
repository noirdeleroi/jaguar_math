import assert from "node:assert/strict";
import test from "node:test";
import { testQuestionsAreReleased } from "../lib/test-question-release.ts";

test("holds a teacher-controlled test until it is released", () => {
  assert.equal(testQuestionsAreReleased({ kind: "test", teacherControlledQuestionRelease: true, questionsReleasedAt: null }), false);
  assert.equal(testQuestionsAreReleased({ kind: "test", teacherControlledQuestionRelease: true, questionsReleasedAt: "2026-09-11T18:00:00.000Z" }), true);
});

test("allows immediate tests and non-test assignments", () => {
  assert.equal(testQuestionsAreReleased({ kind: "test", teacherControlledQuestionRelease: false, questionsReleasedAt: null }), true);
  assert.equal(testQuestionsAreReleased({ kind: "quiz", teacherControlledQuestionRelease: true, questionsReleasedAt: null }), true);
});
