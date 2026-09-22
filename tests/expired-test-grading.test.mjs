import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../supabase/migrations/20260922133000_auto_score_expired_tests.sql", import.meta.url), "utf8");
const attemptPage = readFileSync(new URL("../app/teacher/assignments/[id]/attempts/[attemptId]/page.tsx", import.meta.url), "utf8");

test("expired tests finalize saved answers and record a time-expired event", () => {
  assert.match(migration, /effective_attempt_deadline\(attempt\.id\) <= now\(\)/);
  assert.match(migration, /finalize_attempt_unchecked\(v_attempt_id\)/);
  assert.match(migration, /values \(v_attempt_id, 'time_expired'\)/);
});

test("the teacher attempt review exposes explicit scoring for active tests", () => {
  assert.match(attemptPage, /action=\{forceSubmitTestAttempt\}/);
  assert.match(attemptPage, /Score saved answers now/);
  assert.match(attemptPage, /return_to_attempt/);
});
