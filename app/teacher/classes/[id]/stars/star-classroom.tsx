"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ClassroomStarState, ClassroomSyncPayload, ClassroomWorkItem, QueuedStarEvent, WorkKind, WorkStatus } from "@/lib/classroom-stars";
import styles from "./stars.module.css";

type SaveState = "saved" | "offline" | "syncing" | "error";
type MatchRow = { excelName: string; outcome: "matched" | "ambiguous" | "excel_only"; matchedStudentName?: string; confidence?: number; reason: string; suggestions?: string[] };
type ImportPreview = {
  fileName: string;
  sheetName: string;
  counts: { excelStudents: number; matched: number; ambiguous: number; excelOnly: number; jaguarOnly: number; weeks: number; workItems: number };
  matches: MatchRow[];
  missingFromWorkbook: Array<{ studentName: string }>;
};

const emptyQueue = (): ClassroomSyncPayload => ({ weeks: [], starEvents: [], workItems: [], workStatuses: [] });
const queueSize = (queue: ClassroomSyncPayload) => queue.weeks.length + queue.starEvents.length + queue.workItems.length + queue.workStatuses.length;
const statusLabels: Record<WorkStatus, string> = { done: "Done", late: "Late", missing: "Missing", ok: "OK", not_ok: "Not OK" };

function queueKey(classId: string) { return `jaguar-stars-queue:${classId}:v1`; }
function localDateKey() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function skullKey(classId: string) { return `jaguar-stars-skulls:${classId}:${localDateKey()}`; }

function readQueue(classId: string): ClassroomSyncPayload {
  try {
    const parsed = JSON.parse(localStorage.getItem(queueKey(classId)) || "null") as ClassroomSyncPayload | null;
    return parsed && Array.isArray(parsed.starEvents) ? parsed : emptyQueue();
  } catch { return emptyQueue(); }
}

function writeQueue(classId: string, queue: ClassroomSyncPayload) {
  localStorage.setItem(queueKey(classId), JSON.stringify(queue));
}

function statusOperationKey(operation: ClassroomSyncPayload["workStatuses"][number]) {
  return `${operation.student_id}|${operation.week_label}|${operation.kind}|${operation.position}`;
}

function itemOperationKey(operation: ClassroomSyncPayload["workItems"][number]) {
  return `${operation.week_label}|${operation.kind}|${operation.position}`;
}

function mergeQueue(current: ClassroomSyncPayload, additions: Partial<ClassroomSyncPayload>): ClassroomSyncPayload {
  const merged = {
    weeks: [...current.weeks],
    starEvents: [...current.starEvents, ...(additions.starEvents ?? [])],
    workItems: [...current.workItems],
    workStatuses: [...current.workStatuses],
  };
  for (const week of additions.weeks ?? []) merged.weeks = [...merged.weeks.filter((item) => item.label !== week.label), week];
  for (const item of additions.workItems ?? []) merged.workItems = [...merged.workItems.filter((existing) => itemOperationKey(existing) !== itemOperationKey(item)), item];
  for (const status of additions.workStatuses ?? []) merged.workStatuses = [...merged.workStatuses.filter((existing) => statusOperationKey(existing) !== statusOperationKey(status)), status];
  return merged;
}

function subtractSent(current: ClassroomSyncPayload, sent: ClassroomSyncPayload): ClassroomSyncPayload {
  const sentWeeks = new Map(sent.weeks.map((item) => [item.label, JSON.stringify(item)]));
  const sentEvents = new Set(sent.starEvents.map((item) => item.id));
  const sentItems = new Map(sent.workItems.map((item) => [itemOperationKey(item), JSON.stringify(item)]));
  const sentStatuses = new Map(sent.workStatuses.map((item) => [statusOperationKey(item), JSON.stringify(item)]));
  return {
    weeks: current.weeks.filter((item) => sentWeeks.get(item.label) !== JSON.stringify(item)),
    starEvents: current.starEvents.filter((item) => !sentEvents.has(item.id)),
    workItems: current.workItems.filter((item) => sentItems.get(itemOperationKey(item)) !== JSON.stringify(item)),
    workStatuses: current.workStatuses.filter((item) => sentStatuses.get(statusOperationKey(item)) !== JSON.stringify(item)),
  };
}

function applyPending(initial: ClassroomStarState, queue: ClassroomSyncPayload): ClassroomStarState {
  const next: ClassroomStarState = {
    ...initial,
    weeks: initial.weeks.map((week) => ({ ...week })),
    students: initial.students.map((student) => ({ ...student, totals: { ...student.totals } })),
    workItems: initial.workItems.map((item) => ({ ...item, statuses: { ...item.statuses } })),
    eventIds: [...initial.eventIds],
  };
  for (const week of queue.weeks) if (!next.weeks.some((item) => item.label === week.label)) next.weeks.push({ id: week.id, label: week.label, sortOrder: week.sort_order, title: week.title || null, focus: week.focus || null });
  const knownEvents = new Set(next.eventIds);
  for (const event of queue.starEvents) {
    if (knownEvents.has(event.id)) continue;
    const student = next.students.find((item) => item.id === event.student_id);
    if (student) student.totals[event.week_label] = Math.max(0, (student.totals[event.week_label] ?? 0) + event.delta);
  }
  for (const item of queue.workItems) {
    const existing = next.workItems.find((value) => value.weekLabel === item.week_label && value.kind === item.kind && value.position === item.position);
    if (existing) { existing.title = item.title; existing.activityDate = item.activity_date || null; }
    else next.workItems.push({ id: item.id, weekLabel: item.week_label, kind: item.kind, position: item.position, title: item.title, activityDate: item.activity_date || null, statuses: {} });
  }
  for (const status of queue.workStatuses) {
    const item = next.workItems.find((value) => value.weekLabel === status.week_label && value.kind === status.kind && value.position === status.position);
    if (!item) continue;
    if (status.status) item.statuses[status.student_id] = status.status;
    else delete item.statuses[status.student_id];
  }
  next.weeks.sort((first, second) => first.sortOrder - second.sortOrder);
  return next;
}

function initialWeek(state: ClassroomStarState) {
  const used = state.weeks.filter((week) => state.students.some((student) => (student.totals[week.label] ?? 0) > 0) || state.workItems.some((item) => item.weekLabel === week.label));
  return used.at(-1)?.label ?? state.weeks[0]?.label ?? "A1";
}

function shuffle<T>(values: T[]) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const random = crypto.getRandomValues(new Uint32Array(1))[0] % (index + 1);
    [result[index], result[random]] = [result[random], result[index]];
  }
  return result;
}

export default function StarClassroom({ initialState }: { initialState: ClassroomStarState }) {
  const router = useRouter();
  const [data, setData] = useState(initialState);
  const [selectedWeek, setSelectedWeek] = useState(() => initialWeek(initialState));
  const [queue, setQueue] = useState<ClassroomSyncPayload>(emptyQueue);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [saveMessage, setSaveMessage] = useState("Everything is safely saved in Jaguar.");
  const [skulls, setSkulls] = useState<Record<string, number>>({});
  const [activeWorkId, setActiveWorkId] = useState<string>("");
  const [newWorkKind, setNewWorkKind] = useState<WorkKind>("homework");
  const [newWorkTitle, setNewWorkTitle] = useState("");
  const [newWorkDate, setNewWorkDate] = useState("");
  const [utilityMessage, setUtilityMessage] = useState("Pick a student or make balanced teams.");
  const [teamCount, setTeamCount] = useState(4);
  const [timer, setTimer] = useState(60);
  const [timerRunning, setTimerRunning] = useState(false);
  const [workbook, setWorkbook] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importMessage, setImportMessage] = useState("");
  const [importing, setImporting] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const syncing = useRef(false);

  const flushQueue = useCallback(async (payload?: ClassroomSyncPayload) => {
    const pending = payload ?? readQueue(initialState.classroom.id);
    if (!queueSize(pending) || syncing.current) return;
    if (!navigator.onLine) {
      setSaveState("offline");
      setSaveMessage(`No Wi-Fi right now. ${queueSize(pending)} ${queueSize(pending) === 1 ? "change is" : "changes are"} safely stored in this browser and will save automatically when connection returns.`);
      return;
    }
    syncing.current = true;
    setSaveState("syncing");
    setSaveMessage(`Connection found — securely saving ${queueSize(pending)} browser ${queueSize(pending) === 1 ? "change" : "changes"}…`);
    try {
      const response = await fetch(`/api/classes/${initialState.classroom.id}/stars/sync`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(pending) });
      if (!response.ok) throw new Error("save failed");
      const current = readQueue(initialState.classroom.id);
      const remaining = subtractSent(current, pending);
      writeQueue(initialState.classroom.id, remaining);
      setQueue(remaining);
      if (queueSize(remaining)) {
        setSaveState("syncing");
        setSaveMessage("The first batch is safe. Saving the newest classroom changes now…");
      } else {
        setSaveState("saved");
        setSaveMessage(`All changes saved successfully at ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. You’re safe to close this page.`);
        router.refresh();
      }
    } catch {
      const pendingNow = readQueue(initialState.classroom.id);
      setSaveState(navigator.onLine ? "error" : "offline");
      setSaveMessage(`Jaguar can’t reach secure storage right now. ${queueSize(pendingNow)} ${queueSize(pendingNow) === 1 ? "change is" : "changes are"} safely kept in this browser and will retry automatically.`);
    } finally {
      syncing.current = false;
      const pendingNow = readQueue(initialState.classroom.id);
      if (navigator.onLine && queueSize(pendingNow) && JSON.stringify(pendingNow) !== JSON.stringify(pending)) setTimeout(() => void flushQueue(pendingNow), 100);
    }
  }, [initialState.classroom.id, router]);

  useEffect(() => {
    const pending = readQueue(initialState.classroom.id);
    const hydrationTimer = window.setTimeout(() => {
      setQueue(pending);
      if (queueSize(pending)) {
        setData((current) => applyPending(current, pending));
        void flushQueue(pending);
      }
      try { setSkulls(JSON.parse(localStorage.getItem(skullKey(initialState.classroom.id)) || "{}")); } catch { setSkulls({}); }
      setIsOnline(navigator.onLine);
    }, 0);
    const handleOnline = () => { setIsOnline(true); void flushQueue(readQueue(initialState.classroom.id)); };
    const handleOffline = () => {
      setIsOnline(false);
      const current = readQueue(initialState.classroom.id);
      setSaveState("offline");
      setSaveMessage(`No Wi-Fi right now. ${queueSize(current) ? `${queueSize(current)} pending ${queueSize(current) === 1 ? "change is" : "changes are"}` : "Any new changes will be"} safely stored in this browser.`);
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    const interval = window.setInterval(() => { const current = readQueue(initialState.classroom.id); if (navigator.onLine && queueSize(current)) void flushQueue(current); }, 15000);
    return () => { window.clearTimeout(hydrationTimer); window.removeEventListener("online", handleOnline); window.removeEventListener("offline", handleOffline); window.clearInterval(interval); };
  }, [flushQueue, initialState.classroom.id]);

  useEffect(() => {
    if (!timerRunning) return;
    const interval = window.setInterval(() => setTimer((value) => {
      if (value <= 1) { setTimerRunning(false); return 0; }
      return value - 1;
    }), 1000);
    return () => window.clearInterval(interval);
  }, [timerRunning]);

  function enqueue(additions: Partial<ClassroomSyncPayload>) {
    const next = mergeQueue(readQueue(data.classroom.id), additions);
    writeQueue(data.classroom.id, next);
    setQueue(next);
    if (navigator.onLine) void flushQueue(next);
    else {
      setSaveState("offline");
      setSaveMessage(`No Wi-Fi right now. ${queueSize(next)} ${queueSize(next) === 1 ? "change is" : "changes are"} safely stored in this browser and will save automatically when connection returns.`);
    }
  }

  function changeStars(studentId: string, delta: 1 | -1) {
    const student = data.students.find((item) => item.id === studentId);
    if (!student || delta < 0 && (student.totals[selectedWeek] ?? 0) <= 0) return;
    const event: QueuedStarEvent = { id: crypto.randomUUID(), student_id: studentId, week_label: selectedWeek, delta, source: navigator.onLine ? "classroom" : "offline_queue", occurred_at: new Date().toISOString() };
    setData((current) => ({ ...current, students: current.students.map((item) => item.id === studentId ? { ...item, totals: { ...item.totals, [selectedWeek]: Math.max(0, (item.totals[selectedWeek] ?? 0) + delta) } } : item) }));
    enqueue({ starEvents: [event] });
  }

  function updateSkulls(studentId: string, value: number) {
    const next = { ...skulls, [studentId]: Math.max(0, Math.min(3, value)) };
    setSkulls(next);
    localStorage.setItem(skullKey(data.classroom.id), JSON.stringify(next));
  }

  function addWeek() {
    const nextOrder = Math.max(0, ...data.weeks.map((week) => week.sortOrder)) + 1;
    const suggested = `A${nextOrder}`;
    const label = window.prompt("Label for the next teaching week", suggested)?.trim();
    if (!label || data.weeks.some((week) => week.label.toLowerCase() === label.toLowerCase())) return;
    const week = { id: crypto.randomUUID(), label, sort_order: nextOrder, title: "", focus: "" };
    setData((current) => ({ ...current, weeks: [...current.weeks, { id: week.id, label, sortOrder: nextOrder, title: null, focus: null }] }));
    setSelectedWeek(label);
    enqueue({ weeks: [week] });
  }

  function addWorkItem() {
    const title = newWorkTitle.trim();
    if (!title) return;
    const position = Math.max(0, ...data.workItems.filter((item) => item.weekLabel === selectedWeek && item.kind === newWorkKind).map((item) => item.position)) + 1;
    const item: ClassroomWorkItem = { id: crypto.randomUUID(), weekLabel: selectedWeek, kind: newWorkKind, position, title, activityDate: newWorkDate || null, statuses: {} };
    const defaultStatus: WorkStatus = newWorkKind === "homework" ? "done" : "ok";
    item.statuses = Object.fromEntries(data.students.map((student) => [student.id, defaultStatus]));
    setData((current) => ({ ...current, workItems: [...current.workItems, item] }));
    setActiveWorkId(item.id);
    setNewWorkTitle(""); setNewWorkDate("");
    enqueue({
      workItems: [{ id: item.id, week_label: selectedWeek, kind: item.kind, position, title: item.title, activity_date: item.activityDate || undefined }],
      workStatuses: data.students.map((student) => ({ student_id: student.id, week_label: selectedWeek, kind: item.kind, position, status: defaultStatus })),
    });
  }

  function setWorkStatus(item: ClassroomWorkItem, studentId: string, status: WorkStatus | "") {
    setData((current) => ({ ...current, workItems: current.workItems.map((workItem) => workItem.id === item.id ? { ...workItem, statuses: status ? { ...workItem.statuses, [studentId]: status } : Object.fromEntries(Object.entries(workItem.statuses).filter(([id]) => id !== studentId)) } : workItem) }));
    enqueue({ workStatuses: [{ student_id: studentId, week_label: item.weekLabel, kind: item.kind, position: item.position, status }] });
  }

  async function submitWorkbook(mode: "preview" | "import") {
    if (!workbook) return;
    setImporting(true); setImportMessage(mode === "preview" ? "Checking names and workbook structure…" : "Importing only safely matched students…");
    try {
      const formData = new FormData(); formData.set("mode", mode); formData.set("workbook", workbook);
      const response = await fetch(`/api/classes/${data.classroom.id}/stars/import`, { method: "POST", body: formData });
      const result = await response.json() as { error?: string; preview?: ImportPreview; imported?: { status?: string } };
      if (result.preview) setImportPreview(result.preview);
      if (!response.ok) throw new Error(result.error || "Workbook check failed.");
      if (mode === "preview") setImportMessage("Review complete. Ambiguous and Excel-only names will be skipped.");
      else {
        setImportMessage(result.imported?.status === "already_imported" ? "This exact workbook was already imported; no duplicate data was added." : "Import complete. Only matched existing Jaguar students were updated.");
        router.refresh();
      }
    } catch (cause) { setImportMessage(cause instanceof Error ? cause.message : "Workbook check failed. Nothing was changed."); }
    finally { setImporting(false); }
  }

  const weekItems = useMemo(() => data.workItems.filter((item) => item.weekLabel === selectedWeek).sort((first, second) => first.kind.localeCompare(second.kind) || first.position - second.position), [data.workItems, selectedWeek]);
  const activeWork = weekItems.find((item) => item.id === activeWorkId) ?? weekItems[0] ?? null;
  const classStars = data.students.reduce((sum, student) => sum + (student.totals[selectedWeek] ?? 0), 0);
  const skullTotal = Object.values(skulls).reduce((sum, value) => sum + value, 0);
  const sortedStudents = [...data.students].sort((first, second) => (second.totals[selectedWeek] ?? 0) - (first.totals[selectedWeek] ?? 0) || first.fullName.localeCompare(second.fullName));

  function studentWorkSummary(studentId: string, kind: WorkKind) {
    const items = weekItems.filter((item) => item.kind === kind);
    if (!items.length) return kind === "homework" ? "HW —" : "CW —";
    const values = items.map((item) => item.statuses[studentId]);
    if (kind === "homework") return `HW ✓${values.filter((value) => value === "done").length} L${values.filter((value) => value === "late").length} M${values.filter((value) => value === "missing").length}`;
    return `CW ✓${values.filter((value) => value === "ok").length} ✕${values.filter((value) => value === "not_ok").length}`;
  }

  function chooseRandomStudent() {
    const student = data.students[Math.floor(Math.random() * data.students.length)];
    if (student) setUtilityMessage(`🎲 ${student.fullName}`);
  }

  function makeTeams() {
    const count = Math.max(2, Math.min(teamCount, data.students.length));
    const teams = Array.from({ length: count }, () => [] as string[]);
    shuffle(data.students).forEach((student, index) => teams[index % count].push(student.fullName));
    setUtilityMessage(teams.map((team, index) => `Team ${index + 1}: ${team.join(", ")}`).join("\n"));
  }

  return <div className={styles.page}>
    <section className={styles.heading}><div><p className="eyebrow">Teacher-only classroom tools</p><h1>{data.classroom.name} Stars</h1><p>Weekly rewards, homework and classwork records. Skulls remain only in this browser for today.</p></div><div className={styles.headingActions}><a className={styles.backupButton} href="/api/stars/export">Download Excel backup</a><button onClick={addWeek} type="button">＋ Add week</button></div></section>

    <div className={`${styles.saveBanner} ${styles[saveState]}`} role="status"><span>{saveState === "saved" ? "✓" : saveState === "syncing" ? "↻" : "●"}</span><div><strong>{saveState === "saved" ? "Safe and saved" : saveState === "syncing" ? "Saving now" : "Browser safety copy active"}</strong><p>{saveMessage}</p></div>{queueSize(queue) > 0 && isOnline ? <button onClick={() => void flushQueue()} type="button">Retry now</button> : null}</div>

    <section className={styles.controlRow}><label>Teaching week<select onChange={(event) => { setSelectedWeek(event.target.value); setActiveWorkId(""); }} value={selectedWeek}>{data.weeks.map((week) => <option key={week.id} value={week.label}>{week.label}{week.focus ? ` — ${week.focus}` : ""}</option>)}</select></label><article><span>Class stars</span><strong>⭐ {classStars}</strong></article><article><span>Students</span><strong>{data.students.length}</strong></article><article><span>Skulls today</span><strong>💀 {skullTotal}</strong></article></section>

    <div className={styles.workspace}>
      <section className={styles.studentPanel}>
        <div className={styles.sectionHeader}><div><p className="eyebrow">{selectedWeek}</p><h2>Class roster</h2><p>Stars sync to Supabase. Today’s skulls stay only on this device.</p></div><button onClick={() => { setSkulls({}); localStorage.removeItem(skullKey(data.classroom.id)); }} type="button">Reset today’s skulls</button></div>
        <div className={styles.studentGrid}>{sortedStudents.map((student, index) => <article className={`${styles.studentCard} ${(skulls[student.id] ?? 0) > 0 ? styles.warned : ""}`} key={student.id}>
          <div className={styles.studentIdentity}><span className={styles.rank}>{index + 1}</span><span className={styles.avatar}>{student.fullName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("")}</span><div><strong>{student.fullName}</strong><small>{studentWorkSummary(student.id, "homework")} · {studentWorkSummary(student.id, "classwork")}</small></div></div>
          <div className={styles.studentScores}><b>⭐ {student.totals[selectedWeek] ?? 0}</b><span>💀 {skulls[student.id] ?? 0}/3</span></div>
          <div className={styles.studentActions}><button className={styles.starAdd} onClick={() => changeStars(student.id, 1)} type="button">＋ ⭐</button><button disabled={(student.totals[selectedWeek] ?? 0) <= 0} onClick={() => changeStars(student.id, -1)} type="button">− ⭐</button><button className={styles.skullAdd} disabled={(skulls[student.id] ?? 0) >= 3} onClick={() => updateSkulls(student.id, (skulls[student.id] ?? 0) + 1)} type="button">＋ 💀</button>{(skulls[student.id] ?? 0) > 0 ? <button onClick={() => updateSkulls(student.id, 0)} type="button">Clear 💀</button> : null}</div>
        </article>)}</div>
      </section>

      <aside className={styles.sidebar}>
        <section className={styles.utilityCard}><p className="eyebrow">Classroom utilities</p><h2>Quick tools</h2><div className={styles.utilityActions}><button onClick={chooseRandomStudent} type="button">🎲 Random student</button><label>Teams<select onChange={(event) => setTeamCount(Number(event.target.value))} value={teamCount}>{Array.from({ length: Math.max(1, Math.min(11, data.students.length - 1)) }, (_, index) => index + 2).map((count) => <option key={count}>{count}</option>)}</select></label><button onClick={makeTeams} type="button">Mix teams</button></div><pre>{utilityMessage}</pre></section>
        <section className={styles.timerCard}><span>Ready for Math</span><strong>{String(Math.floor(timer / 60)).padStart(2, "0")}:{String(timer % 60).padStart(2, "0")}</strong><p>Backpacks away · laptops closed · notebook and pen out.</p><div><button onClick={() => setTimerRunning((value) => !value)} type="button">{timerRunning ? "Pause" : "Start"}</button><button onClick={() => { setTimerRunning(false); setTimer(60); }} type="button">Reset</button></div></section>
      </aside>
    </div>

    <section className={styles.workSection}>
      <div className={styles.sectionHeader}><div><p className="eyebrow">Weekly records</p><h2>Homework and classwork</h2><p>No ten-item limit: Jaguar can keep adding records throughout the week.</p></div></div>
      <div className={styles.workCreator}><select aria-label="Work type" onChange={(event) => setNewWorkKind(event.target.value as WorkKind)} value={newWorkKind}><option value="homework">Homework</option><option value="classwork">Classwork</option></select><input aria-label="Work title" maxLength={120} onChange={(event) => setNewWorkTitle(event.target.value)} placeholder={newWorkKind === "homework" ? "Homework title" : "Classwork title"} value={newWorkTitle} /><input aria-label="Activity date" onChange={(event) => setNewWorkDate(event.target.value)} type="date" value={newWorkDate} /><button disabled={!newWorkTitle.trim()} onClick={addWorkItem} type="button">Add to {selectedWeek}</button></div>
      {weekItems.length ? <><div className={styles.workTabs}>{weekItems.map((item) => <button className={activeWork?.id === item.id ? styles.activeTab : ""} key={item.id} onClick={() => setActiveWorkId(item.id)} type="button"><b>{item.kind === "homework" ? `HW${item.position}` : `CW${item.position}`}</b><span>{item.title}</span></button>)}</div>{activeWork ? <div className={styles.statusTable}><header><div><strong>{activeWork.title}</strong><span>{activeWork.activityDate || "No date"} · {activeWork.kind === "homework" ? "Done / Late / Missing" : "OK / Not OK"}</span></div></header>{data.students.map((student) => { const options: WorkStatus[] = activeWork.kind === "homework" ? ["done", "late", "missing"] : ["ok", "not_ok"]; const current = activeWork.statuses[student.id]; return <div className={styles.statusRow} key={student.id}><strong>{student.fullName}</strong><div>{options.map((status) => <button className={current === status ? styles.activeStatus : ""} key={status} onClick={() => setWorkStatus(activeWork, student.id, status)} type="button">{statusLabels[status]}</button>)}<button className={!current ? styles.activeStatus : ""} onClick={() => setWorkStatus(activeWork, student.id, "")} type="button">Clear</button></div></div>; })}</div> : null}</> : <p className={styles.emptyState}>No homework or classwork has been added for {selectedWeek}.</p>}
    </section>

    <section className={styles.importSection}>
      <div><p className="eyebrow">Safe migration</p><h2>Import the old Excel workbook</h2><p>Jaguar matches by existing profile and Google Classroom names. Excel IDs are ignored; uncertain or missing students are reported and skipped. No accounts are ever created.</p></div>
      <div className={styles.importControls}><input accept=".xlsx" onChange={(event) => { setWorkbook(event.target.files?.[0] ?? null); setImportPreview(null); setImportMessage(""); }} type="file" /><button disabled={!workbook || importing || queueSize(queue) > 0} onClick={() => void submitWorkbook("preview")} type="button">{importing ? "Checking…" : "Smart-match preview"}</button>{importPreview?.counts.matched ? <button className={styles.importButton} disabled={importing || queueSize(queue) > 0} onClick={() => void submitWorkbook("import")} type="button">Import {importPreview.counts.matched} matched students</button> : null}</div>
      {queueSize(queue) > 0 ? <p className={styles.importNote}>Finish syncing browser changes before importing a workbook.</p> : null}
      {importMessage ? <p className={styles.importMessage} role="status">{importMessage}</p> : null}
      {importPreview ? <div className={styles.importReport}><div className={styles.reportStats}><article><span>Matched safely</span><strong>{importPreview.counts.matched}</strong></article><article><span>Needs review</span><strong>{importPreview.counts.ambiguous}</strong></article><article><span>Excel-only skipped</span><strong>{importPreview.counts.excelOnly}</strong></article><article><span>Jaguar-only</span><strong>{importPreview.counts.jaguarOnly}</strong></article></div><details open={importPreview.counts.ambiguous + importPreview.counts.excelOnly > 0}><summary>Matching report for {importPreview.sheetName}</summary><div className={styles.matchList}>{importPreview.matches.map((match) => <div className={styles[match.outcome]} key={match.excelName}><strong>{match.excelName}</strong><span>{match.outcome === "matched" ? `→ ${match.matchedStudentName} (${match.confidence}%)` : match.outcome === "ambiguous" ? `Needs review${match.suggestions?.length ? `: ${match.suggestions.join(" or ")}` : ""}` : "Not found in this Jaguar class — skipped"}</span><small>{match.reason}</small></div>)}{importPreview.missingFromWorkbook.map((student) => <div className={styles.jaguarOnly} key={student.studentName}><strong>{student.studentName}</strong><span>Existing Jaguar student, not found in Excel</span><small>Kept on the Stars page with no imported history.</small></div>)}</div></details></div> : null}
    </section>
  </div>;
}
