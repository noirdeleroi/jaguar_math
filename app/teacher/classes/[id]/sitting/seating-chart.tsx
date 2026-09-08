"use client";

import { useActionState, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type PointerEvent } from "react";
import { saveSeatingChart, type SeatingChartSaveState } from "./actions";
import styles from "./sitting-chart.module.css";

type Student = { id: string; name: string };
type Position = { id: string; x: number; y: number };
type ChartStudent = Position & { guest?: true; name?: string };
type Layout = { version: 1; tables: Position[]; students: ChartStudent[] };
type DragTarget = { kind: "student" | "table"; id: string; pointerId: number };

const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value));

function defaultStudentPosition(index: number, total: number) {
  const columns = Math.min(6, Math.max(1, total));
  const rows = Math.max(1, Math.ceil(total / columns));
  const column = index % columns;
  const row = Math.floor(index / columns);
  return { x: columns === 1 ? 50 : 10 + (column * 80) / (columns - 1), y: rows === 1 ? 72 : 62 + (row * 28) / (rows - 1) };
}

function createInitialLayout(value: unknown, students: Student[]): Layout {
  const candidate = value && typeof value === "object" ? value as Partial<Layout> : null;
  const validPosition = (item: unknown): item is Position => Boolean(item && typeof item === "object" && typeof (item as Position).id === "string" && Number.isFinite((item as Position).x) && Number.isFinite((item as Position).y));
  const tables = Array.isArray(candidate?.tables) ? candidate.tables.filter(validPosition).slice(0, 100).map((item) => ({ id: item.id, x: clamp(item.x, 6, 94), y: clamp(item.y, 9, 91) })) : [];
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
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [selectedGuest, setSelectedGuest] = useState<string | null>(null);
  const [guestName, setGuestName] = useState("");
  const [dragTarget, setDragTarget] = useState<DragTarget | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const initialState: SeatingChartSaveState = { status: "idle", message: "", savedLayout: savedRosterIsCurrent ? initialSerialized : "", savedAt: initialSavedAt ?? undefined };
  const [saveState, saveAction, saving] = useActionState(saveSeatingChart, initialState);
  const serializedLayout = JSON.stringify(layout);
  const hasChanges = serializedLayout !== saveState.savedLayout;
  const namesById = useMemo(() => new Map([...students.map((student) => [student.id, student.name] as const), ...layout.students.filter((student) => student.guest === true).map((student) => [student.id, student.name!] as const)]), [layout.students, students]);

  function addTable() {
    const index = layout.tables.length;
    const table = { id: `table-${Date.now()}-${index}`, x: 25 + (index % 3) * 25, y: 25 + (Math.floor(index / 3) % 2) * 28 };
    setLayout((current) => ({ ...current, tables: [...current.tables, table] }));
    setSelectedTable(table.id);
    setSelectedGuest(null);
  }

  function removeSelectedTable() {
    if (!selectedTable) return;
    setLayout((current) => ({ ...current, tables: current.tables.filter(({ id }) => id !== selectedTable) }));
    setSelectedTable(null);
  }

  function arrangeStudents() {
    setLayout((current) => ({ ...current, students: current.students.map((student, index) => ({ ...student, ...defaultStudentPosition(index, current.students.length) })) }));
  }

  function addGuestStudent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = guestName.trim();
    if (!name) return;
    const id = `guest-${crypto.randomUUID()}`;
    setLayout((current) => ({ ...current, students: [...current.students, { id, name: name.slice(0, 80), guest: true, ...defaultStudentPosition(current.students.length, current.students.length + 1) }] }));
    setGuestName("");
    setSelectedGuest(id);
    setSelectedTable(null);
  }

  function removeSelectedGuest() {
    if (!selectedGuest) return;
    setLayout((current) => ({ ...current, students: current.students.filter(({ id }) => id !== selectedGuest) }));
    setSelectedGuest(null);
  }

  function beginDrag(event: PointerEvent<HTMLElement>, kind: DragTarget["kind"], id: string) {
    if (!boardRef.current) return;
    event.preventDefault();
    boardRef.current.setPointerCapture(event.pointerId);
    setDragTarget({ kind, id, pointerId: event.pointerId });
    if (kind === "table") {
      setSelectedTable(id);
      setSelectedGuest(null);
    } else {
      setSelectedTable(null);
      setSelectedGuest(id.startsWith("guest-") ? id : null);
    }
  }

  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    if (!dragTarget || dragTarget.pointerId !== event.pointerId || !boardRef.current) return;
    const bounds = boardRef.current.getBoundingClientRect();
    const marginX = dragTarget.kind === "table" ? 7 : 5;
    const marginY = dragTarget.kind === "table" ? 11 : 5;
    const position = { x: clamp(((event.clientX - bounds.left) / bounds.width) * 100, marginX, 100 - marginX), y: clamp(((event.clientY - bounds.top) / bounds.height) * 100, marginY, 100 - marginY) };
    setLayout((current) => ({ ...current, [dragTarget.kind === "table" ? "tables" : "students"]: current[dragTarget.kind === "table" ? "tables" : "students"].map((item) => item.id === dragTarget.id ? { ...item, ...position } : item) }));
  }

  function endDrag(event: PointerEvent<HTMLDivElement>) {
    if (!dragTarget || dragTarget.pointerId !== event.pointerId) return;
    if (boardRef.current?.hasPointerCapture(event.pointerId)) boardRef.current.releasePointerCapture(event.pointerId);
    setDragTarget(null);
  }

  function nudge(event: KeyboardEvent<HTMLButtonElement>, kind: DragTarget["kind"], id: string) {
    const movement = event.shiftKey ? 3 : 1;
    const delta = { ArrowLeft: [-movement, 0], ArrowRight: [movement, 0], ArrowUp: [0, -movement], ArrowDown: [0, movement] }[event.key];
    if (!delta) return;
    event.preventDefault();
    const key = kind === "table" ? "tables" : "students";
    setLayout((current) => ({ ...current, [key]: current[key].map((item) => item.id === id ? { ...item, x: clamp(item.x + delta[0], 5, 95), y: clamp(item.y + delta[1], 5, 95) } : item) }));
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
      context.beginPath();
      context.arc(x, y, 78, 0, Math.PI * 2);
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
        <button className={styles.primaryTool} onClick={addTable} type="button"><span aria-hidden="true">○</span>Add round table</button>
        <button onClick={arrangeStudents} type="button">Arrange students</button>
        <button disabled={!selectedTable} onClick={removeSelectedTable} type="button">Remove table</button>
        <button disabled={!selectedGuest} onClick={removeSelectedGuest} type="button">Remove chart student</button>
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
      <div aria-label={`Seating chart canvas for ${className}`} className={styles.board} onPointerCancel={endDrag} onPointerMove={moveDrag} onPointerUp={endDrag} ref={boardRef}>
        <div className={styles.front}><span>Front of room</span></div>
        {layout.tables.map((table, index) => <button aria-label={`Round table ${index + 1}. Drag to move; use arrow keys for precise movement.`} className={`${styles.table} ${selectedTable === table.id ? styles.selectedTable : ""}`} key={table.id} onClick={() => setSelectedTable(table.id)} onKeyDown={(event) => nudge(event, "table", table.id)} onPointerDown={(event) => beginDrag(event, "table", table.id)} style={{ left: `${table.x}%`, top: `${table.y}%` }} type="button"><span>Table {index + 1}</span></button>)}
        {layout.students.map((student) => <button aria-label={`${namesById.get(student.id)}${student.guest ? ", chart-only student" : ""}. Drag to move; use arrow keys for precise movement.`} className={`${styles.student} ${student.guest ? styles.guestStudent : ""} ${selectedGuest === student.id ? styles.selectedStudent : ""}`} key={student.id} onKeyDown={(event) => nudge(event, "student", student.id)} onPointerDown={(event) => beginDrag(event, "student", student.id)} style={{ left: `${student.x}%`, top: `${student.y}%` }} type="button"><span>{namesById.get(student.id)}</span></button>)}
        {!layout.students.length && <div className={styles.empty}><span>＋</span><strong>No students on this chart yet</strong><p>Add a name above, or enroll students from the class page.</p></div>}
      </div>
    </div>
    <footer className={styles.help}><span><b>Drag</b> students and tables anywhere on the canvas.</span><span><b>Keyboard</b> arrow keys move a selected item; hold Shift for larger steps.</span></footer>
  </section>;
}
