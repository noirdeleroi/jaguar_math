import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../supabase/migrations/20260922150000_paper_assessments.sql", import.meta.url), "utf8");
const resultsMigration = readFileSync(new URL("../supabase/migrations/20260922153000_versioned_assignment_results.sql", import.meta.url), "utf8");
const fourVersionsMigration = readFileSync(new URL("../supabase/migrations/20260922170000_four_assessment_versions.sql", import.meta.url), "utf8");
const importParser = readFileSync(new URL("../lib/assignment-import.ts", import.meta.url), "utf8");
const assignmentBuilder = readFileSync(new URL("../app/teacher/assignments/assignment-builder.tsx", import.meta.url), "utf8");
const fourVersionAssessment = JSON.parse(readFileSync(new URL("../data/assessment-imports/algebra-foundations-linear-equations-paper-test-10q-4v.json", import.meta.url), "utf8"));
const studentPage = readFileSync(new URL("../app/student/assignments/[id]/page.tsx", import.meta.url), "utf8");
const runner = readFileSync(new URL("../app/student/assignments/assessment-runner.tsx", import.meta.url), "utf8");

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
  assert.deepEqual(fourVersionAssessment.question_groups.filter((group) => group[0].type === "numeric").map((group) => group.map((question) => question.correct_answer)), [
    ["-1", "-2", "-1", "-3"],
    ["9", "9", "8", "10"],
    ["2.9", "3.1", "3.7", "3.2"],
    ["5", "5", "5", "6"],
    ["7", "6", "8", "5"],
    ["10", "9", "7", "8"],
    ["6", "5", "7", "7"],
  ]);
  assert.deepEqual(fourVersionAssessment.question_groups.filter((group) => group[0].type === "multiple_choice").map((group) => group.map((question) => question.correct_answer)), [
    ["A", "A", "A", "A"],
    ["A", "A", "A", "A"],
    ["B", "B", "B", "B"],
  ]);
});
