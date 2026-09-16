import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_TOPIC_GRADE_FORMULA,
  evaluateTopicGradeFormula,
  normalizeTopicGradeFormula,
  topicGradeFormulaUsesVariable,
} from "../lib/classroom-topic-grade.ts";

test("default topic grade adds raw summative points and stars, then subtracts skulls", () => {
  assert.equal(evaluateTopicGradeFormula(DEFAULT_TOPIC_GRADE_FORMULA, { N: 16, stars: 4, skulls: 2 }), 18);
});

test("custom topic grade formulas support constants, precedence, and parentheses", () => {
  assert.equal(evaluateTopicGradeFormula("(N + stars - skulls) / 2 + 2", { N: 18, stars: 3, skulls: 1 }), 12);
});

test("formula normalization accepts the common sculls misspelling", () => {
  assert.equal(normalizeTopicGradeFormula(" N + stars - sculls "), "N + stars - sculls");
});

test("formula validation rejects unknown names and division by zero", () => {
  assert.throws(() => normalizeTopicGradeFormula("N + bonus"), /Unknown value/);
  assert.throws(() => normalizeTopicGradeFormula("N / (stars - stars)"), /divide by zero/);
});

test("formula variables can be detected before a summative score exists", () => {
  assert.equal(topicGradeFormulaUsesVariable("stars - skulls", "N"), false);
  assert.equal(topicGradeFormulaUsesVariable(DEFAULT_TOPIC_GRADE_FORMULA, "N"), true);
});
