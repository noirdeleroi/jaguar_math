export const GRAPH_LIMITS = {
  maxExpressionLength: 240,
  maxTokens: 320,
  maxDepth: 48,
  maxRows: 12,
  maxOperations: 1200,
} as const;

export type GraphViewport = { xMin: number; xMax: number; yMin: number; yMax: number };
export type GraphEnv = { x: number; y: number; constants: Record<string, number | undefined> };
export type GraphError = { message: string; index?: number };

export type ExprAst =
  | { type: "number"; value: number }
  | { type: "var"; name: string }
  | { type: "unary"; op: "+" | "-"; expr: ExprAst }
  | { type: "binary"; op: "+" | "-" | "*" | "/" | "^"; left: ExprAst; right: ExprAst }
  | { type: "call"; name: string; args: ExprAst[] };

export type ComparisonOperator = "=" | "<" | "<=" | ">" | ">=";
export type Restriction = { left: ExprAst; operator: Exclude<ComparisonOperator, "=">; right: ExprAst };

export type ParsedGraphExpression =
  | { kind: "empty" }
  | { kind: "explicit"; ast: ExprAst; restrictions: Restriction[] }
  | { kind: "vertical"; ast: ExprAst; restrictions: Restriction[] }
  | { kind: "point"; x: ExprAst; y: ExprAst; restrictions: Restriction[] }
  | { kind: "implicit"; left: ExprAst; right: ExprAst; operator: ComparisonOperator; restrictions: Restriction[] }
  | { kind: "definition"; name: string; ast: ExprAst }
  | { kind: "error"; error: GraphError };

type TokenKind = "number" | "ident" | "op" | "lparen" | "rparen" | "comma" | "eof";
type Token = { kind: TokenKind; value?: string; index: number };

const FUNCTIONS = new Set([
  "sin", "cos", "tan", "csc", "sec", "cot", "asin", "acos", "atan",
  "abs", "sqrt", "ln", "log", "exp", "floor", "ceil", "round", "min", "max",
]);

const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E };

function normalizeInput(input: string) {
  return input
    .trim()
    .replace(/[−–—]/g, "-")
    .replace(/[×·]/g, "*")
    .replace(/÷/g, "/")
    .replace(/π/g, "pi")
    .replace(/√\s*\(/g, "sqrt(")
    .replace(/≤/g, "<=")
    .replace(/≥/g, ">=")
    .replace(/\*\*/g, "^");
}

function isDigit(value: string) {
  return value >= "0" && value <= "9";
}

function isAlpha(value: string) {
  return /[A-Za-z_]/.test(value);
}

function tokenize(raw: string): { tokens?: Token[]; error?: GraphError } {
  const input = normalizeInput(raw);
  if (input.length > GRAPH_LIMITS.maxExpressionLength) {
    return { error: { message: `Expression is too long (maximum ${GRAPH_LIMITS.maxExpressionLength} characters).` } };
  }

  const tokens: Token[] = [];
  let index = 0;
  while (index < input.length) {
    const char = input[index]!;
    if (/\s/.test(char)) { index += 1; continue; }
    if (tokens.length >= GRAPH_LIMITS.maxTokens) return { error: { message: "Expression is too complex." } };

    if (isDigit(char) || (char === "." && isDigit(input[index + 1] ?? ""))) {
      const start = index;
      let value = char === "." ? "0." : char;
      let decimal = char === ".";
      index += 1;
      while (index < input.length) {
        const next = input[index]!;
        if (isDigit(next)) { value += next; index += 1; continue; }
        if (next === "." && !decimal && isDigit(input[index + 1] ?? "")) {
          decimal = true; value += next; index += 1; continue;
        }
        break;
      }
      tokens.push({ kind: "number", value, index: start });
      continue;
    }

    if (isAlpha(char)) {
      const start = index;
      index += 1;
      while (index < input.length && (isAlpha(input[index]!) || isDigit(input[index]!))) index += 1;
      tokens.push({ kind: "ident", value: input.slice(start, index).toLowerCase(), index: start });
      continue;
    }

    const singleKinds: Partial<Record<string, TokenKind>> = { "(": "lparen", ")": "rparen", ",": "comma" };
    const kind = singleKinds[char];
    if (kind) { tokens.push({ kind, index }); index += 1; continue; }
    if ("+-*/^".includes(char)) { tokens.push({ kind: "op", value: char, index }); index += 1; continue; }
    return { error: { message: `Unexpected symbol “${char}”.`, index } };
  }
  tokens.push({ kind: "eof", index: input.length });
  return { tokens: insertImplicitMultiplication(tokens) };
}

function insertImplicitMultiplication(tokens: Token[]) {
  const result: Token[] = [];
  const endsValue = (token: Token) => token.kind === "number" || token.kind === "ident" || token.kind === "rparen";
  const startsValue = (token: Token) => token.kind === "number" || token.kind === "ident" || token.kind === "lparen";
  for (let index = 0; index < tokens.length; index += 1) {
    const current = tokens[index]!;
    const next = tokens[index + 1];
    result.push(current);
    if (!next || next.kind === "eof" || !endsValue(current) || !startsValue(next)) continue;
    if (current.kind === "ident" && next.kind === "lparen" && FUNCTIONS.has(current.value ?? "")) continue;
    result.push({ kind: "op", value: "*", index: next.index });
  }
  return result;
}

class Parser {
  private position = 0;
  private depth = 0;
  private readonly tokens: Token[];

  constructor(tokens: Token[]) { this.tokens = tokens; }

  parse(): ExprAst {
    const ast = this.parseAddSub();
    if (this.peek().kind !== "eof") this.fail("Extra symbols after the expression.");
    return ast;
  }

  private peek() { return this.tokens[this.position]!; }
  private take() { return this.tokens[this.position++]!; }
  private fail(message: string, index = this.peek().index): never { throw { message, index } satisfies GraphError; }
  private guarded<T>(callback: () => T) {
    this.depth += 1;
    if (this.depth > GRAPH_LIMITS.maxDepth) this.fail("Expression is nested too deeply.");
    try { return callback(); } finally { this.depth -= 1; }
  }

  private parseAddSub(): ExprAst {
    let node = this.parseMulDiv();
    while (this.peek().kind === "op" && (this.peek().value === "+" || this.peek().value === "-")) {
      const operator = this.take().value as "+" | "-";
      node = { type: "binary", op: operator, left: node, right: this.parseMulDiv() };
    }
    return node;
  }

  private parseMulDiv(): ExprAst {
    let node = this.parseUnary();
    while (this.peek().kind === "op" && (this.peek().value === "*" || this.peek().value === "/")) {
      const operator = this.take().value as "*" | "/";
      node = { type: "binary", op: operator, left: node, right: this.parseUnary() };
    }
    return node;
  }

  private parseUnary(): ExprAst {
    const token = this.peek();
    if (token.kind === "op" && (token.value === "+" || token.value === "-")) {
      this.take();
      return this.guarded(() => ({ type: "unary", op: token.value as "+" | "-", expr: this.parseUnary() }));
    }
    return this.parsePower();
  }

  private parsePower(): ExprAst {
    let node = this.parsePrimary();
    if (this.peek().kind === "op" && this.peek().value === "^") {
      this.take();
      node = { type: "binary", op: "^", left: node, right: this.guarded(() => this.parseUnary()) };
    }
    return node;
  }

  private parsePrimary(): ExprAst {
    const token = this.peek();
    if (token.kind === "number") {
      this.take();
      const value = Number(token.value);
      if (!Number.isFinite(value)) this.fail("Invalid number.", token.index);
      return { type: "number", value };
    }
    if (token.kind === "ident") {
      this.take();
      const name = token.value ?? "";
      if (this.peek().kind !== "lparen") return { type: "var", name };
      if (!FUNCTIONS.has(name)) this.fail(`Unknown function “${name}”.`, token.index);
      this.take();
      const args: ExprAst[] = [];
      if (this.peek().kind !== "rparen") {
        while (true) {
          args.push(this.guarded(() => this.parseAddSub()));
          if (this.peek().kind !== "comma") break;
          this.take();
        }
      }
      if (this.peek().kind !== "rparen") this.fail("Missing closing parenthesis.");
      this.take();
      return { type: "call", name, args };
    }
    if (token.kind === "lparen") {
      this.take();
      const expression = this.guarded(() => this.parseAddSub());
      if (this.peek().kind !== "rparen") this.fail("Missing closing parenthesis.");
      this.take();
      return expression;
    }
    this.fail("Enter a number, variable, or parenthesized expression.");
  }
}

export function parseExpression(input: string): { ast?: ExprAst; error?: GraphError } {
  const tokenized = tokenize(input);
  if (!tokenized.tokens) return { error: tokenized.error };
  try { return { ast: new Parser(tokenized.tokens).parse() }; }
  catch (caught) {
    const value = caught as Partial<GraphError>;
    return { error: { message: typeof value?.message === "string" ? value.message : "Could not parse expression.", index: typeof value?.index === "number" ? value.index : undefined } };
  }
}

function findTopLevelRelations(input: string) {
  const relations: { index: number; operator: ComparisonOperator }[] = [];
  let depth = 0;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]!;
    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    else if (depth === 0) {
      const pair = input.slice(index, index + 2);
      if (pair === "<=" || pair === ">=") { relations.push({ index, operator: pair as ComparisonOperator }); index += 1; }
      else if (char === "=" || char === "<" || char === ">") relations.push({ index, operator: char as ComparisonOperator });
    }
  }
  return relations;
}

function findTopLevelRelation(input: string) {
  return findTopLevelRelations(input)[0] ?? null;
}

function splitPoint(input: string) {
  if (!input.startsWith("(") || !input.endsWith(")")) return null;
  const inside = input.slice(1, -1);
  let depth = 0;
  for (let index = 0; index < inside.length; index += 1) {
    const char = inside[index]!;
    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    else if (char === "," && depth === 0) return [inside.slice(0, index), inside.slice(index + 1)] as const;
  }
  return null;
}

function parseRestriction(input: string): { restrictions?: Restriction[]; error?: GraphError } {
  const relations = findTopLevelRelations(input);
  if (!relations.length || relations.length > 2 || relations.some((relation) => relation.operator === "=")) {
    return { error: { message: "Restrictions use one or two <, ≤, >, or ≥ comparisons." } };
  }
  const pieces: string[] = [];
  let cursor = 0;
  for (const relation of relations) {
    pieces.push(input.slice(cursor, relation.index));
    cursor = relation.index + relation.operator.length;
  }
  pieces.push(input.slice(cursor));
  const parsed = pieces.map((piece) => parseExpression(piece));
  const invalid = parsed.find((piece) => !piece.ast);
  if (invalid || parsed.some((piece) => !piece.ast)) return { error: invalid?.error ?? { message: "Invalid restriction." } };
  return {
    restrictions: relations.map((relation, index) => ({
      left: parsed[index]!.ast!,
      operator: relation.operator as Exclude<ComparisonOperator, "=">,
      right: parsed[index + 1]!.ast!,
    })),
  };
}

function extractRestrictions(raw: string) {
  const input = normalizeInput(raw);
  const restrictions: Restriction[] = [];
  const pattern = /\{([^{}]+)\}/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(input))) {
    for (const clause of match[1]!.split(/\s*(?:&&|;|\band\b)\s*/i).filter(Boolean)) {
      const parsed = parseRestriction(clause);
      if (!parsed.restrictions) return { base: "", restrictions, error: parsed.error };
      restrictions.push(...parsed.restrictions);
    }
  }
  const base = input.replace(pattern, "").trim();
  if (/[{}]/.test(base)) return { base, restrictions, error: { message: "Check the domain restriction braces." } };
  return { base, restrictions };
}

export function parseGraphExpression(raw: string): ParsedGraphExpression {
  if (!raw.trim()) return { kind: "empty" };
  const extracted = extractRestrictions(raw);
  if (extracted.error) return { kind: "error", error: extracted.error };
  const { base, restrictions } = extracted;

  const point = splitPoint(base);
  if (point) {
    const x = parseExpression(point[0]);
    const y = parseExpression(point[1]);
    if (!x.ast || !y.ast) return { kind: "error", error: x.error ?? y.error ?? { message: "Invalid point." } };
    return { kind: "point", x: x.ast, y: y.ast, restrictions };
  }

  const relation = findTopLevelRelation(base);
  if (!relation) {
    const parsed = parseExpression(base);
    return parsed.ast ? { kind: "explicit", ast: parsed.ast, restrictions } : { kind: "error", error: parsed.error ?? { message: "Invalid expression." } };
  }

  const leftText = base.slice(0, relation.index).trim();
  const rightText = base.slice(relation.index + relation.operator.length).trim();
  if (!leftText || !rightText) return { kind: "error", error: { message: "Both sides of the relation need an expression." } };
  const left = parseExpression(leftText);
  const right = parseExpression(rightText);
  if (!left.ast || !right.ast) return { kind: "error", error: left.error ?? right.error ?? { message: "Invalid relation." } };

  if (relation.operator === "=" && /^[a-zA-Z_]\w*$/.test(leftText) && !["x", "y", "pi", "e"].includes(leftText.toLowerCase())) {
    return { kind: "definition", name: leftText.toLowerCase(), ast: right.ast };
  }
  if (relation.operator === "=" && leftText.toLowerCase() === "y") return { kind: "explicit", ast: right.ast, restrictions };
  if (relation.operator === "=" && rightText.toLowerCase() === "y") return { kind: "explicit", ast: left.ast, restrictions };
  if (relation.operator === "=" && leftText.toLowerCase() === "x") return { kind: "vertical", ast: right.ast, restrictions };
  if (relation.operator === "=" && rightText.toLowerCase() === "x") return { kind: "vertical", ast: left.ast, restrictions };
  return { kind: "implicit", left: left.ast, right: right.ast, operator: relation.operator, restrictions };
}

export function evaluateExpression(ast: ExprAst, env: GraphEnv, maxOperations = GRAPH_LIMITS.maxOperations) {
  let operations = 0;
  const evaluate = (node: ExprAst): number => {
    operations += 1;
    if (operations > maxOperations) return Number.NaN;
    if (node.type === "number") return node.value;
    if (node.type === "var") {
      if (node.name === "x") return env.x;
      if (node.name === "y") return env.y;
      if (node.name in CONSTANTS) return CONSTANTS[node.name]!;
      const value = env.constants[node.name];
      return typeof value === "number" && Number.isFinite(value) ? value : Number.NaN;
    }
    if (node.type === "unary") {
      const value = evaluate(node.expr);
      return node.op === "-" ? -value : value;
    }
    if (node.type === "binary") {
      const left = evaluate(node.left);
      const right = evaluate(node.right);
      if (node.op === "+") return left + right;
      if (node.op === "-") return left - right;
      if (node.op === "*") return left * right;
      if (node.op === "/") return left / right;
      return Math.pow(left, right);
    }
    const args = node.args.map(evaluate);
    const first = args[0] ?? Number.NaN;
    switch (node.name) {
      case "sin": return Math.sin(first);
      case "cos": return Math.cos(first);
      case "tan": return Math.tan(first);
      case "csc": return 1 / Math.sin(first);
      case "sec": return 1 / Math.cos(first);
      case "cot": return 1 / Math.tan(first);
      case "asin": return Math.asin(first);
      case "acos": return Math.acos(first);
      case "atan": return Math.atan(first);
      case "abs": return Math.abs(first);
      case "sqrt": return Math.sqrt(first);
      case "ln": return Math.log(first);
      case "log": return args.length > 1 ? Math.log(first) / Math.log(args[1]!) : Math.log10(first);
      case "exp": return Math.exp(first);
      case "floor": return Math.floor(first);
      case "ceil": return Math.ceil(first);
      case "round": return Math.round(first);
      case "min": return Math.min(...args);
      case "max": return Math.max(...args);
      default: return Number.NaN;
    }
  };
  return evaluate(ast);
}

export function evaluateRestrictions(restrictions: Restriction[], env: GraphEnv) {
  return restrictions.every((restriction) => {
    const left = evaluateExpression(restriction.left, env);
    const right = evaluateExpression(restriction.right, env);
    if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
    if (restriction.operator === "<") return left < right;
    if (restriction.operator === "<=") return left <= right;
    if (restriction.operator === ">") return left > right;
    return left >= right;
  });
}

export function extractVariables(ast: ExprAst, output = new Set<string>()) {
  if (ast.type === "var") output.add(ast.name);
  else if (ast.type === "unary") extractVariables(ast.expr, output);
  else if (ast.type === "binary") { extractVariables(ast.left, output); extractVariables(ast.right, output); }
  else if (ast.type === "call") ast.args.forEach((argument) => extractVariables(argument, output));
  return output;
}

export function expressionVariables(parsed: ParsedGraphExpression) {
  const variables = new Set<string>();
  const add = (ast: ExprAst) => extractVariables(ast, variables);
  if (parsed.kind === "explicit" || parsed.kind === "vertical" || parsed.kind === "definition") add(parsed.ast);
  else if (parsed.kind === "point") { add(parsed.x); add(parsed.y); }
  else if (parsed.kind === "implicit") { add(parsed.left); add(parsed.right); }
  if ("restrictions" in parsed) parsed.restrictions.forEach((restriction) => { add(restriction.left); add(restriction.right); });
  ["x", "y", "pi", "e"].forEach((name) => variables.delete(name));
  return [...variables].sort();
}

export function expressionKindLabel(parsed: ParsedGraphExpression) {
  switch (parsed.kind) {
    case "empty": return "Empty expression";
    case "explicit": return "Function";
    case "vertical": return "Vertical line";
    case "point": return "Point";
    case "implicit": return parsed.operator === "=" ? "Implicit curve" : "Inequality";
    case "definition": return "Slider definition";
    case "error": return parsed.error.message;
  }
}

export function niceStep(range: number, targetTicks: number) {
  if (!Number.isFinite(range) || range <= 0) return 1;
  const rough = range / Math.max(1, targetTicks);
  const power = Math.pow(10, Math.floor(Math.log10(rough)));
  const normalized = rough / power;
  return (normalized < 1.5 ? 1 : normalized < 3 ? 2 : normalized < 7 ? 5 : 10) * power;
}

export function clampViewport(viewport: GraphViewport): GraphViewport {
  const minRange = 0.0001;
  const maxRange = 1_000_000;
  const xCenter = (viewport.xMin + viewport.xMax) / 2;
  const yCenter = (viewport.yMin + viewport.yMax) / 2;
  const xRange = Math.min(maxRange, Math.max(minRange, Math.abs(viewport.xMax - viewport.xMin)));
  const yRange = Math.min(maxRange, Math.max(minRange, Math.abs(viewport.yMax - viewport.yMin)));
  return { xMin: xCenter - xRange / 2, xMax: xCenter + xRange / 2, yMin: yCenter - yRange / 2, yMax: yCenter + yRange / 2 };
}
