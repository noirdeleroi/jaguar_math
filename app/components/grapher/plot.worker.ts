/// <reference lib="webworker" />

import {
  evaluateExpression,
  evaluateRestrictions,
  parseGraphExpression,
  type GraphEnv,
  type GraphViewport,
  type ParsedGraphExpression,
} from "./engine";

export type PlotRowInput = { id: string; expression: string; color: string; visible: boolean };
export type PlotRequest = {
  requestId: number;
  width: number;
  height: number;
  viewport: GraphViewport;
  rows: PlotRowInput[];
  constants: Record<string, number>;
};

export type PlotPath = { rowId: string; color: string; points: number[]; closed?: boolean };
export type PlotFill = { rowId: string; color: string; rectangles: number[] };
export type PlotPoint = { rowId: string; color: string; x: number; y: number; label?: string; kind: "point" | "root" | "intercept" | "intersection" };
export type PlotResponse = { requestId: number; paths: PlotPath[]; fills: PlotFill[]; points: PlotPoint[]; errors: Record<string, string> };

const workerScope = self as unknown as DedicatedWorkerGlobalScope;

function toScreen(x: number, y: number, width: number, height: number, viewport: GraphViewport) {
  return {
    x: ((x - viewport.xMin) / (viewport.xMax - viewport.xMin)) * width,
    y: ((viewport.yMax - y) / (viewport.yMax - viewport.yMin)) * height,
  };
}

function fromGrid(column: number, row: number, columns: number, rows: number, viewport: GraphViewport) {
  return {
    x: viewport.xMin + (column / columns) * (viewport.xMax - viewport.xMin),
    y: viewport.yMax - (row / rows) * (viewport.yMax - viewport.yMin),
  };
}

function finite(value: number) {
  return Number.isFinite(value) && Math.abs(value) < 1e12;
}

function graphExplicit(
  row: PlotRowInput,
  parsed: Extract<ParsedGraphExpression, { kind: "explicit" }>,
  request: PlotRequest,
) {
  const paths: PlotPath[] = [];
  const roots: PlotPoint[] = [];
  const samples = Math.max(360, Math.min(1500, Math.round(request.width * 1.65)));
  const xRange = request.viewport.xMax - request.viewport.xMin;
  const yRange = request.viewport.yMax - request.viewport.yMin;
  let current: number[] = [];
  let previous: { x: number; y: number } | null = null;

  const flush = () => {
    if (current.length >= 4) paths.push({ rowId: row.id, color: row.color, points: current });
    current = [];
  };

  const valueAt = (x: number) => {
    const baseEnv: GraphEnv = { x, y: 0, constants: request.constants };
    const y = evaluateExpression(parsed.ast, baseEnv);
    if (!evaluateRestrictions(parsed.restrictions, { ...baseEnv, y })) return Number.NaN;
    return y;
  };

  for (let index = 0; index <= samples; index += 1) {
    const x = request.viewport.xMin + (index / samples) * xRange;
    const y = valueAt(x);
    const discontinuity = previous && finite(y) && Math.abs(y - previous.y) > yRange * 2.2;
    if (!finite(y) || discontinuity) {
      flush(); previous = finite(y) ? { x, y } : null; continue;
    }
    const screen = toScreen(x, y, request.width, request.height, request.viewport);
    if (screen.y < -request.height * 4 || screen.y > request.height * 5) { flush(); previous = { x, y }; continue; }
    current.push(screen.x, screen.y);

    if (previous && ((previous.y <= 0 && y >= 0) || (previous.y >= 0 && y <= 0)) && Math.abs(previous.y - y) < yRange) {
      let left = previous.x;
      let right = x;
      let leftValue = previous.y;
      for (let iteration = 0; iteration < 18; iteration += 1) {
        const middle = (left + right) / 2;
        const middleValue = valueAt(middle);
        if (!finite(middleValue)) break;
        if ((leftValue <= 0 && middleValue >= 0) || (leftValue >= 0 && middleValue <= 0)) right = middle;
        else { left = middle; leftValue = middleValue; }
      }
      const rootX = (left + right) / 2;
      if (!roots.some((root) => Math.abs(root.x - rootX) < xRange / 250)) roots.push({ rowId: row.id, color: row.color, x: rootX, y: 0, kind: "root" });
    }
    previous = { x, y };
  }
  flush();

  if (request.viewport.xMin <= 0 && request.viewport.xMax >= 0) {
    const y = valueAt(0);
    if (finite(y) && y >= request.viewport.yMin && y <= request.viewport.yMax && !roots.some((point) => Math.abs(point.y - y) < yRange / 250)) {
      roots.push({ rowId: row.id, color: row.color, x: 0, y, kind: "intercept" });
    }
  }
  return { paths, points: roots, valueAt };
}

function contourAndFill(
  row: PlotRowInput,
  parsed: Extract<ParsedGraphExpression, { kind: "implicit" }>,
  request: PlotRequest,
) {
  const columns = Math.max(64, Math.min(170, Math.round(request.width / 5)));
  const rows = Math.max(48, Math.min(130, Math.round(request.height / 5)));
  const values = new Float64Array((columns + 1) * (rows + 1));
  const allowed = new Uint8Array((columns + 1) * (rows + 1));
  const at = (column: number, gridRow: number) => gridRow * (columns + 1) + column;

  for (let gridRow = 0; gridRow <= rows; gridRow += 1) {
    for (let column = 0; column <= columns; column += 1) {
      const math = fromGrid(column, gridRow, columns, rows, request.viewport);
      const env = { ...math, constants: request.constants };
      allowed[at(column, gridRow)] = evaluateRestrictions(parsed.restrictions, env) ? 1 : 0;
      values[at(column, gridRow)] = evaluateExpression(parsed.left, env) - evaluateExpression(parsed.right, env);
    }
  }

  const paths: PlotPath[] = [];
  const rectangles: number[] = [];
  const isInside = (value: number) => parsed.operator === "<" || parsed.operator === "<=" ? value < 0 : value > 0;
  const inequality = parsed.operator !== "=";

  if (inequality) {
    const cellWidth = request.width / columns;
    const cellHeight = request.height / rows;
    for (let gridRow = 0; gridRow < rows; gridRow += 1) {
      let runStart = -1;
      for (let column = 0; column <= columns; column += 1) {
        const inside = column < columns && allowed[at(column, gridRow)] && isInside(values[at(column, gridRow)]!);
        if (inside && runStart < 0) runStart = column;
        if ((!inside || column === columns) && runStart >= 0) {
          rectangles.push(runStart * cellWidth, gridRow * cellHeight, (column - runStart) * cellWidth + 0.7, cellHeight + 0.7);
          runStart = -1;
        }
      }
    }
  }

  const interpolate = (a: { x: number; y: number }, b: { x: number; y: number }, aValue: number, bValue: number) => {
    const denominator = aValue - bValue;
    const amount = Math.abs(denominator) < 1e-12 ? 0.5 : Math.max(0, Math.min(1, aValue / denominator));
    return { x: a.x + (b.x - a.x) * amount, y: a.y + (b.y - a.y) * amount };
  };

  for (let gridRow = 0; gridRow < rows; gridRow += 1) {
    for (let column = 0; column < columns; column += 1) {
      const indexes = [at(column, gridRow), at(column + 1, gridRow), at(column + 1, gridRow + 1), at(column, gridRow + 1)];
      if (indexes.some((index) => !allowed[index] || !finite(values[index]!))) continue;
      const corners = [
        fromGrid(column, gridRow, columns, rows, request.viewport),
        fromGrid(column + 1, gridRow, columns, rows, request.viewport),
        fromGrid(column + 1, gridRow + 1, columns, rows, request.viewport),
        fromGrid(column, gridRow + 1, columns, rows, request.viewport),
      ];
      const crossings: { x: number; y: number }[] = [];
      const edges = [[0, 1], [1, 2], [2, 3], [3, 0]] as const;
      for (const [a, b] of edges) {
        const aValue = values[indexes[a]]!;
        const bValue = values[indexes[b]]!;
        if ((aValue <= 0 && bValue > 0) || (aValue > 0 && bValue <= 0)) crossings.push(interpolate(corners[a]!, corners[b]!, aValue, bValue));
      }
      if (crossings.length < 2) continue;
      for (let index = 0; index + 1 < crossings.length; index += 2) {
        const start = toScreen(crossings[index]!.x, crossings[index]!.y, request.width, request.height, request.viewport);
        const end = toScreen(crossings[index + 1]!.x, crossings[index + 1]!.y, request.width, request.height, request.viewport);
        paths.push({ rowId: row.id, color: row.color, points: [start.x, start.y, end.x, end.y] });
      }
    }
  }
  return { paths, fill: rectangles.length ? { rowId: row.id, color: row.color, rectangles } : null };
}

function findIntersections(
  explicit: { row: PlotRowInput; valueAt: (x: number) => number }[],
  request: PlotRequest,
) {
  const points: PlotPoint[] = [];
  const xRange = request.viewport.xMax - request.viewport.xMin;
  const yRange = request.viewport.yMax - request.viewport.yMin;
  const samples = Math.max(180, Math.min(700, Math.round(request.width)));
  for (let first = 0; first < explicit.length; first += 1) {
    for (let second = first + 1; second < explicit.length; second += 1) {
      const a = explicit[first]!;
      const b = explicit[second]!;
      let previousX = request.viewport.xMin;
      let previousDifference = a.valueAt(previousX) - b.valueAt(previousX);
      for (let index = 1; index <= samples; index += 1) {
        const x = request.viewport.xMin + (index / samples) * xRange;
        const difference = a.valueAt(x) - b.valueAt(x);
        if (finite(previousDifference) && finite(difference) && ((previousDifference <= 0 && difference >= 0) || (previousDifference >= 0 && difference <= 0))) {
          let left = previousX;
          let right = x;
          let leftDifference = previousDifference;
          for (let iteration = 0; iteration < 16; iteration += 1) {
            const middle = (left + right) / 2;
            const middleDifference = a.valueAt(middle) - b.valueAt(middle);
            if (!finite(middleDifference)) break;
            if ((leftDifference <= 0 && middleDifference >= 0) || (leftDifference >= 0 && middleDifference <= 0)) right = middle;
            else { left = middle; leftDifference = middleDifference; }
          }
          const resultX = (left + right) / 2;
          const resultY = a.valueAt(resultX);
          if (finite(resultY) && resultY >= request.viewport.yMin && resultY <= request.viewport.yMax && !points.some((point) => Math.abs(point.x - resultX) < xRange / 200 && Math.abs(point.y - resultY) < yRange / 200)) {
            points.push({ rowId: `${a.row.id}:${b.row.id}`, color: "#0f172a", x: resultX, y: resultY, kind: "intersection" });
          }
        }
        previousX = x;
        previousDifference = difference;
      }
    }
  }
  return points.slice(0, 40);
}

workerScope.onmessage = (event: MessageEvent<PlotRequest>) => {
  const request = event.data;
  const paths: PlotPath[] = [];
  const fills: PlotFill[] = [];
  const points: PlotPoint[] = [];
  const errors: Record<string, string> = {};
  const explicit: { row: PlotRowInput; valueAt: (x: number) => number }[] = [];

  for (const row of request.rows.slice(0, 12)) {
    if (!row.visible || !row.expression.trim()) continue;
    const parsed = parseGraphExpression(row.expression);
    if (parsed.kind === "error") { errors[row.id] = parsed.error.message; continue; }
    if (parsed.kind === "explicit") {
      const result = graphExplicit(row, parsed, request);
      paths.push(...result.paths); points.push(...result.points); explicit.push({ row, valueAt: result.valueAt });
    } else if (parsed.kind === "vertical") {
      const value = evaluateExpression(parsed.ast, { x: 0, y: 0, constants: request.constants });
      if (finite(value)) {
        const samples = 420;
        let current: number[] = [];
        const flush = () => { if (current.length >= 4) paths.push({ rowId: row.id, color: row.color, points: current }); current = []; };
        for (let index = 0; index <= samples; index += 1) {
          const y = request.viewport.yMin + (index / samples) * (request.viewport.yMax - request.viewport.yMin);
          if (!evaluateRestrictions(parsed.restrictions, { x: value, y, constants: request.constants })) { flush(); continue; }
          const screen = toScreen(value, y, request.width, request.height, request.viewport);
          current.push(screen.x, screen.y);
        }
        flush();
      }
    } else if (parsed.kind === "point") {
      const env = { x: 0, y: 0, constants: request.constants };
      const x = evaluateExpression(parsed.x, env);
      const y = evaluateExpression(parsed.y, env);
      if (finite(x) && finite(y) && evaluateRestrictions(parsed.restrictions, { x, y, constants: request.constants })) {
        points.push({ rowId: row.id, color: row.color, x, y, kind: "point", label: `(${format(x)}, ${format(y)})` });
      }
    } else if (parsed.kind === "implicit") {
      const result = contourAndFill(row, parsed, request);
      paths.push(...result.paths);
      if (result.fill) fills.push(result.fill);
    }
  }
  points.push(...findIntersections(explicit, request));
  workerScope.postMessage({ requestId: request.requestId, paths, fills, points: points.slice(0, 80), errors } satisfies PlotResponse);
};

function format(value: number) {
  if (Math.abs(value) < 1e-9) return "0";
  return Number(value.toPrecision(5)).toString();
}

export {};
