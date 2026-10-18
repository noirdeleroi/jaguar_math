"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import GraphCanvas from "./GraphCanvas";
import {
  GRAPH_LIMITS,
  evaluateExpression,
  expressionKindLabel,
  expressionVariables,
  parseGraphExpression,
  type GraphViewport,
} from "./engine";
import type { PlotRowInput } from "./plot.worker";
import styles from "./grapher.module.css";

type ExpressionRow = { id: string; expression: string; color: string; visible: boolean };
type SavedWorkspace = { version: 1; rows: ExpressionRow[]; sliders: Record<string, number>; viewport: GraphViewport };
type Props = { storageKey: string; onRequestClose: () => void };

const COLORS = ["#2368e8", "#db3f59", "#15966f", "#8b4bd8", "#e18418", "#0d91a5", "#d34d9b", "#475569"];
const DEFAULT_VIEWPORT: GraphViewport = { xMin: -10, xMax: 10, yMin: -10, yMax: 10 };
const EXAMPLES = [
  { label: "Parabola", value: "y=x^2-4" },
  { label: "Circle", value: "x^2+y^2=25" },
  { label: "Inequality", value: "y<=2x+3" },
  { label: "Point", value: "(3,-2)" },
  { label: "Restricted", value: "y=sqrt(x){x>=0}" },
];

function createId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `graph-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function newRow(index: number, expression = ""): ExpressionRow {
  return { id: createId(), expression, color: COLORS[index % COLORS.length]!, visible: true };
}

function validWorkspace(value: unknown): value is SavedWorkspace {
  if (!value || typeof value !== "object") return false;
  const workspace = value as Partial<SavedWorkspace>;
  return workspace.version === 1 && Array.isArray(workspace.rows) && workspace.rows.length <= GRAPH_LIMITS.maxRows
    && workspace.rows.every((row) => row && typeof row.id === "string" && typeof row.expression === "string" && row.expression.length <= GRAPH_LIMITS.maxExpressionLength && typeof row.color === "string" && typeof row.visible === "boolean")
    && Boolean(workspace.viewport && Object.values(workspace.viewport).every((entry) => typeof entry === "number" && Number.isFinite(entry)))
    && Boolean(workspace.sliders && typeof workspace.sliders === "object");
}

function initialWorkspace(storageKey: string): SavedWorkspace {
  if (typeof window !== "undefined") {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const parsed: unknown = JSON.parse(stored);
        if (validWorkspace(parsed)) return parsed.rows.length ? parsed : { ...parsed, rows: [newRow(0)] };
      }
    } catch { /* Browser storage is an enhancement, never a requirement. */ }
  }
  return { version: 1, rows: [newRow(0, "y=x^2-4"), newRow(1, "y=2x+3")], sliders: {}, viewport: DEFAULT_VIEWPORT };
}

export default function JaguarGrapher({ storageKey, onRequestClose }: Props) {
  const [initial] = useState(() => initialWorkspace(storageKey));
  const [rows, setRows] = useState<ExpressionRow[]>(initial.rows);
  const [sliders, setSliders] = useState<Record<string, number>>(initial.sliders);
  const [viewport, setViewport] = useState<GraphViewport>(initial.viewport);
  const [plotErrors, setPlotErrors] = useState<Record<string, string>>({});
  const [activeRowId, setActiveRowId] = useState<string | null>(null);
  const [examplesOpen, setExamplesOpen] = useState(false);
  const inputRefs = useRef(new Map<string, HTMLInputElement>());

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try { localStorage.setItem(storageKey, JSON.stringify({ version: 1, rows, sliders, viewport } satisfies SavedWorkspace)); }
      catch { /* Private browsing or storage pressure can disable persistence. */ }
    }, 180);
    return () => window.clearTimeout(timer);
  }, [rows, sliders, storageKey, viewport]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onRequestClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onRequestClose]);

  const parsedRows = useMemo(() => rows.map((row) => ({ row, parsed: parseGraphExpression(row.expression) })), [rows]);
  const definitionNames = useMemo(() => new Set(parsedRows.flatMap(({ parsed }) => parsed.kind === "definition" ? [parsed.name] : [])), [parsedRows]);
  const variableNames = useMemo(() => {
    const names = new Set<string>();
    parsedRows.forEach(({ parsed }) => expressionVariables(parsed).forEach((name) => names.add(name)));
    definitionNames.forEach((name) => names.add(name));
    return [...names].sort();
  }, [definitionNames, parsedRows]);

  const constants = useMemo(() => {
    const values: Record<string, number> = {};
    for (const name of variableNames) values[name] = Number.isFinite(sliders[name]) ? sliders[name]! : 1;
    for (const { parsed } of parsedRows) {
      if (parsed.kind !== "definition") continue;
      if (Number.isFinite(sliders[parsed.name])) { values[parsed.name] = sliders[parsed.name]!; continue; }
      const result = evaluateExpression(parsed.ast, { x: 0, y: 0, constants: values });
      values[parsed.name] = Number.isFinite(result) ? result : 1;
    }
    return values;
  }, [parsedRows, sliders, variableNames]);

  const plotRows = useMemo<PlotRowInput[]>(() => rows.map(({ id, expression, color, visible }) => ({ id, expression, color, visible })), [rows]);
  const updateRow = (id: string, patch: Partial<ExpressionRow>) => setRows((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row));
  const addRow = (expression = "") => setRows((current) => {
    if (current.length >= GRAPH_LIMITS.maxRows) return current;
    const row = newRow(current.length, expression);
    window.setTimeout(() => inputRefs.current.get(row.id)?.focus(), 0);
    setActiveRowId(row.id);
    return [...current, row];
  });

  const insertToken = (token: string, cursorBack = 0) => {
    const rowId = activeRowId ?? rows[0]?.id;
    if (!rowId) return;
    const input = inputRefs.current.get(rowId);
    const row = rows.find((item) => item.id === rowId);
    if (!row) return;
    const start = input?.selectionStart ?? row.expression.length;
    const end = input?.selectionEnd ?? start;
    const expression = `${row.expression.slice(0, start)}${token}${row.expression.slice(end)}`.slice(0, GRAPH_LIMITS.maxExpressionLength);
    updateRow(rowId, { expression });
    window.setTimeout(() => {
      const field = inputRefs.current.get(rowId);
      if (!field) return;
      const cursor = Math.max(0, start + token.length - cursorBack);
      field.focus(); field.setSelectionRange(cursor, cursor);
    }, 0);
  };

  const handleErrors = useCallback((errors: Record<string, string>) => setPlotErrors(errors), []);
  const clearWorkspace = () => {
    const row = newRow(0);
    setRows([row]); setSliders({}); setViewport(DEFAULT_VIEWPORT); setPlotErrors({}); setActiveRowId(row.id);
    window.setTimeout(() => inputRefs.current.get(row.id)?.focus(), 0);
  };

  return <section aria-label="Jaguar graphing calculator" aria-modal="false" className={styles.grapher} role="dialog">
    <header className={styles.header}>
      <div className={styles.brandMark} aria-hidden="true"><span>J</span></div>
      <div className={styles.titleBlock}><strong>Jaguar Grapher</strong><span>Graph freely. Nothing leaves this device.</span></div>
      <button aria-label="Close graphing calculator" className={styles.closeButton} onClick={onRequestClose} type="button">×</button>
    </header>

    <div className={styles.workspace}>
      <aside className={styles.expressionPanel}>
        <div className={styles.expressionToolbar}>
          <button className={styles.addButton} disabled={rows.length >= GRAPH_LIMITS.maxRows} onClick={() => addRow()} type="button"><span aria-hidden="true">＋</span> Expression</button>
          <div className={styles.exampleWrap}>
            <button aria-expanded={examplesOpen} className={styles.toolButton} onClick={() => setExamplesOpen((open) => !open)} type="button">Examples⌄</button>
            {examplesOpen && <div className={styles.exampleMenu}>{EXAMPLES.map((example) => <button key={example.label} onClick={() => { addRow(example.value); setExamplesOpen(false); }} type="button"><span>{example.label}</span><code>{example.value}</code></button>)}</div>}
          </div>
          <button className={styles.toolButton} onClick={clearWorkspace} type="button">Clear</button>
        </div>

        <div className={styles.rowList}>
          {parsedRows.map(({ row, parsed }, index) => {
            const error = parsed.kind === "error" ? parsed.error.message : plotErrors[row.id];
            return <article className={`${styles.expressionRow} ${activeRowId === row.id ? styles.activeRow : ""}`} key={row.id}>
              <button aria-label={`${row.visible ? "Hide" : "Show"} expression ${index + 1}`} className={styles.colorButton} onClick={() => updateRow(row.id, { visible: !row.visible })} style={{ "--row-color": row.color } as React.CSSProperties} type="button"><span className={row.visible ? "" : styles.hiddenColor} /></button>
              <span className={styles.rowNumber}>{index + 1}</span>
              <div className={styles.inputStack}>
                <input
                  aria-invalid={Boolean(error)}
                  aria-label={`Graph expression ${index + 1}`}
                  autoCapitalize="off"
                  autoComplete="off"
                  maxLength={GRAPH_LIMITS.maxExpressionLength}
                  onChange={(event) => updateRow(row.id, { expression: event.target.value })}
                  onFocus={() => setActiveRowId(row.id)}
                  placeholder="y=x², x=3, (2,4)…"
                  ref={(node) => { if (node) inputRefs.current.set(row.id, node); else inputRefs.current.delete(row.id); }}
                  spellCheck={false}
                  value={row.expression}
                />
                <span className={error ? styles.rowError : styles.rowKind}>{error ?? expressionKindLabel(parsed)}</span>
              </div>
              <button aria-label={`Delete expression ${index + 1}`} className={styles.deleteButton} disabled={rows.length === 1} onClick={() => setRows((current) => current.filter((item) => item.id !== row.id))} type="button">×</button>
            </article>;
          })}
        </div>

        {variableNames.length > 0 && <section className={styles.sliderSection} aria-label="Variable sliders">
          <div className={styles.sectionHeading}><strong>Sliders</strong><span>Explore parameters</span></div>
          {variableNames.map((name) => {
            const value = constants[name] ?? 1;
            return <label className={styles.slider} key={name}>
              <span><b>{name}</b><output>{Number(value.toFixed(2))}</output></span>
              <input max="10" min="-10" onChange={(event) => setSliders((current) => ({ ...current, [name]: Number(event.target.value) }))} step="0.1" type="range" value={Math.max(-10, Math.min(10, value))} />
            </label>;
          })}
        </section>}

        <div className={styles.keypad} aria-label="Math keypad">
          {["7", "8", "9", "÷", "sin()", "4", "5", "6", "×", "cos()", "1", "2", "3", "−", "tan()", "0", ".", "x", "+", "sqrt()", "(", ")", "y", "^", "abs()"].map((key) => {
            const token = key === "÷" ? "/" : key === "×" ? "*" : key === "−" ? "-" : key;
            const cursorBack = token.endsWith("()") ? 1 : 0;
            return <button key={key} onClick={() => insertToken(token, cursorBack)} type="button">{key === "sqrt()" ? "√" : key === "abs()" ? "|x|" : key.replace("()", "")}</button>;
          })}
        </div>
        <p className={styles.syntaxHelp}>Try <code>x^2+y^2=25</code>, <code>y&lt;=2x+3</code>, or <code>y=sin(x){`{x>=0}`}</code>.</p>
      </aside>
      <GraphCanvas constants={constants} onErrors={handleErrors} onViewportChange={setViewport} rows={plotRows} viewport={viewport} />
    </div>
  </section>;
}
