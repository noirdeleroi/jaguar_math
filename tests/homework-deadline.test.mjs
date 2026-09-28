import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { attemptReviewLabel, attemptReviewState, homeworkResultsAreAvailable } from "../lib/attempt-review.ts";

const migration = readFileSync(new URL("../supabase/migrations/20260928140000_deadline_only_homework.sql", import.meta.url), "utf8");
const runner = readFileSync(new URL("../app/student/assignments/assessment-runner.tsx", import.meta.url), "utf8");
const assignmentPage = readFileSync(new URL("../app/student/assignments/[id]/page.tsx", import.meta.url), "utf8");

test("unanswered homework questions remain gray instead of being presented as wrong", () => {
  assert.equal(attemptReviewState(null, false), "unanswered");
  assert.equal(attemptReviewState("   ", false), "unanswered");
  assert.equal(attemptReviewLabel(attemptReviewState("", false)), "Not answered");
  assert.equal(attemptReviewState("answer", true), "correct");
  assert.equal(attemptReviewState("answer", false), "incorrect");
});

test("homework results become available at the exact due timestamp", () => {
  const deadline = "2026-09-28T17:00:00.000Z";
  assert.equal(homeworkResultsAreAvailable("homework", deadline, new Date(deadline).getTime() - 1), false);
  assert.equal(homeworkResultsAreAvailable("homework", deadline, new Date(deadline).getTime()), true);
  assert.equal(homeworkResultsAreAvailable("test", deadline, new Date(deadline).getTime()), false);
  assert.equal(homeworkResultsAreAvailable("homework", null, Date.now()), false);
});

test("the database rejects manual or early homework finalization", () => {
  assert.match(migration, /Homework does not accept manual submission/);
  assert.match(migration, /Homework cannot close before its deadline/);
  assert.match(migration, /new\.duration_minutes := null/);
  assert.match(migration, /new\.show_answers_after_submit := true/);
});

test("the runner removes homework submission controls and confirms assessment submission", () => {
  assert.match(runner, /There is no submit button for homework/);
  assert.match(runner, /questionDisplayMode === "all_at_once" && !deadlineOnly/);
  assert.match(runner, /window\.confirm\(`Submit your \$\{subject\} now\?/);
  assert.doesNotMatch(assignmentPage, /assignment\.kind === "homework"\) \{\s*const \{ error: finalizationError \} = await supabase\.rpc\("finalize_overdue_homework_attempts"/);
});
