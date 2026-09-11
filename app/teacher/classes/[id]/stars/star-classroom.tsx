"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import type { ClassroomCwRecord, ClassroomHomeworkAssignment, ClassroomStarState, ClassroomSyncPayload, ClassroomWorkItem, QueuedStarEvent, WorkKind, WorkStatus } from "@/lib/classroom-stars";
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
type UtilityOverlay =
  | { kind: "randomizer"; phase: "spinning" | "result"; name: string }
  | { kind: "teams"; phase: "mixing" | "result"; teams: string[][]; previewNames: string[] }
  | { kind: "timer" };
type RewardEffect = { id: string; kind: "star" | "skull" | "death"; studentId: string; studentName: string };

const rewardParticles = Array.from({ length: 18 }, (_, index) => index);

const emptyQueue = (): ClassroomSyncPayload => ({ weeks: [], starEvents: [], workItems: [], workStatuses: [] });
const queueSize = (queue: ClassroomSyncPayload) => queue.weeks.length + queue.starEvents.length + queue.workItems.length + queue.workStatuses.length;
const statusLabels: Record<WorkStatus, string> = { late: "Late", ok: "OK", not_ok: "Not OK" };
const statusMarks: Record<WorkStatus, string> = { late: "L", ok: "✓", not_ok: "✕" };

function assignmentResultLabel(result: ClassroomHomeworkAssignment["results"][string] | undefined) {
  if (!result || result.status === "not_started") return "Not started";
  if (result.status === "in_progress") return "In progress";
  return result.percentage === null ? "Submitted" : `${result.percentage}%`;
}

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

function initialWeek(state: ClassroomStarState, preferredWeek: string) {
  if (state.weeks.some((week) => week.label === preferredWeek)) return preferredWeek;
  const used = state.weeks.filter((week) => state.students.some((student) => (student.totals[week.label] ?? 0) > 0) || state.workItems.some((item) => item.weekLabel === week.label));
  return used.at(-1)?.label ?? state.weeks[0]?.label ?? "A1";
}

function workPosition(state: ClassroomStarState, weekLabel: string, kind: WorkKind) {
  return Math.max(0, ...state.workItems.filter((item) => item.weekLabel === weekLabel && item.kind === kind).map((item) => item.position)) + 1;
}

function automaticWorkTitle(state: ClassroomStarState, weekLabel: string, kind: WorkKind) {
  return `${kind === "homework" ? "HW" : "CW"} ${workPosition(state, weekLabel, kind)}`;
}

function firstName(value: string) {
  return value.trim().split(/\s+/)[0] ?? value;
}

function shuffle<T>(values: T[]) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const random = crypto.getRandomValues(new Uint32Array(1))[0] % (index + 1);
    [result[index], result[random]] = [result[random], result[index]];
  }
  return result;
}

function formatTimer(value: number) {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

function UtilityPopup({ overlay, timer, timerDuration, timerRunning, onClose, onPickAgain, onRemix, onSetTimer, onToggleTimer }: {
  overlay: UtilityOverlay;
  timer: number;
  timerDuration: number;
  timerRunning: boolean;
  onClose: () => void;
  onPickAgain: () => void;
  onRemix: () => void;
  onSetTimer: (seconds: number) => void;
  onToggleTimer: () => void;
}) {
  const timerStyle = { "--timer-progress": `${timerDuration ? Math.max(0, Math.min(1, timer / timerDuration)) * 360 : 0}deg` } as CSSProperties;
  return <div className={`${styles.popupBackdrop} ${styles[`${overlay.kind}Backdrop`]}`} role="presentation">
    <section aria-label={overlay.kind === "randomizer" ? "Random student picker" : overlay.kind === "teams" ? "Random teams" : "Ready for class timer"} aria-modal="true" className={`${styles.classroomPopup} ${styles[`${overlay.kind}Popup`]}`} role="dialog">
      <button aria-label="Close popup" className={styles.popupClose} onClick={onClose} type="button">×</button>
      {overlay.kind === "randomizer" ? <>
        <div aria-hidden="true" className={styles.randomizerOrbit}><span>?</span><i /><i /><i /></div>
        <p className={styles.popupEyebrow}>{overlay.phase === "spinning" ? "The wheel is choosing…" : "You’re up!"}</p>
        <strong className={`${styles.rouletteName} ${overlay.phase === "result" ? styles.rouletteWinner : ""}`}>{overlay.name}</strong>
        <p className={styles.popupHint}>{overlay.phase === "spinning" ? "Every name has a chance." : "The classroom has spoken."}</p>
        {overlay.phase === "result" ? <button className={styles.popupAction} onClick={onPickAgain} type="button">🎲 Pick again</button> : <div aria-label="Choosing a student" className={styles.pickerTrack} role="progressbar"><span /></div>}
      </> : null}
      {overlay.kind === "teams" ? <>
        <div className={`${styles.teamMixer} ${overlay.phase === "mixing" ? styles.teamMixerActive : ""}`}>
          {overlay.phase === "mixing" ? <div className={styles.mixingDeck} aria-label="Mixing teams">{overlay.previewNames.map((name, index) => <span key={`${name}-${index}`} style={{ "--mix-index": index } as CSSProperties}>{firstName(name)}</span>)}</div> : <div className={styles.teamResultGrid}>{overlay.teams.map((team, index) => <article key={index}><span>Team {index + 1}</span><strong>{team.map(firstName).join(" · ") || "—"}</strong></article>)}</div>}
        </div>
        <p className={styles.popupEyebrow}>{overlay.phase === "mixing" ? "Shuffling the class…" : "Teams are ready!"}</p>
        <h2>{overlay.phase === "mixing" ? "Mix. Flip. Reveal." : `${overlay.teams.length} balanced teams`}</h2>
        {overlay.phase === "result" ? <button className={styles.popupAction} onClick={onRemix} type="button">↻ Mix again</button> : <div aria-label="Mixing teams" className={styles.pickerTrack} role="progressbar"><span /></div>}
      </> : null}
      {overlay.kind === "timer" ? <>
        <p className={styles.popupEyebrow}>{timer === 0 ? "Class is ready" : "Ready for Math"}</p>
        <div className={`${styles.timerDial} ${timerRunning ? styles.timerDialRunning : ""} ${timer === 0 ? styles.timerComplete : ""}`} style={timerStyle}><div><strong>{timer === 0 ? "READY!" : formatTimer(timer)}</strong><span>{timer === 0 ? "Let’s begin" : timerRunning ? "Get set…" : "Paused"}</span></div></div>
        <h2>{timer === 0 ? "Eyes front. Let’s go!" : "Backpacks away · laptops closed"}</h2>
        <p className={styles.popupHint}>Notebook and pen out. Everything else away.</p>
        <div className={styles.timerPresets}><button onClick={() => onSetTimer(60)} type="button">1 min</button><button onClick={() => onSetTimer(120)} type="button">2 min</button><button onClick={() => onSetTimer(300)} type="button">5 min</button></div>
        <button className={styles.popupAction} onClick={onToggleTimer} type="button">{timerRunning ? "Pause timer" : timer === 0 ? "Restart timer" : "Start timer"}</button>
      </> : null}
    </section>
  </div>;
}

function RewardAnimation({ effect, onClose }: { effect: RewardEffect; onClose: () => void }) {
  if (effect.kind === "death") return <div className={styles.deathBackdrop} role="alertdialog" aria-label={`${effect.studentName} received three skulls`} aria-modal="true">
    <div aria-hidden="true" className={styles.deathFog} /><div aria-hidden="true" className={styles.deathFlash} />
    <section className={styles.deathScene}>
      <p>THREE SKULLS</p>
      <div aria-hidden="true" className={styles.deathSkull}>☠</div>
      <h2>{effect.studentName}</h2>
      <strong>THE FINAL WARNING</strong>
      <button onClick={onClose} type="button">Return to the living</button>
    </section>
  </div>;

  return <div aria-live="assertive" className={`${styles.rewardEffect} ${effect.kind === "star" ? styles.starEffect : styles.skullEffect}`}>
    <div aria-hidden="true" className={styles.rewardParticles}>{rewardParticles.map((particle) => <span key={particle} style={{ "--particle": particle } as CSSProperties}>{effect.kind === "star" ? particle % 3 === 0 ? "✦" : "★" : "☠"}</span>)}</div>
    <div aria-hidden="true" className={styles.rewardIcon}>{effect.kind === "star" ? "⭐" : "💀"}</div>
    <strong>{effect.studentName}</strong>
    <span>{effect.kind === "star" ? "+1 STAR!" : "A SKULL APPEARS"}</span>
  </div>;
}

function AssignmentResultsPopup({ assignment, students, updatedAt, onClose }: { assignment: ClassroomHomeworkAssignment; students: ClassroomStarState["students"]; updatedAt: Date | null; onClose: () => void }) {
  const results = students.map((student) => ({ student, result: assignment.results[student.id] ?? { attemptId: null, status: "not_started" as const, score: null, maxScore: null, percentage: null } }));
  const submitted = results.filter(({ result }) => result.status === "submitted");
  const inProgress = results.filter(({ result }) => result.status === "in_progress");
  const average = submitted.flatMap(({ result }) => result.percentage === null ? [] : [result.percentage]);
  const due = assignment.dueAt ? new Intl.DateTimeFormat("en-US", { timeZone: "America/Bogota", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(assignment.dueAt)) : "No due date";
  return <div className={`${styles.popupBackdrop} ${styles.assignmentBackdrop}`} role="presentation"><section aria-label={`${assignment.title} live homework results`} aria-modal="true" className={`${styles.classroomPopup} ${styles.assignmentPopup}`} role="dialog"><button aria-label="Close popup" className={styles.popupClose} onClick={onClose} type="button">×</button>
    <header className={styles.assignmentPopupHeader}><div><p className={styles.popupEyebrow}>Homework · {assignment.weekLabel}</p><h2>{assignment.title}</h2><p>Due {due} · <span className={assignment.status === "published" ? styles.activeAssignment : styles.closedAssignment}>{assignment.status === "published" ? "Active" : "Closed"}</span></p></div><a href={`/teacher/assignments/${assignment.id}`}>Open homework →</a></header>
    <div className={styles.assignmentLiveLine}><span aria-hidden="true" /> <strong>Live database results</strong><small>{updatedAt ? `Updated ${updatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Connecting…"}</small></div>
    <section className={styles.assignmentStats}><article><span>Submitted</span><strong>{submitted.length}/{students.length}</strong></article><article><span>In progress</span><strong>{inProgress.length}</strong></article><article><span>Average</span><strong>{average.length ? `${Math.round(average.reduce((sum, value) => sum + value, 0) / average.length)}%` : "—"}</strong></article></section>
    <div className={styles.assignmentResultsTable}>{results.map(({ student, result }) => <div key={student.id}><strong>{student.fullName}</strong><span className={styles[`assignment_${result.status}`]}>{result.status === "submitted" ? "Submitted" : result.status === "in_progress" ? "In progress" : "Not started"}</span>{result.status === "submitted" && result.attemptId ? <a href={`/teacher/assignments/${assignment.id}/attempts/${result.attemptId}`}>{result.score}/{result.maxScore} · {result.percentage}% →</a> : <small>{result.status === "in_progress" ? "Working now" : "Waiting"}</small>}</div>)}</div>
  </section></div>;
}

export default function StarClassroom({ initialState, currentWeekLabel, embedded = false, initialAssignments = [], initialCwRecords = [] }: { initialState: ClassroomStarState; currentWeekLabel: string; embedded?: boolean; initialAssignments?: ClassroomHomeworkAssignment[]; initialCwRecords?: ClassroomCwRecord[] }) {
  const router = useRouter();
  const [data, setData] = useState(initialState);
  const [selectedWeek, setSelectedWeek] = useState(() => initialWeek(initialState, currentWeekLabel));
  const [openWeek, setOpenWeek] = useState<string | null>(() => initialWeek(initialState, currentWeekLabel));
  const [expandedWeeks, setExpandedWeeks] = useState<Set<string>>(() => new Set([initialWeek(initialState, currentWeekLabel)]));
  const [queue, setQueue] = useState<ClassroomSyncPayload>(emptyQueue);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [saveMessage, setSaveMessage] = useState("Everything is safely saved in Jaguar.");
  const [skulls, setSkulls] = useState<Record<string, number>>({});
  const [activeWorkId, setActiveWorkId] = useState<string>("");
  const [newWorkKind, setNewWorkKind] = useState<WorkKind>("homework");
  const [newWorkTitle, setNewWorkTitle] = useState(() => automaticWorkTitle(initialState, initialWeek(initialState, currentWeekLabel), "homework"));
  const [newWorkDate, setNewWorkDate] = useState(localDateKey);
  const [utilityMessage, setUtilityMessage] = useState("Pick a student or make balanced teams.");
  const [teamCount, setTeamCount] = useState(4);
  const [timer, setTimer] = useState(60);
  const [timerDuration, setTimerDuration] = useState(60);
  const [timerRunning, setTimerRunning] = useState(false);
  const [utilityOverlay, setUtilityOverlay] = useState<UtilityOverlay | null>(null);
  const [rewardEffect, setRewardEffect] = useState<RewardEffect | null>(null);
  const [workCreatorOpen, setWorkCreatorOpen] = useState(false);
  const [assignments, setAssignments] = useState(initialAssignments);
  const [assignmentPopupId, setAssignmentPopupId] = useState<string | null>(null);
  const [assignmentsUpdatedAt, setAssignmentsUpdatedAt] = useState<Date | null>(null);
  const [cwRecords, setCwRecords] = useState(initialCwRecords);
  const [cwPopup, setCwPopup] = useState<{ studentId: string; weekLabel: string } | null>(null);
  const [cwRecordDate, setCwRecordDate] = useState(localDateKey);
  const [cwReason, setCwReason] = useState("");
  const [cwMessage, setCwMessage] = useState("");
  const [cwBusy, setCwBusy] = useState(false);
  const [deletingWorkItemId, setDeletingWorkItemId] = useState<string | null>(null);
  const [workbook, setWorkbook] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importMessage, setImportMessage] = useState("");
  const [importing, setImporting] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const syncing = useRef(false);
  const randomizerInterval = useRef<number | null>(null);
  const utilityRevealTimer = useRef<number | null>(null);
  const rewardTimer = useRef<number | null>(null);
  const blockingOverlayOpen = Boolean(utilityOverlay || workCreatorOpen || assignmentPopupId || cwPopup || rewardEffect?.kind === "death");

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
    if (!embedded) return;
    let active = true;
    const refreshAssignments = async () => {
      try {
        const response = await fetch(`/api/classes/${initialState.classroom.id}/assignment-results`, { cache: "no-store" });
        if (!response.ok) return;
        const result = await response.json() as { assignments?: ClassroomHomeworkAssignment[] };
        if (active && Array.isArray(result.assignments)) {
          setAssignments(result.assignments);
          setAssignmentsUpdatedAt(new Date());
        }
      } catch { /* Keep the last database snapshot visible while the next poll retries. */ }
    };
    const refreshOnFocus = () => void refreshAssignments();
    const firstRefresh = window.setTimeout(refreshOnFocus, 0);
    const interval = window.setInterval(refreshOnFocus, 5000);
    window.addEventListener("focus", refreshOnFocus);
    return () => { active = false; window.clearTimeout(firstRefresh); window.clearInterval(interval); window.removeEventListener("focus", refreshOnFocus); };
  }, [embedded, initialState.classroom.id]);

  useEffect(() => {
    if (!embedded) return;
    let active = true;
    const refreshCwRecords = async () => {
      try {
        const response = await fetch(`/api/classes/${initialState.classroom.id}/cw-records`, { cache: "no-store" });
        if (!response.ok) return;
        const result = await response.json() as { records?: ClassroomCwRecord[] };
        if (active && Array.isArray(result.records)) setCwRecords(result.records);
      } catch { /* Keep the last loaded notes visible and retry when the page regains focus. */ }
    };
    const refreshOnFocus = () => void refreshCwRecords();
    const firstRefresh = window.setTimeout(refreshOnFocus, 0);
    window.addEventListener("focus", refreshOnFocus);
    return () => { active = false; window.clearTimeout(firstRefresh); window.removeEventListener("focus", refreshOnFocus); };
  }, [embedded, initialState.classroom.id]);

  useEffect(() => {
    if (!timerRunning) return;
    const interval = window.setInterval(() => setTimer((value) => {
      if (value <= 1) { setTimerRunning(false); return 0; }
      return value - 1;
    }), 1000);
    return () => window.clearInterval(interval);
  }, [timerRunning]);

  useEffect(() => {
    if (!blockingOverlayOpen) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (randomizerInterval.current !== null) window.clearInterval(randomizerInterval.current);
      if (utilityRevealTimer.current !== null) window.clearTimeout(utilityRevealTimer.current);
      randomizerInterval.current = null;
      utilityRevealTimer.current = null;
      setUtilityOverlay(null);
      setWorkCreatorOpen(false);
      setAssignmentPopupId(null);
      setCwPopup(null);
      setRewardEffect(null);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", closeOnEscape); };
  }, [blockingOverlayOpen]);

  useEffect(() => () => {
    if (randomizerInterval.current !== null) window.clearInterval(randomizerInterval.current);
    if (utilityRevealTimer.current !== null) window.clearTimeout(utilityRevealTimer.current);
    if (rewardTimer.current !== null) window.clearTimeout(rewardTimer.current);
  }, []);

  function clearUtilityAnimationTimers() {
    if (randomizerInterval.current !== null) window.clearInterval(randomizerInterval.current);
    if (utilityRevealTimer.current !== null) window.clearTimeout(utilityRevealTimer.current);
    randomizerInterval.current = null;
    utilityRevealTimer.current = null;
  }

  function closeUtilityOverlay() {
    clearUtilityAnimationTimers();
    setUtilityOverlay(null);
  }

  function showReward(kind: RewardEffect["kind"], studentId: string, studentName: string) {
    if (rewardTimer.current !== null) window.clearTimeout(rewardTimer.current);
    setRewardEffect({ id: crypto.randomUUID(), kind, studentId, studentName });
    if (kind !== "death") rewardTimer.current = window.setTimeout(() => setRewardEffect(null), kind === "star" ? 1800 : 2200);
  }

  function closeReward() {
    if (rewardTimer.current !== null) window.clearTimeout(rewardTimer.current);
    rewardTimer.current = null;
    setRewardEffect(null);
  }

  function setClassTimer(seconds: number) {
    setTimerDuration(seconds);
    setTimer(seconds);
    setTimerRunning(true);
  }

  function openTimer() {
    setUtilityOverlay({ kind: "timer" });
    if (timer === 0) setClassTimer(timerDuration);
    else setTimerRunning(true);
  }

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

  function changeStars(studentId: string, delta: 1 | -1, weekLabel = selectedWeek) {
    const student = data.students.find((item) => item.id === studentId);
    if (!student || delta < 0 && (student.totals[weekLabel] ?? 0) <= 0) return;
    const event: QueuedStarEvent = { id: crypto.randomUUID(), student_id: studentId, week_label: weekLabel, delta, source: navigator.onLine ? "classroom" : "offline_queue", occurred_at: new Date().toISOString() };
    setData((current) => ({ ...current, students: current.students.map((item) => item.id === studentId ? { ...item, totals: { ...item.totals, [weekLabel]: Math.max(0, (item.totals[weekLabel] ?? 0) + delta) } } : item) }));
    enqueue({ starEvents: [event] });
    if (delta > 0) showReward("star", student.id, student.fullName);
  }

  function updateSkulls(studentId: string, value: number) {
    const student = data.students.find((item) => item.id === studentId);
    const previousValue = skulls[studentId] ?? 0;
    const nextValue = Math.max(0, Math.min(3, value));
    const next = { ...skulls, [studentId]: nextValue };
    setSkulls(next);
    localStorage.setItem(skullKey(data.classroom.id), JSON.stringify(next));
    if (student && nextValue > previousValue) showReward(nextValue === 3 ? "death" : "skull", student.id, student.fullName);
  }

  function addWeek() {
    const nextOrder = Math.max(0, ...data.weeks.map((week) => week.sortOrder)) + 1;
    const suggested = `A${nextOrder}`;
    const label = window.prompt("Label for the next teaching week", suggested)?.trim();
    if (!label || data.weeks.some((week) => week.label.toLowerCase() === label.toLowerCase())) return;
    const week = { id: crypto.randomUUID(), label, sort_order: nextOrder, title: "", focus: "" };
    setData((current) => ({ ...current, weeks: [...current.weeks, { id: week.id, label, sortOrder: nextOrder, title: null, focus: null }] }));
    setSelectedWeek(label);
    setOpenWeek(label);
    setActiveWorkId("");
    setNewWorkTitle(newWorkKind === "homework" ? "HW 1" : "CW 1");
    setNewWorkDate(localDateKey());
    enqueue({ weeks: [week] });
  }

  function addWorkItem() {
    const position = workPosition(data, selectedWeek, newWorkKind);
    const title = newWorkTitle.trim() || `${newWorkKind === "homework" ? "HW" : "CW"} ${position}`;
    const item: ClassroomWorkItem = { id: crypto.randomUUID(), weekLabel: selectedWeek, kind: newWorkKind, position, title, activityDate: newWorkDate || null, statuses: {} };
    const defaultStatus: WorkStatus = "ok";
    item.statuses = Object.fromEntries(data.students.map((student) => [student.id, defaultStatus]));
    setData((current) => ({ ...current, workItems: [...current.workItems, item] }));
    setActiveWorkId(item.id);
    setWorkCreatorOpen(false);
    setNewWorkTitle(`${newWorkKind === "homework" ? "HW" : "CW"} ${position + 1}`); setNewWorkDate(localDateKey());
    enqueue({
      workItems: [{ id: item.id, week_label: selectedWeek, kind: item.kind, position, title: item.title, activity_date: item.activityDate || undefined }],
      workStatuses: data.students.map((student) => ({ student_id: student.id, week_label: selectedWeek, kind: item.kind, position, status: defaultStatus })),
    });
  }

  function editWorkItem(item: ClassroomWorkItem, changes: Partial<Pick<ClassroomWorkItem, "title" | "activityDate">>, save: boolean) {
    const updated = { ...item, ...changes };
    setData((current) => ({ ...current, workItems: current.workItems.map((workItem) => workItem.id === item.id ? updated : workItem) }));
    if (save && updated.title.trim()) enqueue({ workItems: [{ id: updated.id, week_label: updated.weekLabel, kind: updated.kind, position: updated.position, title: updated.title.trim(), activity_date: updated.activityDate || undefined }] });
  }

  function setWorkStatus(item: ClassroomWorkItem, studentId: string, status: WorkStatus | "") {
    setData((current) => ({ ...current, workItems: current.workItems.map((workItem) => workItem.id === item.id ? { ...workItem, statuses: status ? { ...workItem.statuses, [studentId]: status } : Object.fromEntries(Object.entries(workItem.statuses).filter(([id]) => id !== studentId)) } : workItem) }));
    enqueue({ workStatuses: [{ student_id: studentId, week_label: item.weekLabel, kind: item.kind, position: item.position, status }] });
  }

  async function deleteHomework(item: ClassroomWorkItem) {
    if (queueSize(readQueue(data.classroom.id)) > 0) { window.alert("Wait until the classroom changes finish saving, then delete this homework."); return; }
    if (!window.confirm(`Delete ${item.title} (${item.weekLabel} HW${item.position}) for every student? All of its statuses will also be deleted.`)) return;
    setDeletingWorkItemId(item.id);
    try {
      const response = await fetch(`/api/classes/${data.classroom.id}/work-items/${item.id}`, { method: "DELETE" });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Homework could not be deleted.");
      setData((current) => ({ ...current, workItems: current.workItems.filter((workItem) => workItem.id !== item.id) }));
      if (activeWorkId === item.id) setActiveWorkId("");
    } catch (cause) { window.alert(cause instanceof Error ? cause.message : "Homework could not be deleted."); }
    finally { setDeletingWorkItemId(null); }
  }

  function openCwRecords(studentId: string, weekLabel: string) {
    setSelectedWeek(weekLabel);
    setCwPopup({ studentId, weekLabel });
    setCwRecordDate(localDateKey());
    setCwReason("");
    setCwMessage("");
  }

  async function addCwRecord() {
    if (!cwPopup || !cwReason.trim()) return;
    setCwBusy(true); setCwMessage("Saving…");
    try {
      const response = await fetch(`/api/classes/${data.classroom.id}/cw-records`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ studentId: cwPopup.studentId, weekLabel: cwPopup.weekLabel, recordDate: cwRecordDate, reason: cwReason }) });
      const result = await response.json() as { record?: ClassroomCwRecord; error?: string };
      if (!response.ok || !result.record) throw new Error(result.error || "Classwork record could not be saved.");
      const savedRecord = result.record;
      setCwRecords((current) => [savedRecord, ...current]);
      setCwReason(""); setCwMessage("Not OK classwork record saved.");
    } catch (cause) { setCwMessage(cause instanceof Error ? cause.message : "Classwork record could not be saved."); }
    finally { setCwBusy(false); }
  }

  async function deleteCwRecord(record: ClassroomCwRecord) {
    if (!window.confirm(`Delete the ${record.recordDate} classwork note?`)) return;
    setCwBusy(true); setCwMessage("Deleting…");
    try {
      const response = await fetch(`/api/classes/${data.classroom.id}/cw-records/${record.id}`, { method: "DELETE" });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Classwork record could not be deleted.");
      setCwRecords((current) => current.filter((item) => item.id !== record.id));
      setCwMessage("Classwork record deleted.");
    } catch (cause) { setCwMessage(cause instanceof Error ? cause.message : "Classwork record could not be deleted."); }
    finally { setCwBusy(false); }
  }

  async function submitWorkbook(mode: "preview" | "import") {
    if (!workbook) return;
    setImporting(true); setImportMessage(mode === "preview" ? "Checking names and workbook structure…" : "Importing only safely matched students…");
    try {
      const formData = new FormData(); formData.set("mode", mode); formData.set("workbook", workbook);
      const response = await fetch(`/api/classes/${data.classroom.id}/stars/import`, { method: "POST", body: formData });
      const result = await response.json() as { error?: string; preview?: ImportPreview; imported?: { status?: string; new_statuses?: number } };
      if (result.preview) setImportPreview(result.preview);
      if (!response.ok) throw new Error(result.error || "Workbook check failed.");
      if (mode === "preview") setImportMessage("Review complete. Ambiguous and Excel-only names will be skipped.");
      else {
        setImportMessage(result.imported?.status === "refreshed" ? `Roster refresh complete. ${result.imported.new_statuses ?? 0} missing HW/CW ${result.imported.new_statuses === 1 ? "status was" : "statuses were"} added for newly matched students; existing stars and teacher changes were preserved.` : "Import complete. Only matched existing Jaguar students were updated.");
        router.refresh();
      }
    } catch (cause) { setImportMessage(cause instanceof Error ? cause.message : "Workbook check failed. Nothing was changed."); }
    finally { setImporting(false); }
  }

  const weekItems = useMemo(() => data.workItems.filter((item) => item.weekLabel === selectedWeek).sort((first, second) => first.kind.localeCompare(second.kind) || first.position - second.position), [data.workItems, selectedWeek]);
  const activeWork = weekItems.find((item) => item.id === activeWorkId) ?? weekItems[0] ?? null;
  const classStars = data.students.reduce((sum, student) => sum + (student.totals[selectedWeek] ?? 0), 0);
  const skullTotal = Object.values(skulls).reduce((sum, value) => sum + value, 0);
  const sortedStudents = [...data.students].sort((first, second) => firstName(first.fullName).localeCompare(firstName(second.fullName), undefined, { sensitivity: "base" }) || first.fullName.localeCompare(second.fullName, undefined, { sensitivity: "base" }));
  const cwPopupStudent = cwPopup ? data.students.find((student) => student.id === cwPopup.studentId) ?? null : null;
  const cwPopupRecords = cwPopup ? cwRecords.filter((record) => record.studentId === cwPopup.studentId && record.weekLabel === cwPopup.weekLabel) : [];

  function toggleWeek(label: string) {
    if (openWeek === label) {
      setOpenWeek(null);
      return;
    }
    setSelectedWeek(label);
    setOpenWeek(label);
    setActiveWorkId("");
    setNewWorkTitle(automaticWorkTitle(data, label, newWorkKind));
    setNewWorkDate(localDateKey());
  }

  function toggleSheetWeek(label: string) {
    setSelectedWeek(label);
    setNewWorkTitle(automaticWorkTitle(data, label, newWorkKind));
    setNewWorkDate(localDateKey());
    setExpandedWeeks((current) => {
      const next = new Set(current);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  function weekSummary(label: string, kind: WorkKind) {
    const items = data.workItems.filter((item) => item.weekLabel === label && item.kind === kind);
    const values = items.flatMap((item) => Object.values(item.statuses));
    return {
      items: items.length,
      ok: values.filter((value) => value === "ok").length,
      late: values.filter((value) => value === "late").length,
      notOk: values.filter((value) => value === "not_ok").length,
      recorded: values.length,
    };
  }

  function studentWorkSummary(studentId: string, kind: WorkKind) {
    const items = weekItems.filter((item) => item.kind === kind);
    if (!items.length) return kind === "homework" ? "HW —" : "CW —";
    const values = items.map((item) => item.statuses[studentId]);
    if (kind === "homework") return `HW ✓${values.filter((value) => value === "ok").length} L${values.filter((value) => value === "late").length} ✕${values.filter((value) => value === "not_ok").length}`;
    return `CW ✓${values.filter((value) => value === "ok").length} ✕${values.filter((value) => value === "not_ok").length}`;
  }

  function studentWeekWorkSummary(studentId: string, weekLabel: string, kind: WorkKind) {
    const items = data.workItems.filter((item) => item.weekLabel === weekLabel && item.kind === kind);
    const values = items.map((item) => item.statuses[studentId]);
    const noteCount = kind === "classwork" ? cwRecords.filter((record) => record.studentId === studentId && record.weekLabel === weekLabel).length : 0;
    return { items, noteCount, ok: values.filter((value) => value === "ok").length, late: values.filter((value) => value === "late").length, notOk: values.filter((value) => value === "not_ok").length + noteCount, recorded: values.filter(Boolean).length + noteCount };
  }

  function cycleWorkStatus(item: ClassroomWorkItem, studentId: string) {
    const order: Array<WorkStatus | ""> = item.kind === "homework" ? ["", "ok", "not_ok", "late"] : ["", "ok", "not_ok"];
    const current = item.statuses[studentId] ?? "";
    setWorkStatus(item, studentId, order[(order.indexOf(current) + 1) % order.length]);
  }

  function sheetWorkCell(studentId: string, weekLabel: string, kind: WorkKind) {
    const summary = studentWeekWorkSummary(studentId, weekLabel, kind);
    const linkedAssignments = kind === "homework" ? assignments.filter((assignment) => assignment.weekLabel === weekLabel) : [];
    const studentCwRecords = kind === "classwork" ? cwRecords.filter((record) => record.studentId === studentId && record.weekLabel === weekLabel) : [];
    const openCell = () => { if (kind === "classwork") openCwRecords(studentId, weekLabel); };
    return <td className={`${styles.sheetWorkCell} ${kind === "classwork" ? styles.clickableCwCell : ""}`} onClick={openCell} onKeyDown={(event) => { if (kind === "classwork" && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); openCell(); } }} tabIndex={kind === "classwork" ? 0 : undefined}><div className={styles.sheetWorkTotal}><strong>{summary.ok}/{summary.recorded} OK</strong>{summary.late ? <span>{summary.late} late</span> : null}{summary.notOk ? <span>{summary.notOk} not OK</span> : null}</div><div className={styles.sheetWorkItems}>
      {summary.items.map((item) => { const status = item.statuses[studentId]; return <div className={styles.sheetWorkItemLine} key={item.id}><button className={status ? styles[`work_${status}`] : styles.work_clear} onClick={(event) => { event.stopPropagation(); cycleWorkStatus(item, studentId); }} title={`${item.title}: ${status ? statusLabels[status] : "Clear"}. Click to change.`} type="button"><b>{item.kind === "homework" ? "HW" : "CW"}{item.position}</b><span>{status ? statusMarks[status] : "—"}</span></button>{kind === "homework" ? <button aria-label={`Delete ${item.title} for all students`} className={styles.deleteHomeworkButton} disabled={deletingWorkItemId === item.id} onClick={(event) => { event.stopPropagation(); void deleteHomework(item); }} title="Delete this homework for every student" type="button">{deletingWorkItemId === item.id ? "…" : "×"}</button> : null}</div>; })}
      {linkedAssignments.map((assignment) => { const result = assignment.results[studentId]; return <button className={`${styles.assignmentChip} ${styles[`assignment_${result?.status ?? "not_started"}`]}`} key={assignment.id} onClick={(event) => { event.stopPropagation(); setAssignmentPopupId(assignment.id); }} title={`Open live results for ${assignment.title}`} type="button"><b>{assignment.title}</b><span>{assignmentResultLabel(result)}</span></button>; })}
      {studentCwRecords.slice(0, 2).map((record) => <button className={styles.cwNotePreview} key={record.id} onClick={(event) => { event.stopPropagation(); openCell(); }} title={record.reason} type="button"><b>{record.recordDate}</b><span>{record.reason}</span></button>)}
      {kind === "classwork" ? <button className={styles.addCwInline} onClick={(event) => { event.stopPropagation(); openCell(); }} type="button">＋ {studentCwRecords.length ? `${studentCwRecords.length} note${studentCwRecords.length === 1 ? "" : "s"}` : "Add NOT OK"}</button> : null}
      {!summary.items.length && !linkedAssignments.length && kind === "homework" ? <small>—</small> : null}
    </div></td>;
  }

  function chooseRandomStudent() {
    if (!data.students.length) return;
    clearUtilityAnimationTimers();
    const order = shuffle(data.students);
    const winner = order[0];
    let index = 0;
    setUtilityOverlay({ kind: "randomizer", phase: "spinning", name: order[0].fullName });
    randomizerInterval.current = window.setInterval(() => {
      index = (index + 1) % order.length;
      setUtilityOverlay((current) => current?.kind === "randomizer" ? { ...current, name: order[index].fullName } : current);
    }, 85);
    utilityRevealTimer.current = window.setTimeout(() => {
      if (randomizerInterval.current !== null) window.clearInterval(randomizerInterval.current);
      randomizerInterval.current = null;
      setUtilityOverlay({ kind: "randomizer", phase: "result", name: winner.fullName });
      setUtilityMessage(`🎲 ${winner.fullName}`);
    }, 1900);
  }

  function makeTeams() {
    if (data.students.length < 2) return;
    clearUtilityAnimationTimers();
    const count = Math.max(2, Math.min(teamCount, data.students.length));
    const teams = Array.from({ length: count }, () => [] as string[]);
    const shuffled = shuffle(data.students);
    shuffled.forEach((student, index) => teams[index % count].push(student.fullName));
    setUtilityOverlay({ kind: "teams", phase: "mixing", teams, previewNames: shuffled.slice(0, 10).map((student) => student.fullName) });
    utilityRevealTimer.current = window.setTimeout(() => {
      setUtilityOverlay({ kind: "teams", phase: "result", teams, previewNames: [] });
      setUtilityMessage(teams.map((team, index) => `Team ${index + 1}: ${team.join(", ")}`).join("\n"));
    }, 1900);
  }

  return <div className={`${styles.page} ${embedded ? styles.embeddedPage : ""}`}>
    {embedded ? <section className={styles.embeddedHeading} id="weekly-classroom"><div><p className="eyebrow">Live classroom spreadsheet</p><h2>Weekly class record</h2><p>Every student stays visible. Click a week column to expand Stars, Skulls, HW, and CW.</p></div><div className={styles.sheetTools}><button onClick={() => setWorkCreatorOpen(true)} type="button">＋ HW / CW · {selectedWeek}</button><button disabled={!data.students.length} onClick={chooseRandomStudent} type="button">🎲 Student</button><label>Teams<select aria-label="Number of teams" disabled={data.students.length < 2} onChange={(event) => setTeamCount(Number(event.target.value))} value={Math.min(teamCount, Math.max(2, data.students.length))}>{Array.from({ length: Math.max(1, Math.min(11, data.students.length) - 1) }, (_, index) => index + 2).map((count) => <option key={count}>{count}</option>)}</select></label><button disabled={data.students.length < 2} onClick={makeTeams} type="button">Mix teams</button><button onClick={openTimer} type="button">⏱ Timer</button><a className={styles.backupButton} href="/api/stars/export">Excel backup</a><button onClick={addWeek} type="button">＋ Week</button></div></section> : <section className={styles.heading}><div><p className="eyebrow">Teacher-only classroom tools</p><h1>{data.classroom.name} Stars</h1><p>Weekly rewards, homework and classwork records. Skulls remain only in this browser for today.</p></div><div className={styles.headingActions}><a className={styles.backupButton} href="/api/stars/export">Download Excel backup</a><button onClick={addWeek} type="button">＋ Add week</button></div></section>}

    <div className={`${styles.saveBanner} ${styles[saveState]}`} role="status"><span>{saveState === "saved" ? "✓" : saveState === "syncing" ? "↻" : "●"}</span><div><strong>{saveState === "saved" ? "Safe and saved" : saveState === "syncing" ? "Saving now" : "Browser safety copy active"}</strong><p>{saveMessage}</p></div>{queueSize(queue) > 0 && isOnline ? <button onClick={() => void flushQueue()} type="button">Retry now</button> : null}</div>

    {embedded ? <section className={styles.sheetSection} aria-label="Weekly class spreadsheet">
      <div className={styles.sheetHint}><span>Click a week to expand or collapse it</span><span><i /> Current week</span><button onClick={() => { setSkulls({}); localStorage.removeItem(skullKey(data.classroom.id)); }} type="button">Reset today’s skulls</button></div>
      <div className={styles.sheetScroller}>
        <table className={styles.sheetTable}>
          <thead><tr><th className={styles.sheetStudentHead} rowSpan={2}>Student</th>{data.weeks.map((week) => { const expanded = expandedWeeks.has(week.label); return <th className={`${styles.sheetWeekHead} ${week.label === currentWeekLabel ? styles.sheetCurrentWeek : ""} ${expanded ? styles.sheetExpandedWeek : ""}`} colSpan={expanded ? 4 : 1} key={week.id}><button aria-expanded={expanded} onClick={() => toggleSheetWeek(week.label)} title={week.focus || week.title || `Week ${week.label}`} type="button"><strong>{week.label}</strong><span>{expanded ? "Collapse ←" : "Expand →"}</span>{week.label === currentWeekLabel ? <small>Current</small> : null}</button></th>; })}</tr>
          <tr>{data.weeks.map((week) => expandedWeeks.has(week.label) ? <Fragment key={week.id}><th className={`${styles.sheetSubhead} ${styles.starSubhead}`}>★ Stars</th><th className={`${styles.sheetSubhead} ${styles.skullSubhead}`}>💀 Skulls</th><th className={styles.sheetSubhead}>HW</th><th className={styles.sheetSubhead}>CW</th></Fragment> : <th className={styles.sheetSubhead} key={week.id}>Totals</th>)}</tr></thead>
          <tbody>{sortedStudents.map((student) => <tr key={student.id}><th className={styles.sheetStudentCell}><a href={`/teacher/students/${student.id}`}><span className={styles.sheetAvatar}>{student.fullName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("")}</span><span><strong>{student.fullName}</strong><small>{student.email || "Student profile"}</small></span></a></th>{data.weeks.map((week) => {
            const homework = studentWeekWorkSummary(student.id, week.label, "homework");
            const classwork = studentWeekWorkSummary(student.id, week.label, "classwork");
            if (!expandedWeeks.has(week.label)) return <td className={`${styles.sheetCollapsedCell} ${week.label === currentWeekLabel ? styles.sheetCurrentCell : ""}`} key={week.id}><strong>★ {student.totals[week.label] ?? 0}</strong><span>💀 {skulls[student.id] ?? 0}</span><small>HW {homework.ok}/{homework.recorded} · CW {classwork.ok}/{classwork.recorded}</small></td>;
            return <Fragment key={week.id}><td className={`${styles.sheetActionCell} ${styles.sheetStarCell}`}><strong>★ {student.totals[week.label] ?? 0}</strong><div><button aria-label={`Remove a Star from ${student.fullName} in ${week.label}`} disabled={(student.totals[week.label] ?? 0) <= 0} onClick={() => changeStars(student.id, -1, week.label)} type="button">−</button><button aria-label={`Add a Star to ${student.fullName} in ${week.label}`} className={styles.sheetStarAdd} onClick={() => changeStars(student.id, 1, week.label)} type="button">＋</button></div></td><td className={`${styles.sheetActionCell} ${styles.sheetSkullCell}`}><strong>💀 {skulls[student.id] ?? 0}</strong><div><button aria-label={`Clear Skulls for ${student.fullName}`} disabled={(skulls[student.id] ?? 0) === 0} onClick={() => updateSkulls(student.id, 0)} type="button">Clear</button><button aria-label={`Add a Skull to ${student.fullName}`} className={styles.sheetSkullAdd} disabled={(skulls[student.id] ?? 0) >= 3} onClick={() => updateSkulls(student.id, (skulls[student.id] ?? 0) + 1)} type="button">＋</button></div></td>{sheetWorkCell(student.id, week.label, "homework")}{sheetWorkCell(student.id, week.label, "classwork")}</Fragment>;
          })}</tr>)}</tbody>
        </table>
      </div>
    </section> : <section className={styles.weekAccordion} aria-label="Classroom weeks">
      {data.weeks.map((week) => {
        const expanded = openWeek === week.label;
        const homework = weekSummary(week.label, "homework");
        const classwork = weekSummary(week.label, "classwork");
        const stars = data.students.reduce((sum, student) => sum + (student.totals[week.label] ?? 0), 0);
        return <article className={`${styles.weekPanel} ${week.label === currentWeekLabel ? styles.currentWeekPanel : ""} ${expanded ? styles.openWeekPanel : ""}`} key={week.id}>
          <button aria-controls={`week-${week.id}`} aria-expanded={expanded} className={styles.weekToggle} onClick={() => toggleWeek(week.label)} type="button">
            <div className={styles.weekTitle}><b>{week.label}</b><span><strong>{week.focus || week.title || `Teaching week ${week.label}`}</strong><small>{week.label === currentWeekLabel ? "Current week" : "Click to open classroom"}</small></span></div>
            <div className={styles.weekMetric}><span>Stars</span><strong>★ {stars}</strong></div>
            <div className={styles.weekMetric}><span>Homework</span><strong>{homework.recorded ? `${homework.ok}/${homework.recorded} OK` : "—"}</strong><small>{homework.items} {homework.items === 1 ? "item" : "items"}{homework.late ? ` · ${homework.late} late` : ""}</small></div>
            <div className={styles.weekMetric}><span>Classwork</span><strong>{classwork.recorded ? `${classwork.ok}/${classwork.recorded} OK` : "—"}</strong><small>{classwork.items} {classwork.items === 1 ? "item" : "items"}</small></div>
            <i aria-hidden="true">⌄</i>
          </button>

          {expanded ? <div className={styles.weekPanelBody} id={`week-${week.id}`}>
            <section className={styles.controlRow}><article><span>Open week</span><strong>{selectedWeek}</strong></article><article><span>Class stars</span><strong>⭐ {classStars}</strong></article><article><span>Students</span><strong>{data.students.length}</strong></article><article><span>Skulls today</span><strong>💀 {skullTotal}</strong></article></section>

            <div className={styles.workspace}>
              <section className={styles.studentPanel}>
                <div className={styles.sectionHeader}><div><p className="eyebrow">{selectedWeek}</p><h2>Class roster</h2><p>Stars sync to Supabase. Today’s skulls stay only on this device.</p></div><button onClick={() => { setSkulls({}); localStorage.removeItem(skullKey(data.classroom.id)); }} type="button">Reset today’s skulls</button></div>
                <div className={styles.studentGrid}>{sortedStudents.map((student) => <article className={`${styles.studentCard} ${(skulls[student.id] ?? 0) > 0 ? styles.warned : ""} ${rewardEffect?.studentId === student.id && rewardEffect.kind === "star" ? styles.starAwarded : ""} ${rewardEffect?.studentId === student.id && rewardEffect.kind !== "star" ? styles.skullMarked : ""}`} key={student.id}>
                  <div className={styles.studentIdentity}><span className={styles.avatar}>{student.fullName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("")}</span><div><strong>{student.fullName}</strong><small>{studentWorkSummary(student.id, "homework")} · {studentWorkSummary(student.id, "classwork")}</small></div></div>
                  <div className={styles.studentScores}><b>⭐ {student.totals[selectedWeek] ?? 0}</b><span>💀 {skulls[student.id] ?? 0}/3</span></div>
                  <div className={styles.studentActions}><button className={styles.starAdd} onClick={() => changeStars(student.id, 1)} type="button">＋ ⭐</button><button disabled={(student.totals[selectedWeek] ?? 0) <= 0} onClick={() => changeStars(student.id, -1)} type="button">− ⭐</button><button className={styles.skullAdd} disabled={(skulls[student.id] ?? 0) >= 3} onClick={() => updateSkulls(student.id, (skulls[student.id] ?? 0) + 1)} type="button">＋ 💀</button>{(skulls[student.id] ?? 0) > 0 ? <button onClick={() => updateSkulls(student.id, 0)} type="button">Clear 💀</button> : null}</div>
                </article>)}</div>
              </section>

              <aside className={styles.sidebar}>
                <section className={styles.utilityCard}><p className="eyebrow">Classroom utilities</p><h2>Quick tools</h2><div className={styles.utilityActions}><button disabled={!data.students.length} onClick={chooseRandomStudent} type="button">🎲 Random student</button><label>Teams<select disabled={data.students.length < 2} onChange={(event) => setTeamCount(Number(event.target.value))} value={Math.min(teamCount, Math.max(2, data.students.length))}>{Array.from({ length: Math.max(1, Math.min(11, data.students.length) - 1) }, (_, index) => index + 2).map((count) => <option key={count}>{count}</option>)}</select></label><button disabled={data.students.length < 2} onClick={makeTeams} type="button">Mix teams</button></div><pre>{utilityMessage}</pre></section>
                <section className={styles.timerCard}><span>Ready for Math</span><strong>{formatTimer(timer)}</strong><p>Backpacks away · laptops closed · notebook and pen out.</p><div><button onClick={openTimer} type="button">{timerRunning ? "Show timer" : "Open timer"}</button><button onClick={() => { setTimerRunning(false); setTimerDuration(60); setTimer(60); }} type="button">Reset</button></div></section>
              </aside>
            </div>

            <section className={styles.workSection}>
              <div className={styles.sectionHeader}><div><p className="eyebrow">Weekly records</p><h2>Homework and classwork</h2><p>Select a record to edit every student’s status. Changes save automatically.</p></div><button className={styles.workAddButton} onClick={() => setWorkCreatorOpen(true)} type="button">＋ Add HW / CW</button></div>
              {weekItems.length ? <><div className={styles.workTabs}>{weekItems.map((item) => <button className={activeWork?.id === item.id ? styles.activeTab : ""} key={item.id} onClick={() => setActiveWorkId(item.id)} type="button"><b>{item.kind === "homework" ? `HW${item.position}` : `CW${item.position}`}</b><span>{item.title}</span></button>)}</div>{activeWork ? <div className={styles.statusTable}><header><div className={styles.workEditor}><label><span>Name</span><input maxLength={120} onBlur={() => editWorkItem(activeWork, { title: activeWork.title.trim() || `${activeWork.kind === "homework" ? "HW" : "CW"} ${activeWork.position}` }, true)} onChange={(event) => editWorkItem(activeWork, { title: event.target.value }, false)} value={activeWork.title} /></label><label><span>Date</span><input onChange={(event) => editWorkItem(activeWork, { activityDate: event.target.value || null }, true)} type="date" value={activeWork.activityDate || ""} /></label><small>{activeWork.kind === "homework" ? "OK / Not OK / Late" : "OK / Not OK"} · changes save automatically</small></div></header>{sortedStudents.map((student) => { const options: WorkStatus[] = activeWork.kind === "homework" ? ["ok", "not_ok", "late"] : ["ok", "not_ok"]; const current = activeWork.statuses[student.id]; return <div className={styles.statusRow} key={student.id}><strong>{student.fullName}</strong><div>{options.map((status) => <button className={current === status ? styles.activeStatus : ""} key={status} onClick={() => setWorkStatus(activeWork, student.id, status)} type="button">{statusLabels[status]}</button>)}<button className={!current ? styles.activeStatus : ""} onClick={() => setWorkStatus(activeWork, student.id, "")} type="button">Clear</button></div></div>; })}</div> : null}</> : <p className={styles.emptyState}>No homework or classwork has been added for {selectedWeek}. Use Add HW / CW to create the first record.</p>}
            </section>
          </div> : null}
        </article>;
      })}
    </section>}

    <section className={styles.importSection}>
      <div><p className="eyebrow">Safe migration</p><h2>Import the old Excel workbook</h2><p>Jaguar matches by existing profile and Google Classroom names. Excel IDs are ignored; uncertain or missing students are reported and skipped. No accounts are ever created.</p></div>
      <div className={styles.importControls}><input accept=".xlsx" onChange={(event) => { setWorkbook(event.target.files?.[0] ?? null); setImportPreview(null); setImportMessage(""); }} type="file" /><button disabled={!workbook || importing || queueSize(queue) > 0} onClick={() => void submitWorkbook("preview")} type="button">{importing ? "Checking…" : "Smart-match preview"}</button>{importPreview?.counts.matched ? <button className={styles.importButton} disabled={importing || queueSize(queue) > 0} onClick={() => void submitWorkbook("import")} type="button">Import {importPreview.counts.matched} matched students</button> : null}</div>
      {queueSize(queue) > 0 ? <p className={styles.importNote}>Finish syncing browser changes before importing a workbook.</p> : null}
      {importMessage ? <p className={styles.importMessage} role="status">{importMessage}</p> : null}
      {importPreview ? <div className={styles.importReport}><div className={styles.reportStats}><article><span>Matched safely</span><strong>{importPreview.counts.matched}</strong></article><article><span>Needs review</span><strong>{importPreview.counts.ambiguous}</strong></article><article><span>Excel-only skipped</span><strong>{importPreview.counts.excelOnly}</strong></article><article><span>Jaguar-only</span><strong>{importPreview.counts.jaguarOnly}</strong></article></div><details open={importPreview.counts.ambiguous + importPreview.counts.excelOnly > 0}><summary>Matching report for {importPreview.sheetName}</summary><div className={styles.matchList}>{importPreview.matches.map((match) => <div className={styles[match.outcome]} key={match.excelName}><strong>{match.excelName}</strong><span>{match.outcome === "matched" ? `→ ${match.matchedStudentName} (${match.confidence}%)` : match.outcome === "ambiguous" ? `Needs review${match.suggestions?.length ? `: ${match.suggestions.join(" or ")}` : ""}` : "Not found in this Jaguar class — skipped"}</span><small>{match.reason}</small></div>)}{importPreview.missingFromWorkbook.map((student) => <div className={styles.jaguarOnly} key={student.studentName}><strong>{student.studentName}</strong><span>Existing Jaguar student, not found in Excel</span><small>Kept on the Stars page with no imported history.</small></div>)}</div></details></div> : null}
    </section>
    {assignmentPopupId && assignments.find((assignment) => assignment.id === assignmentPopupId) ? <AssignmentResultsPopup assignment={assignments.find((assignment) => assignment.id === assignmentPopupId)!} onClose={() => setAssignmentPopupId(null)} students={sortedStudents} updatedAt={assignmentsUpdatedAt} /> : null}
    {cwPopup && cwPopupStudent ? <div className={`${styles.popupBackdrop} ${styles.cwBackdrop}`} role="presentation"><section aria-label={`Classwork records for ${cwPopupStudent.fullName} in ${cwPopup.weekLabel}`} aria-modal="true" className={`${styles.classroomPopup} ${styles.cwPopup}`} role="dialog"><button aria-label="Close popup" className={styles.popupClose} onClick={() => setCwPopup(null)} type="button">×</button><header><p className={styles.popupEyebrow}>Week {cwPopup.weekLabel} · Classwork</p><h2>{cwPopupStudent.fullName}</h2><p>Add a dated Not OK record for this student only. The CW cell stays compact and shows the saved notes.</p></header><form onSubmit={(event) => { event.preventDefault(); void addCwRecord(); }}><label><span>Date</span><input onChange={(event) => setCwRecordDate(event.target.value)} required type="date" value={cwRecordDate} /></label><label><span>Reason / note</span><textarea autoFocus maxLength={500} onChange={(event) => setCwReason(event.target.value)} placeholder="Why was this classwork Not OK?" required rows={3} value={cwReason} /></label><div><span className={styles.cwNotOkPill}>Not OK CW</span><button disabled={cwBusy || !cwReason.trim()} type="submit">{cwBusy ? "Saving…" : "Save record"}</button></div></form>{cwMessage ? <p className={styles.cwMessage} role="status">{cwMessage}</p> : null}<section className={styles.cwRecordList}><div><strong>Saved records</strong><span>{cwPopupRecords.length}</span></div>{cwPopupRecords.length ? cwPopupRecords.map((record) => <article key={record.id}><time dateTime={record.recordDate}>{record.recordDate}</time><p>{record.reason}</p><button aria-label={`Delete classwork note from ${record.recordDate}`} disabled={cwBusy} onClick={() => void deleteCwRecord(record)} type="button">Delete</button></article>) : <p>No classwork notes for this student in {cwPopup.weekLabel} yet.</p>}</section></section></div> : null}
    {workCreatorOpen ? <div className={`${styles.popupBackdrop} ${styles.workBackdrop}`} role="presentation"><form aria-label={`Add homework or classwork to ${selectedWeek}`} aria-modal="true" className={`${styles.classroomPopup} ${styles.workPopup}`} onSubmit={(event) => { event.preventDefault(); addWorkItem(); }} role="dialog"><button aria-label="Close popup" className={styles.popupClose} onClick={() => setWorkCreatorOpen(false)} type="button">×</button><div aria-hidden="true" className={styles.workPopupIcon}>{newWorkKind === "homework" ? "HW" : "CW"}</div><p className={styles.popupEyebrow}>Week {selectedWeek}</p><h2>Add {newWorkKind === "homework" ? "homework" : "classwork"}</h2><p className={styles.popupHint}>Every student starts as OK. Open the new record afterward to mark Late, Not OK, or Clear.</p><div className={styles.workPopupFields}><label><span>Record type</span><select aria-label="Work type" onChange={(event) => { const kind = event.target.value as WorkKind; setNewWorkKind(kind); setNewWorkTitle(automaticWorkTitle(data, selectedWeek, kind)); }} value={newWorkKind}><option value="homework">Homework</option><option value="classwork">Classwork</option></select></label><label><span>Title</span><input aria-label="Work title" autoFocus maxLength={120} onChange={(event) => setNewWorkTitle(event.target.value)} placeholder={newWorkKind === "homework" ? "Homework title" : "Classwork title"} required value={newWorkTitle} /></label><label><span>Activity date</span><input aria-label="Activity date" onChange={(event) => setNewWorkDate(event.target.value)} type="date" value={newWorkDate} /></label></div><button className={styles.popupAction} disabled={!newWorkTitle.trim()} type="submit">Add to {selectedWeek}</button></form></div> : null}
    {utilityOverlay ? <UtilityPopup onClose={closeUtilityOverlay} onPickAgain={chooseRandomStudent} onRemix={makeTeams} onSetTimer={setClassTimer} onToggleTimer={() => timer === 0 ? setClassTimer(timerDuration) : setTimerRunning((value) => !value)} overlay={utilityOverlay} timer={timer} timerDuration={timerDuration} timerRunning={timerRunning} /> : null}
    {rewardEffect ? <RewardAnimation effect={rewardEffect} key={rewardEffect.id} onClose={closeReward} /> : null}
  </div>;
}
