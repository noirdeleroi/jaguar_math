import assert from "node:assert/strict";
import test from "node:test";
import { assignmentAllowsGraphingCalculator } from "../lib/assignment-tools.ts";

test("online homework and tests can enable the built-in graphing calculator", () => {
  assert.equal(assignmentAllowsGraphingCalculator("homework", true), true);
  assert.equal(assignmentAllowsGraphingCalculator("test", true), true);
});

test("teachers can disable the calculator and paper mode always disables it", () => {
  assert.equal(assignmentAllowsGraphingCalculator("homework", false), false);
  assert.equal(assignmentAllowsGraphingCalculator("test", false), false);
  assert.equal(assignmentAllowsGraphingCalculator("paper", true), false);
});
