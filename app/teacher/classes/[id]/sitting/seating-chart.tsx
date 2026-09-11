"use client";

import { useActionState, useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type PointerEvent } from "react";
import { saveSeatingChart, type SeatingChartSaveState } from "./actions";
import styles from "./sitting-chart.module.css";

type Student = { id: string; name: string };
type Position = { id: string; x: number; y: number };
type ChartStudent = Position & { guest?: true; name?: string };
type TableShape = "rectangle" | "oval";
type ChartTable = Position & { shape: TableShape; width: number; height: number };
type Layout = { version: 1; tables: ChartTable[]; students: ChartStudent[] };
type Selection = { tableIds: string[]; studentIds: string[] };
type DragTarget = { pointerId: number; startX: number; startY: number; tables: Position[]; students: Position[] };
type DrawingTarget = { pointerId: number; shape: TableShape; startX: number; startY: number };
type SelectionBox = { pointerId: number; startX: number; startY: number; currentX: number; currentY: number; base: Selection };

const BOARD_ASPECT_RATIO = 16 / 9;
const DEFAULT_TABLE_WIDTH = 13;
const DEFAULT_TABLE_HEIGHT = DEFAULT_TABLE_WIDTH * BOARD_ASPECT_RATIO;
const MINIMUM_TABLE_SIZE = 4;

const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value));

function defaultStudentPosition(index: number, total: number) {
  const columns = Math.min(6, Math.max(1, total));
  const rows = Math.max(1, Math.ceil(total / columns));
  const column = index % columns;
  const row = Math.floor(index / columns);
  return { x: columns === 1 ? 50 : 10 + (column * 80) / (columns - 1), y: rows === 1 ? 72 : 62 + (row * 28) / (rows - 1) };
}

function normalizeTable(value: Position & Partial<ChartTable>): ChartTable {
  const width = Number.isFinite(value.width) ? clamp(value.width!, MINIMUM_TABLE_SIZE, 90) : DEFAULT_TABLE_WIDTH;
  const height = Number.isFinite(value.height) ? clamp(value.height!, MINIMUM_TABLE_SIZE, 90) : DEFAULT_TABLE_HEIGHT;
  return {
    id: value.id,
    shape: value.shape === "rectangle" ? "rectangle" : "oval",
    width,
    height,
    x: clamp(value.x, width / 2, 100 - width / 2),
    y: clamp(value.y, height / 2, 100 - height / 2),
  };
}

function tableFromPoints(shape: TableShape, startX: number, startY: number, endX: number, endY: number, constrain: boolean): Omit<ChartTable, "id"> {
  let horizontal = endX - startX;
  let vertical = endY - startY;
  if (constrain) {
    const height = Math.max(Math.abs(vertical), Math.abs(horizontal) * BOARD_ASPECT_RATIO, MINIMUM_TABLE_SIZE * BOARD_ASPECT_RATIO);
    horizontal = (horizontal || 1) < 0 ? -height / BOARD_ASPECT_RATIO : height / BOARD_ASPECT_RATIO;
    vertical = (vertical || 1) < 0 ? -height : height;
  }
  const width = Math.max(MINIMUM_TABLE_SIZE, Math.abs(horizontal));
  const height = Math.max(MINIMUM_TABLE_SIZE, Math.abs(vertical));
  return normalizeTable({
    id: "",
    shape,
    width,
    height,
    x: startX + horizontal / 2,
    y: startY + vertical / 2,
  });
}

function createInitialLayout(value: unknown, students: Student[]): Layout {
  const candidate = value && typeof value === "object" ? value as Partial<Layout> : null;
  const validPosition = (item: unknown): item is Position => Boolean(item && typeof item === "object" && typeof (item as Position).id === "string" && Number.isFinite((item as Position).x) && Number.isFinite((item as Position).y));
  const tables = Array.isArray(candidate?.tables) ? candidate.tables.filter(validPosition).slice(0, 100).map((item) => normalizeTable(item as Position & Partial<ChartTable>)) : [];
  const savedChartStudents = (Array.isArray(candidate?.students) ? candidate.students : []).filter(validPosition).map((item) => item as ChartStudent);
  const savedStudents = new Map(savedChartStudents.map((item) => [item.id, item]));
  const guests = savedChartStudents.filter((item) => item.guest === true && item.id.startsWith("guest-") && typeof item.name === "string" && item.name.trim().length > 0 && item.name.trim().length <= 80).map((item) => ({ id: item.id, x: clamp(item.x, 5, 95), y: clamp(item.y, 4, 96), guest: true as const, name: item.name!.trim() }));
  return {
    version: 1,
    tables,
    students: [...students.map((student, index) => {
      const saved = savedStudents.get(student.id);
      const fallback = defaultStudentPosition(index, students.length);
      return { id: student.id, x: saved ? clamp(saved.x, 5, 95) : fallback.x, y: saved ? clamp(saved.y, 4, 96) : fallback.y };
    }), ...guests],
  };
}

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

export default function SeatingChart({ classId, className, students, initialLayout, initialSavedAt }: { classId: string; className: string; students: Student[]; initialLayout: unknown; initialSavedAt: string | null }) {
  const startingLayout = useMemo(() => createInitialLayout(initialLayout, students), [initialLayout, students]);
  const initialSerialized = useMemo(() => JSON.stringify(startingLayout), [startingLayout]);
  const savedRosterIsCurrent = useMemo(() => {
    if (!initialLayout || typeof initialLayout !== "object" || !Array.isArray((initialLayout as Partial<Layout>).students)) return !initialSavedAt && students.length === 0;
    const savedIds = new Set((initialLayout as Partial<Layout>).students?.filter((student) => student?.guest !== true).map((student) => student?.id));
    return savedIds.size === students.length && students.every(({ id }) => savedIds.has(id));
  }, [initialLayout, initialSavedAt, students]);
  const [layout, setLayout] = useState(startingLayout);
  const [selectedTableIds, setSelectedTableIds] = useState<string[]>([]);
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [guestName, setGuestName] = useState("");
  const [dragTarget, setDragTarget] = useState<DragTarget | null>(null);
  const [drawTool, setDrawTool] = useState<TableShape | null>(null);
  const [drawingTarget, setDrawingTarget] = useState<DrawingTarget | null>(null);
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
  const [tablePreview, setTablePreview] = useState<Omit<ChartTable, "id"> | null>(null);
  const [historyCount, setHistoryCount] = useState(0);
  const boardRef = useRef<HTMLDivElement>(null);
  const layoutRef = useRef(layout);
  const selectionRef = useRef<Selection>({ tableIds: [], studentIds: [] });
  const historyRef = useRef<Layout[]>([]);
  const futureRef = useRef<Layout[]>([]);
  const tableClipboard = useRef<ChartTable[]>([]);
  const dragHistoryRecorded = useRef(false);
  const initialState: SeatingChartSaveState = { status: "idle", message: "", savedLayout: savedRosterIsCurrent ? initialSerialized : "", savedAt: initialSavedAt ?? undefined };
  const [saveState, saveAction, saving] = useActionState(saveSeatingChart, initialState);
  const serializedLayout = JSON.stringify(layout);
  const hasChanges = serializedLayout !== saveState.savedLayout;
  const namesById = useMemo(() => new Map([...students.map((student) => [student.id, student.name] as const), ...layout.students.filter((student) => student.guest === true).map((student) => [student.id, student.name!] as const)]), [layout.students, students]);
  const selectedGuest = selectedStudentIds.length === 1 && selectedStudentIds[0].startsWith("guest-") ? selectedStudentIds[0] : null;

  const updateSelection = useCallback((tableIds: string[], studentIds: string[]) => {
    selectionRef.current = { tableIds, studentIds };
    setSelectedTableIds(tableIds);
    setSelectedStudentIds(studentIds);
  }, []);

  const applyLayoutChange = useCallback((update: Layout | ((current: Layout) => Layout), recordHistory = true) => {
    const current = layoutRef.current;
    const next = typeof update === "function" ? update(current) : update;
    if (next === current) return;
    if (recordHistory) {
      historyRef.current = [...historyRef.current.slice(-49), current];
      futureRef.current = [];
    }
    layoutRef.current = next;
    setLayout(next);
    setHistoryCount(historyRef.current.length);
  }, []);

  const undo = useCallback(() => {
    const previous = historyRef.current.at(-1);
    if (!previous) return;
    historyRef.current = historyRef.current.slice(0, -1);
    futureRef.current = [...futureRef.current.slice(-49), layoutRef.current];
    layoutRef.current = previous;
    setLayout(previous);
    updateSelection([], []);
    setHistoryCount(historyRef.current.length);
  }, [updateSelection]);

  const redo = useCallback(() => {
    const next = futureRef.current.at(-1);
    if (!next) return;
    futureRef.current = futureRef.current.slice(0, -1);
    historyRef.current = [...historyRef.current.slice(-49), layoutRef.current];
    layoutRef.current = next;
    setLayout(next);
    updateSelection([], []);
    setHistoryCount(historyRef.current.length);
  }, [updateSelection]);

  const deleteSelectedTables = useCallback(() => {
    const tableIds = new Set(selectionRef.current.tableIds);
    if (!tableIds.size) return;
    applyLayoutChange((current) => ({ ...current, tables: current.tables.filter(({ id }) => !tableIds.has(id)) }));
    updateSelection([], selectionRef.current.studentIds);
  }, [applyLayoutChange, updateSelection]);

  const copySelectedTables = useCallback(() => {
    const tableIds = new Set(selectionRef.current.tableIds);
    if (!tableIds.size) return false;
    tableClipboard.current = layoutRef.current.tables.filter(({ id }) => tableIds.has(id)).map((table) => ({ ...table }));
    return true;
  }, []);

  const pasteTables = useCallback(() => {
    const available = Math.max(0, 100 - layoutRef.current.tables.length);
    if (!tableClipboard.current.length || !available) return;
    const duplicates = tableClipboard.current.slice(0, available).map((table) => normalizeTable({ ...table, id: `table-${crypto.randomUUID()}`, x: table.x + 3, y: table.y + 3 }));
    applyLayoutChange((current) => ({ ...current, tables: [...current.tables, ...duplicates] }));
    updateSelection(duplicates.map(({ id }) => id), []);
    setDrawTool(null);
  }, [applyLayoutChange, updateSelection]);

  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null) => (target as HTMLElement | null)?.closest("input, textarea, select, [contenteditable='true']");
    function handleShortcut(event: globalThis.KeyboardEvent) {
      if (isEditableTarget(event.target)) return;
      const command = event.ctrlKey || event.metaKey;
      if (command && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo(); else undo();
      } else if (command && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redo();
      } else if (!command && (event.key === "Delete" || event.key === "Backspace") && selectionRef.current.tableIds.length) {
        event.preventDefault();
        deleteSelectedTables();
      }
    }
    function handleCopy(event: globalThis.ClipboardEvent) {
      if (!isEditableTarget(event.target) && copySelectedTables()) event.preventDefault();
    }
    function handlePaste(event: globalThis.ClipboardEvent) {
      if (isEditableTarget(event.target) || !tableClipboard.current.length) return;
      event.preventDefault();
      pasteTables();
    }
    window.addEventListener("keydown", handleShortcut);
    window.addEventListener("copy", handleCopy);
    window.addEventListener("paste", handlePaste);
    return () => {
      window.removeEventListener("keydown", handleShortcut);
      window.removeEventListener("copy", handleCopy);
      window.removeEventListener("paste", handlePaste);
    };
  }, [copySelectedTables, deleteSelectedTables, pasteTables, redo, undo]);

  function activateSelectTool() {
    setDrawTool(null);
  }

  function toggleDrawTool(shape: TableShape) {
    setDrawTool((current) => current === shape ? null : shape);
    updateSelection([], []);
  }

  function changeSelectedTableShape(shape: TableShape) {
    const tableIds = new Set(selectionRef.current.tableIds);
    if (!tableIds.size) return;
    applyLayoutChange((current) => ({ ...current, tables: current.tables.map((table) => tableIds.has(table.id) ? { ...table, shape } : table) }));
  }

  function arrangeStudents() {
    applyLayoutChange((current) => ({ ...current, students: current.students.map((student, index) => ({ ...student, ...defaultStudentPosition(index, current.students.length) })) }));
  }

  function addGuestStudent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = guestName.trim();
    if (!name) return;
    const id = `guest-${crypto.randomUUID()}`;
    applyLayoutChange((current) => ({ ...current, students: [...current.students, { id, name: name.slice(0, 80), guest: true, ...defaultStudentPosition(current.students.length, current.students.length + 1) }] }));
    setGuestName("");
    updateSelection([], [id]);
    setDrawTool(null);
  }

  function removeSelectedGuest() {
    if (!selectedGuest) return;
    applyLayoutChange((current) => ({ ...current, students: current.students.filter(({ id }) => id !== selectedGuest) }));
    updateSelection(selectionRef.current.tableIds, selectionRef.current.studentIds.filter((id) => id !== selectedGuest));
  }

  function resetChart() {
    if (!window.confirm("Reset the whole seating chart? This removes every table and chart-only student. You can undo with Ctrl+Z.")) return;
    applyLayoutChange({ version: 1, tables: [], students: students.map((student, index) => ({ id: student.id, ...defaultStudentPosition(index, students.length) })) });
    updateSelection([], []);
    setDrawTool(null);
  }

  function beginDrag(event: PointerEvent<HTMLElement>, kind: "table" | "student", id: string) {
    if (drawTool || !boardRef.current) return;
    event.preventDefault();
    let tableIds = selectionRef.current.tableIds;
    let studentIds = selectionRef.current.studentIds;
    const selected = kind === "table" ? tableIds.includes(id) : studentIds.includes(id);
    if (event.shiftKey && selected) {
      if (kind === "table") tableIds = tableIds.filter((tableId) => tableId !== id);
      else studentIds = studentIds.filter((studentId) => studentId !== id);
      updateSelection(tableIds, studentIds);
      return;
    }
    if (event.shiftKey) {
      if (kind === "table") tableIds = [...tableIds, id];
      else studentIds = [...studentIds, id];
    } else if (!selected) {
      tableIds = kind === "table" ? [id] : [];
      studentIds = kind === "student" ? [id] : [];
    }
    updateSelection(tableIds, studentIds);
    const start = boardPosition(event);
    const selectedTables = new Set(tableIds);
    const selectedStudents = new Set(studentIds);
    boardRef.current.setPointerCapture(event.pointerId);
    dragHistoryRecorded.current = false;
    setDragTarget({
      pointerId: event.pointerId,
      startX: start.x,
      startY: start.y,
      tables: layoutRef.current.tables.filter(({ id: tableId }) => selectedTables.has(tableId)).map(({ id: tableId, x, y }) => ({ id: tableId, x, y })),
      students: layoutRef.current.students.filter(({ id: studentId }) => selectedStudents.has(studentId)).map(({ id: studentId, x, y }) => ({ id: studentId, x, y })),
    });
  }

  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    if (drawingTarget && drawingTarget.pointerId === event.pointerId) {
      const position = boardPosition(event);
      setTablePreview(tableFromPoints(drawingTarget.shape, drawingTarget.startX, drawingTarget.startY, position.x, position.y, event.shiftKey));
      return;
    }
    if (selectionBox && selectionBox.pointerId === event.pointerId) {
      const position = boardPosition(event);
      setSelectionBox((current) => current?.pointerId === event.pointerId ? { ...current, currentX: position.x, currentY: position.y } : current);
      return;
    }
    if (!dragTarget || dragTarget.pointerId !== event.pointerId) return;
    const position = boardPosition(event);
    const deltaX = position.x - dragTarget.startX;
    const deltaY = position.y - dragTarget.startY;
    if (Math.abs(deltaX) < 0.02 && Math.abs(deltaY) < 0.02) return;
    const tableOrigins = new Map(dragTarget.tables.map((item) => [item.id, item]));
    const studentOrigins = new Map(dragTarget.students.map((item) => [item.id, item]));
    applyLayoutChange((current) => ({
      ...current,
      tables: current.tables.map((table) => {
        const origin = tableOrigins.get(table.id);
        return origin ? { ...table, x: clamp(origin.x + deltaX, table.width / 2, 100 - table.width / 2), y: clamp(origin.y + deltaY, table.height / 2, 100 - table.height / 2) } : table;
      }),
      students: current.students.map((student) => {
        const origin = studentOrigins.get(student.id);
        return origin ? { ...student, x: clamp(origin.x + deltaX, 5, 95), y: clamp(origin.y + deltaY, 4, 96) } : student;
      }),
    }), !dragHistoryRecorded.current);
    dragHistoryRecorded.current = true;
  }

  function endDrag(event: PointerEvent<HTMLDivElement>) {
    if (drawingTarget && drawingTarget.pointerId === event.pointerId) {
      const position = boardPosition(event);
      const table = tableFromPoints(drawingTarget.shape, drawingTarget.startX, drawingTarget.startY, position.x, position.y, event.shiftKey);
      if (boardRef.current?.hasPointerCapture(event.pointerId)) boardRef.current.releasePointerCapture(event.pointerId);
      setDrawingTarget(null);
      setTablePreview(null);
      const id = `table-${crypto.randomUUID()}`;
      applyLayoutChange((current) => ({ ...current, tables: [...current.tables, { ...table, id }] }));
      updateSelection([id], []);
      setDrawTool(null);
      return;
    }
    if (selectionBox && selectionBox.pointerId === event.pointerId) {
      const position = boardPosition(event);
      const left = Math.min(selectionBox.startX, position.x);
      const right = Math.max(selectionBox.startX, position.x);
      const top = Math.min(selectionBox.startY, position.y);
      const bottom = Math.max(selectionBox.startY, position.y);
      const selectedTables = layoutRef.current.tables.filter((table) => table.x + table.width / 2 >= left && table.x - table.width / 2 <= right && table.y + table.height / 2 >= top && table.y - table.height / 2 <= bottom).map(({ id }) => id);
      const selectedStudents = layoutRef.current.students.filter((student) => student.x >= left && student.x <= right && student.y >= top && student.y <= bottom).map(({ id }) => id);
      updateSelection([...new Set([...selectionBox.base.tableIds, ...selectedTables])], [...new Set([...selectionBox.base.studentIds, ...selectedStudents])]);
      if (boardRef.current?.hasPointerCapture(event.pointerId)) boardRef.current.releasePointerCapture(event.pointerId);
      setSelectionBox(null);
      return;
    }
    if (!dragTarget || dragTarget.pointerId !== event.pointerId) return;
    if (boardRef.current?.hasPointerCapture(event.pointerId)) boardRef.current.releasePointerCapture(event.pointerId);
    setDragTarget(null);
  }

  function cancelDrag(event: PointerEvent<HTMLDivElement>) {
    if (boardRef.current?.hasPointerCapture(event.pointerId)) boardRef.current.releasePointerCapture(event.pointerId);
    if (drawingTarget?.pointerId === event.pointerId) {
      setDrawingTarget(null);
      setTablePreview(null);
    }
    if (selectionBox?.pointerId === event.pointerId) setSelectionBox(null);
    if (dragTarget?.pointerId === event.pointerId) setDragTarget(null);
  }

  function nudge(event: KeyboardEvent<HTMLButtonElement>, kind: "table" | "student", id: string) {
    const movement = event.shiftKey ? 3 : 1;
    const delta = { ArrowLeft: [-movement, 0], ArrowRight: [movement, 0], ArrowUp: [0, -movement], ArrowDown: [0, movement] }[event.key];
    if (!delta) return;
    event.preventDefault();
    const selected = kind === "table" ? selectionRef.current.tableIds.includes(id) : selectionRef.current.studentIds.includes(id);
    const tableIds = new Set(selected ? selectionRef.current.tableIds : kind === "table" ? [id] : []);
    const studentIds = new Set(selected ? selectionRef.current.studentIds : kind === "student" ? [id] : []);
    if (!selected) updateSelection([...tableIds], [...studentIds]);
    applyLayoutChange((current) => ({
      ...current,
      tables: current.tables.map((table) => tableIds.has(table.id) ? { ...table, x: clamp(table.x + delta[0], table.width / 2, 100 - table.width / 2), y: clamp(table.y + delta[1], table.height / 2, 100 - table.height / 2) } : table),
      students: current.students.map((student) => studentIds.has(student.id) ? { ...student, x: clamp(student.x + delta[0], 5, 95), y: clamp(student.y + delta[1], 4, 96) } : student),
    }));
  }

  function boardPosition(event: PointerEvent<Element>) {
    const bounds = boardRef.current!.getBoundingClientRect();
    return { x: clamp(((event.clientX - bounds.left) / bounds.width) * 100, 0, 100), y: clamp(((event.clientY - bounds.top) / bounds.height) * 100, 0, 100) };
  }

  function beginBoardAction(event: PointerEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget || !boardRef.current) return;
    const position = boardPosition(event);
    event.preventDefault();
    boardRef.current.setPointerCapture(event.pointerId);
    if (drawTool) {
      setDrawingTarget({ pointerId: event.pointerId, shape: drawTool, startX: position.x, startY: position.y });
      setTablePreview(tableFromPoints(drawTool, position.x, position.y, position.x, position.y, event.shiftKey));
      return;
    }
    const base = event.shiftKey ? selectionRef.current : { tableIds: [], studentIds: [] };
    if (!event.shiftKey) updateSelection([], []);
    setSelectionBox({ pointerId: event.pointerId, startX: position.x, startY: position.y, currentX: position.x, currentY: position.y, base });
  }

  function exportImage() {
    const canvas = document.createElement("canvas");
    canvas.width = 1600;
    canvas.height = 1000;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.fillStyle = "#f5f0e7";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#17342e";
    context.font = "600 48px Georgia, serif";
    context.fillText(`${className} — Seating chart`, 70, 72);
    context.fillStyle = "#607970";
    context.font = "24px Arial, sans-serif";
    context.fillText(`${layout.students.length} students`, 72, 108);
    const board = { x: 70, y: 145, width: 1460, height: 790 };
    roundedRect(context, board.x, board.y, board.width, board.height, 20);
    context.fillStyle = "#fffdf7";
    context.fill();
    context.strokeStyle = "#cfc6b8";
    context.lineWidth = 3;
    context.stroke();
    layout.tables.forEach((table) => {
      const x = board.x + (table.x / 100) * board.width;
      const y = board.y + (table.y / 100) * board.height;
      const width = (table.width / 100) * board.width;
      const height = (table.height / 100) * board.height;
      if (table.shape === "rectangle") roundedRect(context, x - width / 2, y - height / 2, width, height, 14);
      else {
        context.beginPath();
        context.ellipse(x, y, width / 2, height / 2, 0, 0, Math.PI * 2);
      }
      context.fillStyle = "#e6ddce";
      context.fill();
      context.strokeStyle = "#977f61";
      context.lineWidth = 4;
      context.stroke();
    });
    layout.students.forEach((student) => {
      const name = namesById.get(student.id) ?? "Student";
      const label = name.length > 24 ? `${name.slice(0, 22)}…` : name;
      const x = board.x + (student.x / 100) * board.width;
      const y = board.y + (student.y / 100) * board.height;
      context.font = "700 21px Arial, sans-serif";
      const width = Math.max(112, context.measureText(label).width + 34);
      roundedRect(context, x - width / 2, y - 24, width, 48, 24);
      context.fillStyle = "#17342e";
      context.fill();
      context.fillStyle = "#fffaf0";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(label, x, y + 1);
    });
    const anchor = document.createElement("a");
    anchor.href = canvas.toDataURL("image/png");
    anchor.download = `${className.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "class"}-seating-chart.png`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  return <section className={styles.workspace}>
    <div className={styles.toolbar}>
      <div className={styles.tools}>
        <button aria-pressed={!drawTool} className={`${styles.drawTool} ${!drawTool ? styles.activeDrawTool : ""}`} onClick={activateSelectTool} type="button"><span aria-hidden="true">↖</span>Select / group</button>
        <button aria-pressed={drawTool === "rectangle"} className={`${styles.drawTool} ${drawTool === "rectangle" ? styles.activeDrawTool : ""}`} onClick={() => toggleDrawTool("rectangle")} type="button"><span aria-hidden="true">▭</span>Draw rectangle table</button>
        <button aria-pressed={drawTool === "oval"} className={`${styles.drawTool} ${drawTool === "oval" ? styles.activeDrawTool : ""}`} onClick={() => toggleDrawTool("oval")} type="button"><span aria-hidden="true">○</span>Draw oval table</button>
        <button disabled={!selectedTableIds.length} onClick={() => changeSelectedTableShape("rectangle")} type="button">Make rectangle</button>
        <button disabled={!selectedTableIds.length} onClick={() => changeSelectedTableShape("oval")} type="button">Make oval</button>
        <button onClick={arrangeStudents} type="button">Arrange students</button>
        <button disabled={!historyCount} onClick={undo} type="button">Undo</button>
        <button disabled={!selectedTableIds.length} onClick={deleteSelectedTables} type="button">Remove {selectedTableIds.length > 1 ? `${selectedTableIds.length} tables` : "table"}</button>
        <button disabled={!selectedGuest} onClick={removeSelectedGuest} type="button">Remove chart student</button>
        <button className={styles.resetTool} onClick={resetChart} type="button">Reset all</button>
      </div>
      <form className={styles.guestForm} onSubmit={addGuestStudent}><label htmlFor="chart-student-name">Add student by name</label><div><input id="chart-student-name" maxLength={80} onChange={(event) => setGuestName(event.target.value)} placeholder="Student name" required value={guestName} /><button type="submit">Add to chart</button></div></form>
      <div className={styles.actions}>
        <span className={hasChanges ? styles.unsaved : styles.saved}>{hasChanges ? "Unsaved changes" : saveState.savedAt ? "All changes saved" : "Ready to design"}</span>
        <button onClick={exportImage} type="button">Export PNG</button>
        <form action={saveAction}>
          <input name="class_id" type="hidden" value={classId} />
          <input name="layout" type="hidden" value={serializedLayout} />
          <button className={styles.saveButton} disabled={saving || !hasChanges} type="submit">{saving ? "Saving…" : "Save chart"}</button>
        </form>
      </div>
    </div>
    {saveState.status !== "idle" && <p className={`${styles.message} ${saveState.status === "error" ? styles.error : styles.success}`} role={saveState.status === "error" ? "alert" : "status"}>{saveState.message}</p>}
    <div className={styles.boardWrap}>
      <div aria-label={`Seating chart canvas for ${className}`} className={`${styles.board} ${drawTool ? styles.drawingBoard : styles.selectionBoard}`} onPointerCancel={cancelDrag} onPointerDown={beginBoardAction} onPointerMove={moveDrag} onPointerUp={endDrag} ref={boardRef}>
        <div className={styles.front}><span>Front of room</span></div>
        {layout.tables.map((table, index) => <button aria-label={`${table.shape === "rectangle" ? "Rectangle" : "Oval"} table ${index + 1}. Click to select, Shift-click for a group, or drag to move.`} aria-pressed={selectedTableIds.includes(table.id)} className={`${styles.table} ${table.shape === "rectangle" ? styles.rectangleTable : ""} ${selectedTableIds.includes(table.id) ? styles.selectedTable : ""}`} key={table.id} onKeyDown={(event) => nudge(event, "table", table.id)} onPointerDown={(event) => beginDrag(event, "table", table.id)} style={{ height: `${table.height}%`, left: `${table.x}%`, top: `${table.y}%`, width: `${table.width}%` }} type="button"><span>Table {index + 1}</span></button>)}
        {tablePreview && <div aria-hidden="true" className={`${styles.table} ${styles.tablePreview} ${tablePreview.shape === "rectangle" ? styles.rectangleTable : ""}`} style={{ height: `${tablePreview.height}%`, left: `${tablePreview.x}%`, top: `${tablePreview.y}%`, width: `${tablePreview.width}%` }} />}
        {layout.students.map((student) => <button aria-label={`${namesById.get(student.id)}${student.guest ? ", chart-only student" : ""}. Click to select, Shift-click for a group, or drag to move.`} aria-pressed={selectedStudentIds.includes(student.id)} className={`${styles.student} ${student.guest ? styles.guestStudent : ""} ${selectedStudentIds.includes(student.id) ? styles.selectedStudent : ""}`} key={student.id} onKeyDown={(event) => nudge(event, "student", student.id)} onPointerDown={(event) => beginDrag(event, "student", student.id)} style={{ left: `${student.x}%`, top: `${student.y}%` }} type="button"><span>{namesById.get(student.id)}</span></button>)}
        {selectionBox && <div aria-hidden="true" className={styles.selectionBox} style={{ height: `${Math.abs(selectionBox.currentY - selectionBox.startY)}%`, left: `${Math.min(selectionBox.startX, selectionBox.currentX)}%`, top: `${Math.min(selectionBox.startY, selectionBox.currentY)}%`, width: `${Math.abs(selectionBox.currentX - selectionBox.startX)}%` }} />}
        {!layout.students.length && <div className={styles.empty}><span>＋</span><strong>No students on this chart yet</strong><p>Add a name above, or enroll students from the class page.</p></div>}
      </div>
    </div>
    <footer className={styles.help}><span><b>Select</b> click an item, Shift-click more, or drag a box around a group.</span><span><b>Draw</b> a table on open canvas; Shift makes a square or circle.</span><span><b>Shortcuts</b> Delete removes tables, Ctrl/Cmd+Z undoes, and Ctrl/Cmd+C then V duplicates.</span><span><b>Move</b> drag a selection or use arrow keys; hold Shift for larger steps.</span></footer>
  </section>;
}
