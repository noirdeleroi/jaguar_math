import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { attemptReviewLabel, attemptReviewState, homeworkResultsAreAvailable } from "../lib/attempt-review.ts";

const deadlineMigration = readFileSync(new URL("../supabase/migrations/20260928140000_deadline_only_homework.sql", import.meta.url), "utf8");
const attemptHistoryMigration = readFileSync(new URL("../supabase/migrations/20260928150000_homework_attempt_history.sql", import.meta.url), "utf8");
const learningModeMigration = readFileSync(new URL("../supabase/migrations/20261002130000_homework_learning_mode.sql", import.meta.url), "utf8");
const runner = readFileSync(new URL("../app/student/assignments/assessment-runner.tsx", import.meta.url), "utf8");
const assignmentPage = readFileSync(new URL("../app/student/assignments/[id]/page.tsx", import.meta.url), "utf8");
const dashboardData = readFileSync(new URL("../lib/student-assignments.ts", import.meta.url), "utf8");
const submittedReview = readFileSync(new URL("../app/student/assignments/submitted-attempt-review.tsx", import.meta.url), "utf8");

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

test("homework keeps deadline fallback while secure snapshot submission is restored", () => {
  assert.match(deadlineMigration, /new\.duration_minutes := null/);
  assert.match(deadlineMigration, /new\.show_answers_after_submit := true/);
  assert.match(attemptHistoryMigration, /submit_attempt_snapshot_before_deadline_only_homework/);
  assert.match(attemptHistoryMigration, /grant execute on function public\.submit_attempt_snapshot/);
});

test("homework is a revise-and-learn loop with protected solution access", () => {
  assert.match(learningModeMigration, /create function public\.check_homework_response/);
  assert.match(learningModeMigration, /attempt\.student_id = auth\.uid\(\)/);
  assert.match(learningModeMigration, /assignment\.kind = 'homework'/);
  assert.match(learningModeMigration, /attempt\.status = 'in_progress'/);
  assert.match(runner, /Check answer & solution/);
  assert.match(runner, /change your answer and check again/);
  assert.match(runner, /homework-video-link/);
  assert.match(runner, /setFeedback\(\(current\) => \(\{ \.\.\.current, \[questionId\]: null \}\)\)/);
  assert.doesNotMatch(assignmentPage, /assignment\.kind === "homework"\) \{\s*const \{ error: finalizationError \} = await supabase\.rpc\("finalize_overdue_homework_attempts"/);
});

test("active homework progress is not merged with an earlier completed score", () => {
  assert.match(dashboardData, /const displayedResult = activeIsCurrent \? undefined : submitted/);
  assert.match(dashboardData, /completed: Boolean\(submitted && !activeIsCurrent\)/);
  assert.match(assignmentPage, /const submittedAttempts = attempts\.filter/);
  assert.match(assignmentPage, /requestedAttemptId/);
  assert.match(assignmentPage, /Practice history/);
  assert.match(assignmentPage, /SubmittedAttemptReview learningMode=\{assignment\.kind === "homework"\}/);
});

test("student homework views remove points, percentages, and grade language", () => {
  assert.match(assignmentPage, /const scoreVisible = assignment\.kind !== "homework"/);
  assert.match(assignmentPage, /Review learning →/);
  assert.match(assignmentPage, /Homework is practice—there is no grade/);
  assert.match(dashboardData, /showScore: assignment\.kind !== "homework"/);
  assert.match(submittedReview, /showPoints=\{!learningMode\}/);
  assert.match(runner, /!homeworkMode && <> · \{question\.points\}/);
});
