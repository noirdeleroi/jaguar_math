import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_TOPIC_GRADE_FORMULA,
  clampTopicGrade,
  evaluateTopicFinalGradeFormula,
  evaluateTopicGradeFormula,
  isPassingTopicGrade,
  normalizeOptionalTopicGradeFormula,
  normalizeTopicGradeFormula,
  topicGradeFormulaUsesVariable,
} from "../lib/classroom-topic-grade.ts";

test("default topic grade adds raw summative points and stars, then subtracts skulls", () => {
  assert.equal(evaluateTopicGradeFormula(DEFAULT_TOPIC_GRADE_FORMULA, { N: 16, stars: 4, skulls: 2 }), 18);
});

test("final topic grades let skulls cancel stars without lowering the base grade", () => {
  const formula = "N + stars - skulls + 2";
  assert.equal(evaluateTopicFinalGradeFormula(formula, { N: 16, stars: 4, skulls: 2 }), 20);
  assert.equal(evaluateTopicFinalGradeFormula(formula, { N: 16, stars: 2, skulls: 5 }), 18);
  assert.equal(evaluateTopicFinalGradeFormula(formula, { N: 16, stars: 0, skulls: 5 }), 18);
});

test("custom topic grade formulas support constants, precedence, and parentheses", () => {
  assert.equal(evaluateTopicGradeFormula("(N + stars - skulls) / 2 + 2", { N: 18, stars: 3, skulls: 1 }), 12);
});

test("formula normalization accepts the common sculls misspelling", () => {
  assert.equal(normalizeTopicGradeFormula(" N + stars - sculls "), "N + stars - sculls");
});

test("an empty optional formula means the topic has no final grade", () => {
  assert.equal(normalizeOptionalTopicGradeFormula("   "), null);
  assert.equal(normalizeOptionalTopicGradeFormula(" N + stars "), "N + stars");
});

test("formula validation rejects unknown names and division by zero", () => {
  assert.throws(() => normalizeTopicGradeFormula("N + bonus"), /Unknown value/);
  assert.throws(() => normalizeTopicGradeFormula("N / (stars - stars)"), /divide by zero/);
});

test("formula variables can be detected before a summative score exists", () => {
  assert.equal(topicGradeFormulaUsesVariable("stars - skulls", "N"), false);
  assert.equal(topicGradeFormulaUsesVariable(DEFAULT_TOPIC_GRADE_FORMULA, "N"), true);
});

test("final topic grades are clamped between zero and the teacher maximum", () => {
  assert.equal(clampTopicGrade(24, 20), 20);
  assert.equal(clampTopicGrade(-3, 20), 0);
  assert.equal(clampTopicGrade(18.5, 20), 18.5);
});

test("65 percent is the inclusive passing threshold", () => {
  assert.equal(isPassingTopicGrade(13, 20), true);
  assert.equal(isPassingTopicGrade(12.99, 20), false);
});
