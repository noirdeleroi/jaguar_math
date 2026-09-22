import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../supabase/migrations/20260922150000_paper_assessments.sql", import.meta.url), "utf8");
const resultsMigration = readFileSync(new URL("../supabase/migrations/20260922153000_versioned_assignment_results.sql", import.meta.url), "utf8");
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
  assert.match(runner, /Enter answers only\./);
  assert.match(runner, /onChange=\{\(\) => save\(question\.id, option\.id\)\}/);
  assert.match(runner, /Submit paper answers/);
});

test("teacher results aggregate variants by logical slot and expose paper progress", () => {
  assert.match(resultsMigration, /attempt_question\.slot_position = slot\.position/);
  assert.match(resultsMigration, /response\.question_id = attempt_question\.question_id/);
  assert.match(resultsMigration, /'form_code', form_code/);
  assert.match(resultsMigration, /'answered_count', answered_count/);
});
