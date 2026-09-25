import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../supabase/migrations/20260922150000_paper_assessments.sql", import.meta.url), "utf8");
const resultsMigration = readFileSync(new URL("../supabase/migrations/20260922153000_versioned_assignment_results.sql", import.meta.url), "utf8");
const fourVersionsMigration = readFileSync(new URL("../supabase/migrations/20260922170000_four_assessment_versions.sql", import.meta.url), "utf8");
const synchronizedSessionMigration = readFileSync(new URL("../supabase/migrations/20260923150000_synchronized_paper_sessions.sql", import.meta.url), "utf8");
const teacherEntryMigration = readFileSync(new URL("../supabase/migrations/20260924130000_teacher_paper_answer_entry.sql", import.meta.url), "utf8");
const closedTeacherEntryMigration = readFileSync(new URL("../supabase/migrations/20260924160000_closed_paper_answer_entry.sql", import.meta.url), "utf8");
const publishedTeacherEntryMigration = readFileSync(new URL("../supabase/migrations/20260924170000_published_paper_teacher_entry.sql", import.meta.url), "utf8");
const fullPaperManagerMigration = readFileSync(new URL("../supabase/migrations/20260924180000_paper_manager_full_control.sql", import.meta.url), "utf8");
const importParser = readFileSync(new URL("../lib/assignment-import.ts", import.meta.url), "utf8");
const assignmentBuilder = readFileSync(new URL("../app/teacher/assignments/assignment-builder.tsx", import.meta.url), "utf8");
const fourVersionAssessment = JSON.parse(readFileSync(new URL("../data/assessment-imports/algebra-foundations-linear-equations-paper-test-10q-4v.json", import.meta.url), "utf8"));
const studentPage = readFileSync(new URL("../app/student/assignments/[id]/page.tsx", import.meta.url), "utf8");
const runner = readFileSync(new URL("../app/student/assignments/assessment-runner.tsx", import.meta.url), "utf8");
const waitingRoom = readFileSync(new URL("../app/student/assignments/paper-assessment-gate.tsx", import.meta.url), "utf8");
const teacherManager = readFileSync(new URL("../app/teacher/assignments/results-overview-client.tsx", import.meta.url), "utf8");
const teacherEntry = readFileSync(new URL("../app/teacher/assignments/paper-answer-entry.tsx", import.meta.url), "utf8");

test("paper attempts receive one coherent version in printed order", () => {
  assert.match(migration, /v_paper_version := 1 \+ mod/);
  assert.match(migration, /candidate\.variant_index = v_paper_version/);
  assert.match(migration, /set form_code = 'Version ' \|\| v_paper_version/);
  assert.match(migration, /order by question\.position/);
});

test("active paper attempts expose answer metadata without prompt or option text", () => {
  assert.match(migration, /create function public\.get_my_paper_answer_sheet/);
  assert.match(migration, /attempt\.status = 'submitted' and assignment\.show_answers_after_submit/);
  assert.doesNotMatch(migration.match(/create function public\.get_my_paper_answer_sheet[\s\S]*?\$\$;/)?.[0] ?? "", /question\.prompt|question\.options/);
  assert.match(studentPage, /get_my_paper_answer_sheet/);
  assert.match(studentPage, /prompt: ""/);
});

test("the paper runner is an answer-only sheet with autosave and final submission", () => {
  assert.match(runner, /if \(paperMode\)/);
  assert.match(runner, /Enter answers (?:only|in order)\./);
  assert.match(runner, /onChange=\{\(\) => save\(question\.id, option\.id\)\}/);
  assert.match(runner, /Submit paper answers/);
  assert.match(runner, /submit\(true\)/);
});

test("paper writing and answer timers are synchronized from server timestamps", () => {
  assert.match(synchronizedSessionMigration, /paper_writing_ends_at = now\(\) \+ make_interval\(mins => duration_minutes\)/);
  assert.match(synchronizedSessionMigration, /questions_released_at \+ make_interval\(secs => greatest\(10/);
  assert.match(synchronizedSessionMigration, /create function public\.get_my_paper_session_state/);
  assert.match(waitingRoom, /serverOffset/);
  assert.match(waitingRoom, /paper-session-status/);
  assert.match(waitingRoom, /router\.refresh\(\)/);
  assert.match(runner, /setServerOffset\(new Date\(status\.serverNow\)/);
  assert.match(runner, /paperMode \? 2_000 : 15_000/);
});

test("paper waiting and answer entry enforce fullscreen with recorded exits", () => {
  assert.match(synchronizedSessionMigration, /new\.exam_require_fullscreen := true/);
  assert.match(synchronizedSessionMigration, /new\.exam_track_focus_exits := true/);
  assert.match(waitingRoom, /sendExamActivity\(attemptId, "fullscreen_exited"/);
  assert.match(waitingRoom, /Return to fullscreen now/);
  assert.match(runner, /Fullscreen exit recorded/);
});

test("the teacher paper manager can adjust, submit, and monitor individual attempts", () => {
  assert.match(synchronizedSessionMigration, /create function public\.adjust_owned_paper_answer_time/);
  assert.match(synchronizedSessionMigration, /create function public\.force_submit_all_owned_assessment_attempts/);
  assert.match(synchronizedSessionMigration, /create function public\.get_owned_paper_roster/);
  assert.match(teacherManager, /Add \(\{selectedAssignedStudents\.length\}\)/);
  assert.match(teacherManager, /Remove \(\{selectedAssignedStudents\.length\}\)/);
  assert.match(teacherManager, /Submit now/);
});

test("the paper manager keeps full teacher controls before release and after close", () => {
  assert.match(teacherManager, /Full paper test controls/);
  assert.match(teacherManager, /Select all students/);
  assert.match(teacherManager, /\+30s/);
  assert.match(teacherManager, /−30s/);
  assert.match(teacherManager, /Unsubmit/);
  assert.match(fullPaperManagerMigration, /status in \('published', 'closed'\)/);
  assert.match(fullPaperManagerMigration, /create or replace function public\.unsubmit_owned_test_attempt/);
  assert.match(fullPaperManagerMigration, /assignment\.kind = 'paper'/);
  assert.match(fullPaperManagerMigration, /create or replace function public\.force_submit_owned_test_attempt/);
  assert.doesNotMatch(fullPaperManagerMigration, /questions_released_at is not null/);
});

test("teachers can key in and score a paper sheet for every assigned student", () => {
  assert.match(teacherEntryMigration, /create function public\.prepare_owned_paper_answer_entry/);
  assert.match(teacherEntryMigration, /member\.student_id = p_student_id/);
  assert.match(teacherEntryMigration, /set form_code = 'Version ' \|\| v_paper_version/);
  assert.match(teacherEntryMigration, /create function public\.save_owned_paper_answers/);
  assert.match(teacherEntryMigration, /public\.finalize_attempt_unchecked/);
  assert.match(teacherManager, /Enter answers/);
  assert.match(teacherEntry, /Save draft/);
  assert.match(teacherEntry, /Save & score/);
  assert.match(teacherEntry, /Save & rescore/);
  assert.match(closedTeacherEntryMigration, /status in \('published', 'closed'\)/);
  assert.match(closedTeacherEntryMigration, /status = 'closed' or questions_released_at is not null/);
  assert.match(publishedTeacherEntryMigration, /status in \('published', 'closed'\)/);
  assert.doesNotMatch(publishedTeacherEntryMigration, /questions_released_at is not null/);
  assert.match(teacherManager, /paperMode && \(live \|\| closed\)/);
  assert.match(teacherManager, /openPaperAnswerEntry \? overview\.students\[0\]/);
});

test("teacher results aggregate variants by logical slot and expose paper progress", () => {
  assert.match(resultsMigration, /attempt_question\.slot_position = slot\.position/);
  assert.match(resultsMigration, /response\.question_id = attempt_question\.question_id/);
  assert.match(resultsMigration, /'form_code', form_code/);
  assert.match(resultsMigration, /'answered_count', answered_count/);
});

test("paper imports support four coherent versions through UI, validation, and storage", () => {
  assert.match(importParser, /root\.versions\.length > 4/);
  assert.match(importParser, /expectedVersions > 4/);
  assert.match(assignmentBuilder, /useState\(\["", "", "", ""\]\)/);
  assert.match(assignmentBuilder, /files\.length > 4/);
  assert.match(fourVersionsMigration, /variant_index between 2 and 4/);
  assert.match(fourVersionsMigration, /v_version_count not between 1 and 4/);
});

test("the four paper forms stay aligned and retain the reviewed answer keys", () => {
  assert.equal(fourVersionAssessment.question_groups.length, 10);
  fourVersionAssessment.question_groups.forEach((group) => {
    assert.equal(group.length, 4);
    const signature = ({ type, difficulty, points, skills }) => ({ type, difficulty, points, primarySkill: skills.find((skill) => skill.is_primary)?.code });
    group.forEach((question) => {
      assert.deepEqual(signature(question), signature(group[0]));
      assert.equal(question.points, 1);
      assert.ok(["numeric", "multiple_choice"].includes(question.type));
      if (question.type === "multiple_choice") assert.equal(question.options.filter((option) => option.id === question.correct_answer).length, 1);
      else assert.equal(question.options, null);
    });
  });

  assert.deepEqual(fourVersionAssessment.question_groups[3].map((question) => question.prompt), [
    "Simplify $\\sqrt{8}+\\sqrt{50}$ into the form $a\\sqrt{b}$, where $a$ and $b$ are positive integers and $b$ has no square factor greater than $1$. What is $a+b$?",
    "Simplify $\\sqrt{18}+\\sqrt{32}$ into the form $a\\sqrt{b}$, where $a$ and $b$ are positive integers and $b$ has no square factor greater than $1$. What is $a+b$?",
    "Simplify $\\sqrt{12}+\\sqrt{27}$ into the form $a\\sqrt{b}$, where $a$ and $b$ are positive integers and $b$ has no square factor greater than $1$. What is $a+b$?",
    "Simplify $\\sqrt{20}+\\sqrt{45}$ into the form $a\\sqrt{b}$, where $a$ and $b$ are positive integers and $b$ has no square factor greater than $1$. What is $a+b$?",
  ]);
  assert.deepEqual(fourVersionAssessment.question_groups[6].map((question) => question.prompt), [
    "Solve $2(3x-4)+(x+4)=3(x+2)+2(x-1)$.",
    "Solve $3(2x+1)-2(x+4)=2(x+1)+(x-2)$.",
    "Solve $4(2x-1)-(x+3)=3(x+1)+2(x-2)$.",
    "Solve $3(3x-2)-2(x+1)=4(x-1)+(x+8)$.",
  ]);
  assert.deepEqual(fourVersionAssessment.question_groups.filter((group) => group[0].type === "numeric").map((group) => group.map((question) => question.correct_answer)), [
    ["-1", "-2", "-1", "-3"],
    ["9", "9", "8", "10"],
    ["2.9", "3.1", "3.7", "3.2"],
    ["5", "5", "5", "6"],
    ["4", "5", "3", "6"],
    ["10", "9", "7", "8"],
    ["6", "5", "7", "7"],
  ]);
  assert.deepEqual(fourVersionAssessment.question_groups.filter((group) => group[0].type === "multiple_choice").map((group) => group.map((question) => question.correct_answer)), [
    ["A", "A", "A", "A"],
    ["A", "A", "A", "A"],
    ["B", "B", "B", "B"],
  ]);
});
