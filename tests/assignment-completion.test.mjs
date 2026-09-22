import assert from "node:assert/strict";
import test from "node:test";
import { assignmentResultStatus } from "../lib/assignment-completion.ts";

test("a submitted attempt remains completed while an optional retry is active", () => {
  assert.equal(assignmentResultStatus("in_progress", true), "submitted");
});

test("assignments without a submission keep their current activity status", () => {
  assert.equal(assignmentResultStatus("in_progress", false), "in_progress");
  assert.equal(assignmentResultStatus(undefined, false), "not_started");
});
