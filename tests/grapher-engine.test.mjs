import assert from "node:assert/strict";
import test from "node:test";

import {
  GRAPH_LIMITS,
  evaluateExpression,
  evaluateRestrictions,
  expressionVariables,
  parseExpression,
  parseGraphExpression,
} from "../app/components/grapher/engine.ts";

const env = { x: 0, y: 0, constants: {} };

test("graph parser follows standard exponent and unary precedence", () => {
  const negativeSquare = parseExpression("-2^2");
  const groupedSquare = parseExpression("(-2)^2");
  const negativeExponent = parseExpression("2^-2");
  assert.ok(negativeSquare.ast && groupedSquare.ast && negativeExponent.ast);
  assert.equal(evaluateExpression(negativeSquare.ast, env), -4);
  assert.equal(evaluateExpression(groupedSquare.ast, env), 4);
  assert.equal(evaluateExpression(negativeExponent.ast, env), 0.25);
});

test("graph parser supports implicit multiplication and common functions", () => {
  const parsed = parseExpression("2x+3sin(pi/2)");
  assert.ok(parsed.ast);
  assert.equal(evaluateExpression(parsed.ast, { ...env, x: 4 }), 11);
});

test("graph expressions classify SAT graphing forms", () => {
  assert.equal(parseGraphExpression("y=x^2-4").kind, "explicit");
  assert.equal(parseGraphExpression("x=3").kind, "vertical");
  assert.equal(parseGraphExpression("(2,-4)").kind, "point");
  assert.equal(parseGraphExpression("x^2+y^2=25").kind, "implicit");
  const inequality = parseGraphExpression("y<=2x+3");
  assert.equal(inequality.kind, "implicit");
  if (inequality.kind === "implicit") assert.equal(inequality.operator, "<=");
  assert.equal(parseGraphExpression("a=2").kind, "definition");
});

test("domain restrictions evaluate against the graph environment", () => {
  const parsed = parseGraphExpression("y=sqrt(x){x>=0}");
  assert.equal(parsed.kind, "explicit");
  if (parsed.kind !== "explicit") return;
  assert.equal(evaluateRestrictions(parsed.restrictions, { ...env, x: 3 }), true);
  assert.equal(evaluateRestrictions(parsed.restrictions, { ...env, x: -1 }), false);

  const chained = parseGraphExpression("y=x^2{0<=x<=4}");
  assert.equal(chained.kind, "explicit");
  if (chained.kind !== "explicit") return;
  assert.equal(evaluateRestrictions(chained.restrictions, { ...env, x: 2 }), true);
  assert.equal(evaluateRestrictions(chained.restrictions, { ...env, x: 5 }), false);
});

test("free variables become sliders while x and y stay graph axes", () => {
  const parsed = parseGraphExpression("y=a*x+b");
  assert.deepEqual(expressionVariables(parsed), ["a", "b"]);
});

test("parser rejects oversized and deeply nested hostile input", () => {
  const oversized = parseExpression("1".repeat(GRAPH_LIMITS.maxExpressionLength + 1));
  assert.match(oversized.error?.message ?? "", /too long/i);
  const nested = parseExpression(`${"(".repeat(GRAPH_LIMITS.maxDepth + 5)}1${")".repeat(GRAPH_LIMITS.maxDepth + 5)}`);
  assert.match(nested.error?.message ?? "", /deep/i);
});

test("unsupported syntax and malformed restrictions fail safely", () => {
  assert.equal(parseGraphExpression("x+[1]").kind, "error");
  assert.equal(parseGraphExpression("y=x^2{x=2}").kind, "error");
});
