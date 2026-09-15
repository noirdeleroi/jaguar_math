"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import type { AvailableClassroomAssessment, ClassroomCwRecord, ClassroomGrade, ClassroomGradeColumn, ClassroomHomeworkAssignment, ClassroomStarState, ClassroomSyncPayload, ClassroomWorkItem, QueuedSkullEvent, QueuedStarEvent, WorkKind, WorkStatus } from "@/lib/classroom-stars";
import { gradebookColumnClipboardText, workStatusGrade } from "@/lib/gradebook-column-export";
import { GradeColumnDialog, ManualGradeCell, WorkColumnDialog } from "./gradebook-controls";
import gradebookStyles from "./class-gradebook.module.css";
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
  | { kind: "randomizer"; phase: "spinning"; name: string; previousName: string; nextName: string; shuffleStep: number }
  | { kind: "randomizer"; phase: "result"; name: string }
  | { kind: "teams"; phase: "mixing" | "result"; teams: string[][]; previewNames: string[] }
  | { kind: "timer" };
type RewardEffect = { id: string; kind: "star" | "skull" | "death"; studentId: string; studentName: string };
type SheetDatedColumn =
  | { type: "work"; id: string; date: string | null; item: ClassroomWorkItem }
  | { type: "grade"; id: string; date: string; column: ClassroomGradeColumn }
  | { type: "assignment"; id: string; date: string | null; assignment: ClassroomHomeworkAssignment };

const rewardParticles = Array.from({ length: 18 }, (_, index) => index);

const emptyQueue = (): ClassroomSyncPayload => ({ weeks: [], starEvents: [], skullEvents: [], workItems: [], workStatuses: [] });
const queueSize = (queue: ClassroomSyncPayload) => queue.weeks.length + queue.starEvents.length + queue.skullEvents.length + queue.workItems.length + queue.workStatuses.length;
const statusLabels: Record<WorkStatus, string> = { late: "Late", ok: "OK", not_ok: "Not OK" };

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
function shortDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
}
function legacySkullKey(classId: string) { return `jaguar-stars-skulls:${classId}:${localDateKey()}`; }
function bogotaDateKey(value: string | Date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function readQueue(classId: string): ClassroomSyncPayload {
  try {
    const parsed = JSON.parse(localStorage.getItem(queueKey(classId)) || "null") as Partial<ClassroomSyncPayload> | null;
    if (!parsed || !Array.isArray(parsed.starEvents)) return emptyQueue();
    return {
      weeks: Array.isArray(parsed.weeks) ? parsed.weeks : [],
      starEvents: parsed.starEvents,
      skullEvents: Array.isArray(parsed.skullEvents) ? parsed.skullEvents : [],
      workItems: Array.isArray(parsed.workItems) ? parsed.workItems : [],
      workStatuses: Array.isArray(parsed.workStatuses) ? parsed.workStatuses : [],
    };
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
    skullEvents: [...current.skullEvents, ...(additions.skullEvents ?? [])],
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
  const sentSkullEvents = new Set(sent.skullEvents.map((item) => item.id));
  const sentItems = new Map(sent.workItems.map((item) => [itemOperationKey(item), JSON.stringify(item)]));
  const sentStatuses = new Map(sent.workStatuses.map((item) => [statusOperationKey(item), JSON.stringify(item)]));
  return {
    weeks: current.weeks.filter((item) => sentWeeks.get(item.label) !== JSON.stringify(item)),
    starEvents: current.starEvents.filter((item) => !sentEvents.has(item.id)),
    skullEvents: current.skullEvents.filter((item) => !sentSkullEvents.has(item.id)),
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
    skullEventIds: [...initial.skullEventIds],
  };
  for (const week of queue.weeks) if (!next.weeks.some((item) => item.label === week.label)) next.weeks.push({ id: week.id, label: week.label, sortOrder: week.sort_order, title: week.title || null, focus: week.focus || null });
  const knownEvents = new Set(next.eventIds);
  for (const event of queue.starEvents) {
    if (knownEvents.has(event.id)) continue;
    const student = next.students.find((item) => item.id === event.student_id);
    if (student) student.totals[event.week_label] = Math.max(0, (student.totals[event.week_label] ?? 0) + event.delta);
  }
  const knownSkullEvents = new Set(next.skullEventIds);
  const today = bogotaDateKey(new Date());
  for (const event of queue.skullEvents) {
    if (knownSkullEvents.has(event.id)) continue;
    const student = next.students.find((item) => item.id === event.student_id);
    if (!student) continue;
    const occurredToday = bogotaDateKey(event.occurred_at) === today;
    if (event.action === "add") {
      student.skullsTotal += 1;
      if (occurredToday) student.skullsToday += 1;
    } else if (occurredToday) student.skullsToday = 0;
    next.skullEventIds.push(event.id);
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
        <p className={styles.popupEyebrow}>{overlay.phase === "spinning" ? "Shuffling class nicknames…" : "You’re up!"}</p>
        <div aria-live={overlay.phase === "result" ? "assertive" : "off"} className={`${styles.nicknameShuffleStage} ${overlay.phase === "result" ? styles.nicknameShuffleResult : ""}`}>
          {overlay.phase === "spinning" ? <div className={styles.nicknameReel} key={overlay.shuffleStep}>
            <span aria-hidden="true">{overlay.previousName}</span>
            <strong>{overlay.name}</strong>
            <span aria-hidden="true">{overlay.nextName}</span>
          </div> : <><div aria-hidden="true" className={styles.winnerBurst}>{rewardParticles.slice(0, 12).map((particle) => <i key={particle} style={{ "--particle": particle } as CSSProperties}>✦</i>)}</div><strong className={`${styles.rouletteName} ${styles.rouletteWinner}`}>{overlay.name}</strong></>}
        </div>
        <p className={styles.popupHint}>{overlay.phase === "spinning" ? "Every nickname is in the mix." : "The classroom has spoken."}</p>
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

export default function StarClassroom({ initialState, currentWeekLabel, embedded = false, initialAssignments = [], initialGradeColumns = [], availableAssessments: initialAvailableAssessments = [], initialCwRecords = [] }: { initialState: ClassroomStarState; currentWeekLabel: string; embedded?: boolean; initialAssignments?: ClassroomHomeworkAssignment[]; initialGradeColumns?: ClassroomGradeColumn[]; availableAssessments?: AvailableClassroomAssessment[]; initialCwRecords?: ClassroomCwRecord[] }) {
  const router = useRouter();
  const [data, setData] = useState(initialState);
  const [selectedWeek, setSelectedWeek] = useState(() => initialWeek(initialState, currentWeekLabel));
  const [openWeek, setOpenWeek] = useState<string | null>(() => initialWeek(initialState, currentWeekLabel));
  const [expandedWeeks, setExpandedWeeks] = useState<Set<string>>(() => new Set([initialWeek(initialState, currentWeekLabel)]));
  const [queue, setQueue] = useState<ClassroomSyncPayload>(emptyQueue);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [saveMessage, setSaveMessage] = useState("Everything is safely saved in Jaguar.");
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
  const [gradeColumns, setGradeColumns] = useState(initialGradeColumns);
  const [availableAssessments, setAvailableAssessments] = useState(initialAvailableAssessments);
  const [gradeColumnDialog, setGradeColumnDialog] = useState<ClassroomGradeColumn | "new" | null>(null);
  const [copiedColumnId, setCopiedColumnId] = useState<string | null>(null);
  const [assignmentPopupId, setAssignmentPopupId] = useState<string | null>(null);
  const [assignmentsUpdatedAt, setAssignmentsUpdatedAt] = useState<Date | null>(null);
  const [cwRecords, setCwRecords] = useState(initialCwRecords);
  const [cwPopup, setCwPopup] = useState<{ studentId: string; weekLabel: string } | null>(null);
  const [cwRecordDate, setCwRecordDate] = useState(localDateKey);
  const [cwReason, setCwReason] = useState("");
  const [cwMessage, setCwMessage] = useState("");
  const [cwBusy, setCwBusy] = useState(false);
  const [workColumnDialog, setWorkColumnDialog] = useState<ClassroomWorkItem | null>(null);
  const [workbook, setWorkbook] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importMessage, setImportMessage] = useState("");
  const [importing, setImporting] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const syncing = useRef(false);
  const randomizerShuffleTimer = useRef<number | null>(null);
  const utilityRevealTimer = useRef<number | null>(null);
  const rewardTimer = useRef<number | null>(null);
  const sheetScrollerRef = useRef<HTMLDivElement>(null);
  const sheetTableRef = useRef<HTMLTableElement>(null);
  const frozenSheetHeaderRef = useRef<HTMLDivElement>(null);
  const blockingOverlayOpen = Boolean(utilityOverlay || workCreatorOpen || assignmentPopupId || cwPopup || gradeColumnDialog || workColumnDialog || rewardEffect?.kind === "death");

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
    let pending = readQueue(initialState.classroom.id);
    try {
      const legacy = JSON.parse(localStorage.getItem(legacySkullKey(initialState.classroom.id)) || "null") as Record<string, number> | null;
      const legacyEvents: QueuedSkullEvent[] = Object.entries(legacy ?? {}).flatMap(([studentId, count]) => Array.from({ length: Math.max(0, Math.floor(Number(count) || 0)) }, (_, index) => ({ id: crypto.randomUUID(), student_id: studentId, action: "add" as const, source: navigator.onLine ? "classroom" as const : "offline_queue" as const, occurred_at: new Date(Date.now() + index).toISOString() })));
      if (legacyEvents.length) {
        pending = mergeQueue(pending, { skullEvents: legacyEvents });
        writeQueue(initialState.classroom.id, pending);
      }
      localStorage.removeItem(legacySkullKey(initialState.classroom.id));
    } catch { /* Ignore malformed legacy-only browser data. */ }
    const hydrationTimer = window.setTimeout(() => {
      setQueue(pending);
      if (queueSize(pending)) {
        setData((current) => applyPending(current, pending));
        void flushQueue(pending);
      }
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
    if (!embedded) return;
    const scroller = sheetScrollerRef.current;
    const table = sheetTableRef.current;
    const frozenHeader = frozenSheetHeaderRef.current;
    const sourceHeader = table?.tHead;
    if (!scroller || !table || !frozenHeader || !sourceHeader) return;

    let frame = 0;

    const syncPosition = () => {
      const scrollerRect = scroller.getBoundingClientRect();
      const headerHeight = sourceHeader.getBoundingClientRect().height;
      const left = Math.max(0, scrollerRect.left);
      const right = Math.min(window.innerWidth, scrollerRect.right);
      const visible = scrollerRect.top < 0 && scrollerRect.bottom > headerHeight && right > left;

      frozenHeader.hidden = !visible;
      if (!visible) return;
      frozenHeader.style.left = `${left}px`;
      frozenHeader.style.width = `${right - left}px`;
      frozenHeader.style.height = `${headerHeight}px`;
      frozenHeader.scrollLeft = scroller.scrollLeft + left - scrollerRect.left;
    };

    const requestSync = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(syncPosition);
    };

    const rebuildHeader = () => {
      const sourceCells = table.querySelectorAll<HTMLTableCellElement>("tbody tr:first-child > th, tbody tr:first-child > td");
      const widths = Array.from(sourceCells, (cell) => cell.getBoundingClientRect().width);
      const frozenTable = document.createElement("table");
      frozenTable.className = table.className;
      frozenTable.setAttribute("aria-hidden", "true");

      if (widths.length) {
        const colgroup = document.createElement("colgroup");
        widths.forEach((width) => {
          const column = document.createElement("col");
          column.style.width = `${width}px`;
          colgroup.append(column);
        });
        frozenTable.style.width = `${widths.reduce((sum, width) => sum + width, 0)}px`;
        frozenTable.style.tableLayout = "fixed";
        frozenTable.append(colgroup);
      } else {
        frozenTable.style.width = `${table.getBoundingClientRect().width}px`;
      }

      const clonedHeader = sourceHeader.cloneNode(true) as HTMLTableSectionElement;
      clonedHeader.querySelectorAll<HTMLElement>("a, button, input, select, textarea, [tabindex]").forEach((element) => { element.tabIndex = -1; });
      frozenTable.append(clonedHeader);
      frozenHeader.replaceChildren(frozenTable);
      syncPosition();
    };

    rebuildHeader();
    scroller.addEventListener("scroll", requestSync, { passive: true });
    window.addEventListener("scroll", requestSync, { passive: true });
    window.addEventListener("resize", rebuildHeader);
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(rebuildHeader);
    resizeObserver?.observe(table);
    resizeObserver?.observe(scroller);

    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      scroller.removeEventListener("scroll", requestSync);
      window.removeEventListener("scroll", requestSync);
      window.removeEventListener("resize", rebuildHeader);
      frozenHeader.hidden = true;
      frozenHeader.replaceChildren();
    };
  }, [assignments, data.weeks, data.workItems, embedded, expandedWeeks, gradeColumns]);

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
      if (randomizerShuffleTimer.current !== null) window.clearTimeout(randomizerShuffleTimer.current);
      if (utilityRevealTimer.current !== null) window.clearTimeout(utilityRevealTimer.current);
      randomizerShuffleTimer.current = null;
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
    if (randomizerShuffleTimer.current !== null) window.clearTimeout(randomizerShuffleTimer.current);
    if (utilityRevealTimer.current !== null) window.clearTimeout(utilityRevealTimer.current);
    if (rewardTimer.current !== null) window.clearTimeout(rewardTimer.current);
  }, []);

  function clearUtilityAnimationTimers() {
    if (randomizerShuffleTimer.current !== null) window.clearTimeout(randomizerShuffleTimer.current);
    if (utilityRevealTimer.current !== null) window.clearTimeout(utilityRevealTimer.current);
    randomizerShuffleTimer.current = null;
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

  function addSkull(studentId: string) {
    const student = data.students.find((item) => item.id === studentId);
    if (!student || student.skullsToday >= 3) return;
    const nextToday = student.skullsToday + 1;
    const event: QueuedSkullEvent = { id: crypto.randomUUID(), student_id: studentId, action: "add", source: navigator.onLine ? "classroom" : "offline_queue", occurred_at: new Date().toISOString() };
    setData((current) => ({ ...current, students: current.students.map((item) => item.id === studentId ? { ...item, skullsToday: item.skullsToday + 1, skullsTotal: item.skullsTotal + 1 } : item) }));
    enqueue({ skullEvents: [event] });
    showReward(nextToday === 3 ? "death" : "skull", student.id, student.fullName);
  }

  function clearStudentSkullsToday(studentId: string) {
    const student = data.students.find((item) => item.id === studentId);
    if (!student || student.skullsToday === 0) return;
    const event: QueuedSkullEvent = { id: crypto.randomUUID(), student_id: studentId, action: "clear_today", source: navigator.onLine ? "classroom" : "offline_queue", occurred_at: new Date().toISOString() };
    setData((current) => ({ ...current, students: current.students.map((item) => item.id === studentId ? { ...item, skullsToday: 0 } : item) }));
    enqueue({ skullEvents: [event] });
  }

  function clearAllSkullsToday() {
    const studentsWithSkulls = data.students.filter((student) => student.skullsToday > 0);
    if (!studentsWithSkulls.length) return;
    const occurredAt = new Date().toISOString();
    const events: QueuedSkullEvent[] = studentsWithSkulls.map((student) => ({ id: crypto.randomUUID(), student_id: student.id, action: "clear_today", source: navigator.onLine ? "classroom" : "offline_queue", occurred_at: occurredAt }));
    setData((current) => ({ ...current, students: current.students.map((student) => ({ ...student, skullsToday: 0 })) }));
    enqueue({ skullEvents: events });
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
  const skullsTodayTotal = data.students.reduce((sum, student) => sum + student.skullsToday, 0);
  const accumulatedSkullTotal = data.students.reduce((sum, student) => sum + student.skullsTotal, 0);
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

  function chooseRandomStudent() {
    if (!data.students.length) return;
    clearUtilityAnimationTimers();
    const order = shuffle(data.students);
    const winner = order[0];
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const steps = reducedMotion ? 2 : 24;
    const frame = (step: number) => {
      const index = step % order.length;
      const previous = (index - 1 + order.length) % order.length;
      const next = (index + 1) % order.length;
      return { kind: "randomizer" as const, phase: "spinning" as const, name: order[index].nickname, previousName: order[previous].nickname, nextName: order[next].nickname, shuffleStep: step };
    };
    const revealWinner = () => {
      randomizerShuffleTimer.current = null;
      setUtilityOverlay({ kind: "randomizer", phase: "result", name: winner.nickname });
      setUtilityMessage(`🎲 ${winner.nickname}`);
    };
    let step = 0;
    setUtilityOverlay(frame(step));
    const advance = () => {
      step += 1;
      if (step >= steps) {
        utilityRevealTimer.current = window.setTimeout(revealWinner, reducedMotion ? 80 : 260);
        return;
      }
      setUtilityOverlay(frame(step));
      const progress = step / (steps - 1);
      const delay = reducedMotion ? 80 : Math.round(58 + progress ** 3 * 235);
      randomizerShuffleTimer.current = window.setTimeout(advance, delay);
    };
    randomizerShuffleTimer.current = window.setTimeout(advance, reducedMotion ? 80 : 58);
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

  function sheetColumnsForWeek(weekLabel: string): SheetDatedColumn[] {
    const representedAssignments = new Set(gradeColumns.flatMap((column) => column.assignmentId ? [column.assignmentId] : []));
    const columns: SheetDatedColumn[] = [
      ...data.workItems.filter((item) => item.weekLabel === weekLabel).map((item): SheetDatedColumn => ({ type: "work", id: `work:${item.id}`, date: item.activityDate, item })),
      ...gradeColumns.filter((column) => column.weekLabel === weekLabel).map((column): SheetDatedColumn => ({ type: "grade", id: `grade:${column.id}`, date: column.assessmentDate, column })),
      ...assignments.filter((assignment) => assignment.weekLabel === weekLabel && !representedAssignments.has(assignment.id)).map((assignment): SheetDatedColumn => ({ type: "assignment", id: `assignment:${assignment.id}`, date: assignment.dueAt?.slice(0, 10) ?? null, assignment })),
    ];
    return columns.sort((first, second) => (first.date ?? "9999-12-31").localeCompare(second.date ?? "9999-12-31") || first.id.localeCompare(second.id));
  }

  function saveGradeColumn(savedColumn: ClassroomGradeColumn) {
    setGradeColumns((current) => current.some((column) => column.id === savedColumn.id) ? current.map((column) => column.id === savedColumn.id ? savedColumn : column) : [...current, savedColumn]);
    if (savedColumn.assignmentId) setAvailableAssessments((current) => current.filter((assessment) => assessment.id !== savedColumn.assignmentId));
    setExpandedWeeks((current) => new Set([...current, savedColumn.weekLabel]));
    setGradeColumnDialog(null);
    router.refresh();
  }

  function deleteGradeColumn(columnId: string) {
    setGradeColumns((current) => current.filter((column) => column.id !== columnId));
    setGradeColumnDialog(null);
    router.refresh();
  }

  function saveManualGrade(columnId: string, studentId: string, grade: ClassroomGrade | null) {
    setGradeColumns((current) => current.map((column) => {
      if (column.id !== columnId) return column;
      const scores = { ...column.scores };
      if (grade) scores[studentId] = grade;
      else delete scores[studentId];
      const values = Object.values(scores).map((score) => score.percent);
      return { ...column, scores, average: values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null };
    }));
  }

  function saveWorkColumn(item: ClassroomWorkItem) {
    setData((current) => ({ ...current, workItems: current.workItems.map((workItem) => workItem.id === item.id ? item : workItem) }));
    setWorkColumnDialog(null);
    router.refresh();
  }

  function deleteWorkColumn(itemId: string) {
    setData((current) => ({ ...current, workItems: current.workItems.filter((item) => item.id !== itemId) }));
    if (activeWorkId === itemId) setActiveWorkId("");
    setWorkColumnDialog(null);
    router.refresh();
  }

  async function copyGradebookColumn(sheetColumn: SheetDatedColumn) {
    const enrolledStudentIds = new Set(data.students.map((student) => student.id));
    const text = gradebookColumnClipboardText(data.gradebookRoster, enrolledStudentIds, (studentId) => {
      if (sheetColumn.type === "work") return workStatusGrade(sheetColumn.item.statuses[studentId]);
      if (sheetColumn.type === "assignment") {
        const result = sheetColumn.assignment.results[studentId];
        return result?.status === "submitted" ? result.score : null;
      }
      return sheetColumn.column.scores[studentId]?.score;
    });
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedColumnId(sheetColumn.id);
      window.setTimeout(() => setCopiedColumnId((current) => current === sheetColumn.id ? null : current), 1800);
    } catch {
      setSaveState("error");
      setSaveMessage("The grade column could not be copied. Allow clipboard access, then try again.");
    }
  }

  function copyColumnButton(sheetColumn: SheetDatedColumn) {
    const copied = copiedColumnId === sheetColumn.id;
    return <button aria-label={`Copy ${sheetColumn.type === "work" ? sheetColumn.item.title : sheetColumn.type === "assignment" ? sheetColumn.assignment.title : sheetColumn.column.title} grades in official gradebook order`} className={gradebookStyles.copyColumnButton} disabled={!data.gradebookRoster.length} onClick={() => void copyGradebookColumn(sheetColumn)} title={data.gradebookRoster.length ? "Copy one spreadsheet-ready value per official gradebook row" : "Official gradebook roster is not available"} type="button">{copied ? "✓ Copied" : "Copy grades"}</button>;
  }

  function sheetColumnHeader(sheetColumn: SheetDatedColumn) {
    if (sheetColumn.type === "work") {
      const { item } = sheetColumn;
      return <th className={`${gradebookStyles.datedColumnHead} ${item.kind === "homework" ? gradebookStyles.homeworkHead : gradebookStyles.classworkHead}`} key={sheetColumn.id}><div><strong>{item.kind === "homework" ? "HW" : "CW"}{item.position}</strong><span>{item.title}</span><small>{item.activityDate ? shortDate(item.activityDate) : "No date"}</small><div className={gradebookStyles.headerActions}>{copyColumnButton(sheetColumn)}<button aria-label={`Edit ${item.title} column`} onClick={() => setWorkColumnDialog(item)} type="button">Edit</button></div></div></th>;
    }
    if (sheetColumn.type === "assignment") {
      return <th className={`${gradebookStyles.datedColumnHead} ${gradebookStyles.assignmentHead}`} key={sheetColumn.id}><div><strong>Online HW</strong><span>{sheetColumn.assignment.title}</span><small>{sheetColumn.date ? shortDate(sheetColumn.date) : "No due date"} · {sheetColumn.assignment.status}</small><div className={gradebookStyles.headerActions}>{copyColumnButton(sheetColumn)}</div></div></th>;
    }
    const { column } = sheetColumn;
    return <th className={gradebookStyles.assessmentHead} key={sheetColumn.id}><div>{column.assignmentId ? <a href={`/teacher/assignments/${column.assignmentId}`}><strong>{column.title}</strong></a> : <strong>{column.title}</strong>}<span>{shortDate(column.assessmentDate)} · {column.source === "manual" ? `Manual / ${column.maxScore}` : "Auto test"}</span><small>{column.average === null ? "No grades" : `Avg ${column.average}%`}</small><div className={gradebookStyles.headerActions}>{copyColumnButton(sheetColumn)}<button aria-label={`Edit ${column.title} column`} onClick={() => setGradeColumnDialog(column)} type="button">Edit</button></div></div></th>;
  }

  function sheetColumnCell(sheetColumn: SheetDatedColumn, student: ClassroomStarState["students"][number]) {
    if (sheetColumn.type === "work") {
      const { item } = sheetColumn;
      const status = item.statuses[student.id];
      const statusLabel = status === "ok" ? (item.kind === "homework" ? "Done" : "OK") : status === "not_ok" ? (item.kind === "homework" ? "Missing" : "Not OK") : status === "late" ? "Late" : "—";
      const noteCount = item.kind === "classwork" ? cwRecords.filter((record) => record.studentId === student.id && record.weekLabel === item.weekLabel).length : 0;
      return <td className={gradebookStyles.workStatusCell} key={sheetColumn.id}><button className={status ? gradebookStyles[`work_${status}`] : gradebookStyles.work_clear} onClick={() => cycleWorkStatus(item, student.id)} title={`${item.title}: ${statusLabel}. Click to change.`} type="button"><strong>{statusLabel}</strong><span>Click to change</span></button>{item.kind === "classwork" ? <button className={gradebookStyles.cwNoteButton} onClick={() => openCwRecords(student.id, item.weekLabel)} type="button">{noteCount ? `${noteCount} note${noteCount === 1 ? "" : "s"}` : "+ note"}</button> : null}</td>;
    }
    if (sheetColumn.type === "assignment") {
      const result = sheetColumn.assignment.results[student.id];
      return <td className={`${gradebookStyles.assessmentCell} ${gradebookStyles.onlineHomeworkCell}`} key={sheetColumn.id}><button onClick={() => setAssignmentPopupId(sheetColumn.assignment.id)} type="button"><strong>{assignmentResultLabel(result)}</strong><span>{result?.status === "submitted" && result.score !== null ? `${result.score}/${result.maxScore}` : "Open results"}</span></button></td>;
    }
    const { column } = sheetColumn;
    const score = column.scores[student.id];
    if (column.source === "manual") return <ManualGradeCell classId={data.classroom.id} column={column} key={sheetColumn.id} onSaved={(grade) => saveManualGrade(column.id, student.id, grade)} studentId={student.id} studentName={student.fullName} />;
    return <td className={gradebookStyles.assessmentCell} key={sheetColumn.id}>{score && column.assignmentId && score.attemptId ? <a href={`/teacher/assignments/${column.assignmentId}/attempts/${score.attemptId}`}><strong>{score.percent}%</strong><span>{score.score}/{score.maxScore}</span></a> : <span>Not submitted</span>}</td>;
  }

  return <div className={`${styles.page} ${embedded ? styles.embeddedPage : ""}`}>
    {embedded ? <section className={styles.embeddedHeading} id="weekly-classroom"><div><p className="eyebrow">Complete class gradebook</p><h2>Student list & class record</h2><p>Stars, skulls, HW, CW, and dated tests live together inside A1, A2, A3…</p></div><div className={styles.sheetTools}><button className={gradebookStyles.addTestButton} onClick={() => setGradeColumnDialog("new")} type="button">＋ Test / grade column</button><button onClick={() => setWorkCreatorOpen(true)} type="button">＋ HW / CW · {selectedWeek}</button><button disabled={!data.students.length} onClick={chooseRandomStudent} type="button">🎲 Student</button><label>Teams<select aria-label="Number of teams" disabled={data.students.length < 2} onChange={(event) => setTeamCount(Number(event.target.value))} value={Math.min(teamCount, Math.max(2, data.students.length))}>{Array.from({ length: Math.max(1, Math.min(11, data.students.length) - 1) }, (_, index) => index + 2).map((count) => <option key={count}>{count}</option>)}</select></label><button disabled={data.students.length < 2} onClick={makeTeams} type="button">Mix teams</button><button onClick={openTimer} type="button">⏱ Timer</button><a className={styles.backupButton} href="/api/stars/export">Excel backup</a><button onClick={addWeek} type="button">＋ Week</button></div></section> : <section className={styles.heading}><div><p className="eyebrow">Teacher-only classroom tools</p><h1>{data.classroom.name} Stars</h1><p>Weekly rewards, homework and classwork records. Skulls sync securely with separate today and accumulated totals.</p></div><div className={styles.headingActions}><a className={styles.backupButton} href="/api/stars/export">Download Excel backup</a><button onClick={addWeek} type="button">＋ Add week</button></div></section>}

    <div className={`${styles.saveBanner} ${styles[saveState]}`} role="status"><span>{saveState === "saved" ? "✓" : saveState === "syncing" ? "↻" : "●"}</span><div><strong>{saveState === "saved" ? "Safe and saved" : saveState === "syncing" ? "Saving now" : "Browser safety copy active"}</strong><p>{saveMessage}</p></div>{queueSize(queue) > 0 && isOnline ? <button onClick={() => void flushQueue()} type="button">Retry now</button> : null}</div>

    {embedded ? <section className={styles.sheetSection} aria-label="Weekly class spreadsheet">
      <div className={styles.sheetHint}><span>Click a week to expand or collapse it</span><span><i /> Current week</span><button className={gradebookStyles.resetButton} disabled={skullsTodayTotal === 0} onClick={clearAllSkullsToday} type="button">Reset today’s skulls</button></div>
      <div className={`${styles.sheetScroller} ${gradebookStyles.pageScroller}`} ref={sheetScrollerRef}>
        <table className={styles.sheetTable} ref={sheetTableRef}>
          <thead><tr><th className={styles.sheetStudentHead} rowSpan={2}>Student</th><th className={gradebookStyles.skullGroup} colSpan={2}>💀 Skulls</th>{data.weeks.map((week) => { const expanded = expandedWeeks.has(week.label); const columns = sheetColumnsForWeek(week.label); return <th className={`${styles.sheetWeekHead} ${week.label === currentWeekLabel ? styles.sheetCurrentWeek : ""} ${expanded ? styles.sheetExpandedWeek : ""}`} colSpan={1 + columns.length} key={week.id}><button aria-expanded={expanded} onClick={() => toggleSheetWeek(week.label)} title={week.focus || week.title || `Week ${week.label}`} type="button"><strong>{week.label}</strong><span>{columns.length} dated column{columns.length === 1 ? "" : "s"} · {expanded ? "Compact ←" : "Stars →"}</span>{week.label === currentWeekLabel ? <small>Current</small> : null}</button></th>; })}{gradeColumns.length ? <th className={gradebookStyles.averageHead} rowSpan={2}>Test avg</th> : null}</tr>
          <tr><th className={`${styles.sheetSubhead} ${styles.skullSubhead}`}>Today</th><th className={`${styles.sheetSubhead} ${gradebookStyles.skullTotalSubhead}`}>Accumulated</th>{data.weeks.map((week) => <Fragment key={week.id}><th className={`${styles.sheetSubhead} ${styles.starSubhead}`}>{expandedWeeks.has(week.label) ? "★ Stars" : "Totals"}</th>{sheetColumnsForWeek(week.label).map(sheetColumnHeader)}</Fragment>)}</tr></thead>
          <tbody>{sortedStudents.map((student) => <tr key={student.id}><th className={styles.sheetStudentCell}><a href={`/teacher/students/${student.id}`}><span className={styles.sheetAvatar}>{student.fullName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("")}</span><span><strong>{student.fullName}</strong><small>{student.email || "Student profile"}</small></span></a></th><td className={`${styles.sheetActionCell} ${styles.sheetSkullCell}`}><strong>💀 {student.skullsToday}/3</strong><div><button aria-label={`Clear today’s Skulls for ${student.fullName}`} disabled={student.skullsToday === 0} onClick={() => clearStudentSkullsToday(student.id)} type="button">Clear</button><button aria-label={`Add a Skull to ${student.fullName}`} className={styles.sheetSkullAdd} disabled={student.skullsToday >= 3} onClick={() => addSkull(student.id)} type="button">＋</button></div></td><td className={gradebookStyles.skullTotalCell}><strong>💀 {student.skullsTotal}</strong><small>All time</small></td>{data.weeks.map((week) => {
            const homework = studentWeekWorkSummary(student.id, week.label, "homework");
            const classwork = studentWeekWorkSummary(student.id, week.label, "classwork");
            const datedCells = sheetColumnsForWeek(week.label).map((column) => sheetColumnCell(column, student));
            if (!expandedWeeks.has(week.label)) return <Fragment key={week.id}><td className={`${styles.sheetCollapsedCell} ${week.label === currentWeekLabel ? styles.sheetCurrentCell : ""}`}><strong>★ {student.totals[week.label] ?? 0}</strong><small>HW {homework.ok}/{homework.recorded} · CW {classwork.ok}/{classwork.recorded}</small></td>{datedCells}</Fragment>;
            return <Fragment key={week.id}><td className={`${styles.sheetActionCell} ${styles.sheetStarCell}`}><strong>★ {student.totals[week.label] ?? 0}</strong><div><button aria-label={`Remove a Star from ${student.fullName} in ${week.label}`} disabled={(student.totals[week.label] ?? 0) <= 0} onClick={() => changeStars(student.id, -1, week.label)} type="button">−</button><button aria-label={`Add a Star to ${student.fullName} in ${week.label}`} className={styles.sheetStarAdd} onClick={() => changeStars(student.id, 1, week.label)} type="button">＋</button></div></td>{datedCells}</Fragment>;
          })}{gradeColumns.length ? <td className={gradebookStyles.averageCell}>{(() => { const scores = gradeColumns.flatMap((column) => column.scores[student.id] ? [column.scores[student.id].percent] : []); return scores.length ? <strong>{Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length)}%</strong> : <span>—</span>; })()}</td> : null}</tr>)}</tbody>
        </table>
      </div>
      <div aria-hidden="true" className={gradebookStyles.frozenSheetHeader} hidden ref={frozenSheetHeaderRef} />
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
            <section className={styles.controlRow}><article><span>Open week</span><strong>{selectedWeek}</strong></article><article><span>Class stars</span><strong>⭐ {classStars}</strong></article><article><span>Students</span><strong>{data.students.length}</strong></article><article><span>Skulls today / total</span><strong>💀 {skullsTodayTotal} / {accumulatedSkullTotal}</strong></article></section>

            <div className={styles.workspace}>
              <section className={styles.studentPanel}>
                <div className={styles.sectionHeader}><div><p className="eyebrow">{selectedWeek}</p><h2>Class roster</h2><p>Stars and skulls sync to Supabase. Skulls show today and accumulated totals separately.</p></div><button disabled={skullsTodayTotal === 0} onClick={clearAllSkullsToday} type="button">Reset today’s skulls</button></div>
                <div className={styles.studentGrid}>{sortedStudents.map((student) => <article className={`${styles.studentCard} ${student.skullsToday > 0 ? styles.warned : ""} ${rewardEffect?.studentId === student.id && rewardEffect.kind === "star" ? styles.starAwarded : ""} ${rewardEffect?.studentId === student.id && rewardEffect.kind !== "star" ? styles.skullMarked : ""}`} key={student.id}>
                  <div className={styles.studentIdentity}><span className={styles.avatar}>{student.fullName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("")}</span><div><strong>{student.fullName}</strong><small>{studentWorkSummary(student.id, "homework")} · {studentWorkSummary(student.id, "classwork")}</small></div></div>
                  <div className={styles.studentScores}><b>⭐ {student.totals[selectedWeek] ?? 0}</b><span>💀 Today {student.skullsToday}/3 · Total {student.skullsTotal}</span></div>
                  <div className={styles.studentActions}><button className={styles.starAdd} onClick={() => changeStars(student.id, 1)} type="button">＋ ⭐</button><button disabled={(student.totals[selectedWeek] ?? 0) <= 0} onClick={() => changeStars(student.id, -1)} type="button">− ⭐</button><button className={styles.skullAdd} disabled={student.skullsToday >= 3} onClick={() => addSkull(student.id)} type="button">＋ 💀</button>{student.skullsToday > 0 ? <button onClick={() => clearStudentSkullsToday(student.id)} type="button">Clear today 💀</button> : null}</div>
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
    {gradeColumnDialog ? <GradeColumnDialog availableAssessments={availableAssessments} classId={data.classroom.id} column={gradeColumnDialog === "new" ? null : gradeColumnDialog} defaultWeek={selectedWeek || currentWeekLabel} onClose={() => setGradeColumnDialog(null)} onDeleted={deleteGradeColumn} onSaved={saveGradeColumn} weeks={data.weeks} /> : null}
    {workColumnDialog ? <WorkColumnDialog classId={data.classroom.id} item={workColumnDialog} onClose={() => setWorkColumnDialog(null)} onDeleted={deleteWorkColumn} onSaved={saveWorkColumn} /> : null}
    {assignmentPopupId && assignments.find((assignment) => assignment.id === assignmentPopupId) ? <AssignmentResultsPopup assignment={assignments.find((assignment) => assignment.id === assignmentPopupId)!} onClose={() => setAssignmentPopupId(null)} students={sortedStudents} updatedAt={assignmentsUpdatedAt} /> : null}
    {cwPopup && cwPopupStudent ? <div className={`${styles.popupBackdrop} ${styles.cwBackdrop}`} role="presentation"><section aria-label={`Classwork records for ${cwPopupStudent.fullName} in ${cwPopup.weekLabel}`} aria-modal="true" className={`${styles.classroomPopup} ${styles.cwPopup}`} role="dialog"><button aria-label="Close popup" className={styles.popupClose} onClick={() => setCwPopup(null)} type="button">×</button><header><p className={styles.popupEyebrow}>Week {cwPopup.weekLabel} · Classwork</p><h2>{cwPopupStudent.fullName}</h2><p>Add a dated Not OK record for this student only. The CW cell stays compact and shows the saved notes.</p></header><form onSubmit={(event) => { event.preventDefault(); void addCwRecord(); }}><label><span>Date</span><input onChange={(event) => setCwRecordDate(event.target.value)} required type="date" value={cwRecordDate} /></label><label><span>Reason / note</span><textarea autoFocus maxLength={500} onChange={(event) => setCwReason(event.target.value)} placeholder="Why was this classwork Not OK?" required rows={3} value={cwReason} /></label><div><span className={styles.cwNotOkPill}>Not OK CW</span><button disabled={cwBusy || !cwReason.trim()} type="submit">{cwBusy ? "Saving…" : "Save record"}</button></div></form>{cwMessage ? <p className={styles.cwMessage} role="status">{cwMessage}</p> : null}<section className={styles.cwRecordList}><div><strong>Saved records</strong><span>{cwPopupRecords.length}</span></div>{cwPopupRecords.length ? cwPopupRecords.map((record) => <article key={record.id}><time dateTime={record.recordDate}>{record.recordDate}</time><p>{record.reason}</p><button aria-label={`Delete classwork note from ${record.recordDate}`} disabled={cwBusy} onClick={() => void deleteCwRecord(record)} type="button">Delete</button></article>) : <p>No classwork notes for this student in {cwPopup.weekLabel} yet.</p>}</section></section></div> : null}
    {workCreatorOpen ? <div className={`${styles.popupBackdrop} ${styles.workBackdrop}`} role="presentation"><form aria-label={`Add homework or classwork to ${selectedWeek}`} aria-modal="true" className={`${styles.classroomPopup} ${styles.workPopup}`} onSubmit={(event) => { event.preventDefault(); addWorkItem(); }} role="dialog"><button aria-label="Close popup" className={styles.popupClose} onClick={() => setWorkCreatorOpen(false)} type="button">×</button><div aria-hidden="true" className={styles.workPopupIcon}>{newWorkKind === "homework" ? "HW" : "CW"}</div><p className={styles.popupEyebrow}>Week {selectedWeek}</p><h2>Add {newWorkKind === "homework" ? "homework" : "classwork"}</h2><p className={styles.popupHint}>Every student starts as OK. Open the new record afterward to mark Late, Not OK, or Clear.</p><div className={styles.workPopupFields}><label><span>Record type</span><select aria-label="Work type" onChange={(event) => { const kind = event.target.value as WorkKind; setNewWorkKind(kind); setNewWorkTitle(automaticWorkTitle(data, selectedWeek, kind)); }} value={newWorkKind}><option value="homework">Homework</option><option value="classwork">Classwork</option></select></label><label><span>Title</span><input aria-label="Work title" autoFocus maxLength={120} onChange={(event) => setNewWorkTitle(event.target.value)} placeholder={newWorkKind === "homework" ? "Homework title" : "Classwork title"} required value={newWorkTitle} /></label><label><span>Activity date</span><input aria-label="Activity date" onChange={(event) => setNewWorkDate(event.target.value)} type="date" value={newWorkDate} /></label></div><button className={styles.popupAction} disabled={!newWorkTitle.trim()} type="submit">Add to {selectedWeek}</button></form></div> : null}
    {utilityOverlay ? <UtilityPopup onClose={closeUtilityOverlay} onPickAgain={chooseRandomStudent} onRemix={makeTeams} onSetTimer={setClassTimer} onToggleTimer={() => timer === 0 ? setClassTimer(timerDuration) : setTimerRunning((value) => !value)} overlay={utilityOverlay} timer={timer} timerDuration={timerDuration} timerRunning={timerRunning} /> : null}
    {rewardEffect ? <RewardAnimation effect={rewardEffect} key={rewardEffect.id} onClose={closeReward} /> : null}
  </div>;
}
