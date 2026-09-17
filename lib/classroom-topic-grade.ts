export const DEFAULT_TOPIC_GRADE_FORMULA = "N + max(stars - skulls, 0) + if(HW >= 10, 2, 0)";

export type TopicGradeVariables = {
  N: number;
  stars: number;
  skulls: number;
  HW: number;
};

type FormulaFunction = "max" | "min" | "if";
type FormulaOperator = "+" | "-" | "*" | "/" | "(" | ")" | "," | ">" | ">=" | "<" | "<=" | "==" | "!=";

type Token =
  | { type: "number"; value: number }
  | { type: "variable"; value: keyof TopicGradeVariables }
  | { type: "function"; value: FormulaFunction }
  | { type: "operator"; value: FormulaOperator };

function tokenize(formula: string): Token[] {
  const tokens: Token[] = [];
  let position = 0;

  while (position < formula.length) {
    const remaining = formula.slice(position);
    const whitespace = remaining.match(/^\s+/);
    if (whitespace) {
      position += whitespace[0].length;
      continue;
    }

    const number = remaining.match(/^(?:\d+(?:\.\d*)?|\.\d+)/);
    if (number) {
      tokens.push({ type: "number", value: Number(number[0]) });
      position += number[0].length;
      continue;
    }

    const identifier = remaining.match(/^[A-Za-z]+/);
    if (identifier) {
      const normalized = identifier[0].toLowerCase();
      if (normalized === "n") tokens.push({ type: "variable", value: "N" });
      else if (normalized === "stars" || normalized === "star") tokens.push({ type: "variable", value: "stars" });
      else if (normalized === "skulls" || normalized === "skull" || normalized === "sculls" || normalized === "scull") tokens.push({ type: "variable", value: "skulls" });
      else if (normalized === "hw" || normalized === "homework") tokens.push({ type: "variable", value: "HW" });
      else if (normalized === "max" || normalized === "min" || normalized === "if") tokens.push({ type: "function", value: normalized });
      else throw new Error(`Unknown value “${identifier[0]}”. Use N, stars, skulls, HW, max, min, or if.`);
      position += identifier[0].length;
      continue;
    }

    const doubleOperator = remaining.slice(0, 2);
    if (doubleOperator === ">=" || doubleOperator === "<=" || doubleOperator === "==" || doubleOperator === "!=") {
      tokens.push({ type: "operator", value: doubleOperator });
      position += 2;
      continue;
    }

    const operator = remaining[0] as FormulaOperator;
    if (["+", "-", "*", "/", "(", ")", ",", ">", "<"].includes(operator)) {
      tokens.push({ type: "operator", value: operator });
      position += 1;
      continue;
    }

    throw new Error(`“${operator}” is not allowed in a final-grade formula.`);
  }

  if (!tokens.length) throw new Error("Enter a final-grade formula.");
  return tokens;
}

export function evaluateTopicGradeFormula(formula: string, variables: TopicGradeVariables) {
  const tokens = tokenize(formula);
  let position = 0;

  function primary(): number {
    const token = tokens[position];
    if (!token) throw new Error("The formula ends unexpectedly.");
    if (token.type === "number") {
      position += 1;
      return token.value;
    }
    if (token.type === "variable") {
      position += 1;
      return variables[token.value];
    }
    if (token.type === "function") {
      position += 1;
      const opening = tokens[position];
      if (opening?.type !== "operator" || opening.value !== "(") throw new Error(`Add parentheses after ${token.value}.`);
      position += 1;
      const argumentsList: number[] = [];
      const immediateClosing = tokens[position];
      if (immediateClosing?.type !== "operator" || immediateClosing.value !== ")") {
        argumentsList.push(comparison());
        while (tokens[position]?.type === "operator" && tokens[position].value === ",") {
          position += 1;
          argumentsList.push(comparison());
        }
      }
      const closing = tokens[position];
      if (closing?.type !== "operator" || closing.value !== ")") throw new Error(`Close the ${token.value} function with a parenthesis.`);
      position += 1;
      if ((token.value === "max" || token.value === "min") && argumentsList.length !== 2) throw new Error(`${token.value} needs exactly two values.`);
      if (token.value === "if" && argumentsList.length !== 3) throw new Error("if needs a condition, a true value, and a false value.");
      if (token.value === "max") return Math.max(argumentsList[0], argumentsList[1]);
      if (token.value === "min") return Math.min(argumentsList[0], argumentsList[1]);
      return argumentsList[0] !== 0 ? argumentsList[1] : argumentsList[2];
    }
    if (token.value === "(") {
      position += 1;
      const value = comparison();
      const closing = tokens[position];
      if (closing?.type !== "operator" || closing.value !== ")") throw new Error("Close every parenthesis in the formula.");
      position += 1;
      return value;
    }
    throw new Error("A number or grade value is expected here.");
  }

  function unary(): number {
    const token = tokens[position];
    if (token?.type === "operator" && (token.value === "+" || token.value === "-")) {
      position += 1;
      const value = unary();
      return token.value === "-" ? -value : value;
    }
    return primary();
  }

  function term(): number {
    let value = unary();
    while (tokens[position]?.type === "operator" && (tokens[position].value === "*" || tokens[position].value === "/")) {
      const operator = tokens[position].value;
      position += 1;
      const right = unary();
      if (operator === "/" && right === 0) throw new Error("The formula cannot divide by zero.");
      value = operator === "*" ? value * right : value / right;
    }
    return value;
  }

  function expression(): number {
    let value = term();
    while (tokens[position]?.type === "operator" && (tokens[position].value === "+" || tokens[position].value === "-")) {
      const operator = tokens[position].value;
      position += 1;
      const right = term();
      value = operator === "+" ? value + right : value - right;
    }
    return value;
  }

  function comparison(): number {
    const left = expression();
    const token = tokens[position];
    if (token?.type !== "operator" || ![">", ">=", "<", "<=", "==", "!="].includes(token.value)) return left;
    position += 1;
    const right = expression();
    if (token.value === ">") return left > right ? 1 : 0;
    if (token.value === ">=") return left >= right ? 1 : 0;
    if (token.value === "<") return left < right ? 1 : 0;
    if (token.value === "<=") return left <= right ? 1 : 0;
    if (token.value === "==") return left === right ? 1 : 0;
    return left !== right ? 1 : 0;
  }

  const result = comparison();
  if (position !== tokens.length) throw new Error("Check the order of values and operators in the formula.");
  if (!Number.isFinite(result)) throw new Error("The formula must produce a finite number.");
  return result;
}

export function evaluateTopicFinalGradeFormula(formula: string, variables: TopicGradeVariables) {
  return evaluateTopicGradeFormula(formula, variables);
}

export function calculateHomeworkCompletionPercentage(completed: number, assigned: number) {
  if (!Number.isFinite(completed) || !Number.isFinite(assigned) || completed < 0 || assigned < 0 || completed > assigned) {
    throw new Error("Homework completion totals are invalid.");
  }
  return assigned === 0 ? 0 : Math.round(completed / assigned * 10000) / 100;
}

export function clampTopicGrade(value: number, maximum: number) {
  if (!Number.isFinite(value)) throw new Error("The final grade must be a finite number.");
  if (!Number.isFinite(maximum) || maximum <= 0) throw new Error("The final-grade maximum must be greater than zero.");
  return Math.min(maximum, Math.max(0, value));
}

export function normalizeTopicGradeFormula(formula: string) {
  const normalized = formula.trim().replace(/\s+/g, " ");
  if (normalized.length > 120) throw new Error("Keep the final-grade formula under 120 characters.");
  evaluateTopicGradeFormula(normalized, { N: 20, stars: 3, skulls: 1, HW: 80 });
  return normalized;
}

export function normalizeOptionalTopicGradeFormula(formula: string) {
  return formula.trim() ? normalizeTopicGradeFormula(formula) : null;
}

export function isPassingTopicGrade(grade: number, maximum: number) {
  return Number.isFinite(grade) && Number.isFinite(maximum) && maximum > 0 && grade / maximum >= 0.65;
}

export function topicGradeFormulaUsesVariable(formula: string, variable: keyof TopicGradeVariables) {
  const normalizedVariable = variable.toLowerCase();
  return tokenize(formula).some((token) => token.type === "variable" && token.value.toLowerCase() === normalizedVariable);
}
