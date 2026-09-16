export const DEFAULT_TOPIC_GRADE_FORMULA = "N + stars - skulls";

export type TopicGradeVariables = {
  N: number;
  stars: number;
  skulls: number;
};

type Token =
  | { type: "number"; value: number }
  | { type: "variable"; value: keyof TopicGradeVariables }
  | { type: "operator"; value: "+" | "-" | "*" | "/" | "(" | ")" };

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
      else throw new Error(`Unknown value “${identifier[0]}”. Use N, stars, or skulls.`);
      position += identifier[0].length;
      continue;
    }

    const operator = remaining[0];
    if (operator === "+" || operator === "-" || operator === "*" || operator === "/" || operator === "(" || operator === ")") {
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
    if (token.value === "(") {
      position += 1;
      const value = expression();
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

  const result = expression();
  if (position !== tokens.length) throw new Error("Check the order of values and operators in the formula.");
  if (!Number.isFinite(result)) throw new Error("The formula must produce a finite number.");
  return result;
}

export function normalizeTopicGradeFormula(formula: string) {
  const normalized = formula.trim().replace(/\s+/g, " ");
  if (normalized.length > 120) throw new Error("Keep the final-grade formula under 120 characters.");
  evaluateTopicGradeFormula(normalized, { N: 20, stars: 3, skulls: 1 });
  return normalized;
}

export function topicGradeFormulaUsesVariable(formula: string, variable: keyof TopicGradeVariables) {
  const normalizedVariable = variable.toLowerCase();
  return tokenize(formula).some((token) => token.type === "variable" && token.value.toLowerCase() === normalizedVariable);
}
