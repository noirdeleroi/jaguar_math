"use client";

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import type { AvailableClassroomAssessment, ClassroomCwRecord, ClassroomGrade, ClassroomGradeColumn, ClassroomHomeworkAssignment, ClassroomStarState, ClassroomSyncPayload, ClassroomWorkItem, QueuedSkullEvent, QueuedStarEvent, WorkKind, WorkStatus } from "@/lib/classroom-stars";
import { clampTopicGrade, evaluateTopicGradeFormula, isPassingTopicGrade, topicGradeFormulaUsesVariable } from "@/lib/classroom-topic-grade";
import { gradebookColumnClipboardText, workStatusGrade } from "@/lib/gradebook-column-export";
import { GradeColumnDialog, ManualGradeCell, TopicSettingsDialog, WorkColumnDialog } from "./gradebook-controls";
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
  | { kind: "randomizer"; phase: "spinning" | "result"; name: string }
  | { kind: "teams"; phase: "mixing" | "settling" | "result"; teams: TeamMember[][]; previewTeams: TeamMember[][]; shuffleStep: number }
  | { kind: "timer" };
type TeamMember = { id: string; nickname: string };
type TeamNamePosition = { x: number; y: number; width: number };
type RewardEffect = { id: string; kind: "star" | "skull" | "death"; studentId: string; studentName: string };
type SheetSelection = { kind: "row" | "column"; id: string } | null;
type SheetDatedColumn =
  | { type: "work"; id: string; date: string | null; item: ClassroomWorkItem }
  | { type: "grade"; id: string; date: string; column: ClassroomGradeColumn }
  | { type: "assignment"; id: string; date: string | null; assignment: ClassroomHomeworkAssignment };

const rewardParticles = Array.from({ length: 18 }, (_, index) => index);
const topicPaletteClasses = [styles.topicPaletteGreen, styles.topicPaletteBlue, styles.topicPaletteTerracotta, styles.topicPalettePlum];

const emptyQueue = (): ClassroomSyncPayload => ({ weeks: [], starEvents: [], skullEvents: [], workItems: [], workStatuses: [] });
const queueSize = (queue: ClassroomSyncPayload) => queue.weeks.length + queue.starEvents.length + queue.skullEvents.length + queue.workItems.length + queue.workStatuses.length;
const statusLabels: Record<WorkStatus, string> = { late: "Late", ok: "OK", not_ok: "Not OK" };

function assignmentResultLabel(result: ClassroomHomeworkAssignment["results"][string] | undefined) {
  if (!result || result.status === "not_started") return "—";
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
      skullEvents: Array.isArray(parsed.skullEvents) ? parsed.skullEvents.map((event) => ({ ...event, week_label: typeof event.week_label === "string" && event.week_label ? event.week_label : "T1" })) : [],
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
    students: initial.students.map((student) => ({ ...student, totals: { ...student.totals }, skulls: Object.fromEntries(Object.entries(student.skulls).map(([label, value]) => [label, { ...value }])) })),
    workItems: initial.workItems.map((item) => ({ ...item, statuses: { ...item.statuses } })),
    eventIds: [...initial.eventIds],
    skullEventIds: [...initial.skullEventIds],
  };
  for (const week of queue.weeks) if (!next.weeks.some((item) => item.label === week.label)) {
    next.weeks = next.weeks.map((item) => ({ ...item, isCurrent: false }));
    next.weeks.push({ id: week.id, label: week.label, sortOrder: week.sort_order, title: week.title || null, focus: week.focus || null, isCurrent: true, finalGradeFormula: null, finalGradeMax: 20, summativeGradeColumnId: null });
  }
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
    const topicSkulls = student.skulls[event.week_label] ?? { today: 0, total: 0 };
    if (event.action === "add") {
      topicSkulls.total += 1;
      if (occurredToday) topicSkulls.today += 1;
    } else if (occurredToday) topicSkulls.today = 0;
    student.skulls[event.week_label] = topicSkulls;
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
  return used.at(-1)?.label ?? state.weeks[0]?.label ?? "T1";
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

function dealTeams(members: TeamMember[], count: number) {
  const teams = Array.from({ length: count }, () => [] as TeamMember[]);
  members.forEach((member, index) => teams[index % count].push(member));
  return teams;
}

function TeamMixBoard({ overlay }: { overlay: Extract<UtilityOverlay, { kind: "teams" }> }) {
  const boardRef = useRef<HTMLDivElement>(null);
  const boxRefs = useRef<Array<HTMLElement | null>>([]);
  const [positions, setPositions] = useState<Record<string, TeamNamePosition>>({});
  const visibleTeams = overlay.phase === "mixing" ? overlay.previewTeams : overlay.teams;
  const members = visibleTeams.flat();
  const columns = visibleTeams.length <= 4 ? visibleTeams.length : visibleTeams.length <= 6 ? 3 : 4;
  const largestTeam = Math.max(1, ...visibleTeams.map((team) => team.length));

  const measurePositions = useCallback(() => {
    const board = boardRef.current;
    if (!board) return;
    const boardRect = board.getBoundingClientRect();
    const next: Record<string, TeamNamePosition> = {};
    visibleTeams.forEach((team, teamIndex) => {
      const box = boxRefs.current[teamIndex];
      if (!box) return;
      const boxRect = box.getBoundingClientRect();
      team.forEach((member, memberIndex) => {
        next[member.id] = {
          x: boxRect.left - boardRect.left + board.scrollLeft + 11,
          y: boxRect.top - boardRect.top + board.scrollTop + 48 + memberIndex * 37,
          width: Math.max(92, boxRect.width - 22),
        };
      });
    });
    setPositions(next);
  }, [visibleTeams]);

  useLayoutEffect(() => {
    measurePositions();
    const board = boardRef.current;
    if (!board) return;
    const observer = new ResizeObserver(measurePositions);
    observer.observe(board);
    boxRefs.current.forEach((box) => { if (box) observer.observe(box); });
    return () => observer.disconnect();
  }, [measurePositions]);

  return <div
    aria-live={overlay.phase === "result" ? "polite" : "off"}
    className={`${styles.teamBoard} ${overlay.phase === "mixing" ? styles.teamBoardMixing : overlay.phase === "settling" ? styles.teamBoardSettling : styles.teamBoardSettled}`}
    ref={boardRef}
    style={{ "--team-columns": columns, "--team-rows": largestTeam } as CSSProperties}
  >
    {visibleTeams.map((team, teamIndex) => <article aria-label={`Team ${teamIndex + 1}: ${team.map((member) => member.nickname).join(", ")}`} className={styles.teamBox} key={teamIndex} ref={(element) => { boxRefs.current[teamIndex] = element; }}>
      <header><span>Team</span><strong>{teamIndex + 1}</strong></header>
      <div aria-hidden="true" className={styles.teamSlots}>{team.map((member) => <i key={member.id} />)}</div>
    </article>)}
    <div aria-hidden="true" className={styles.teamNameLayer}>
      {members.map((member, index) => {
        const position = positions[member.id];
        return <span
          className={styles.teamNameCard}
          key={member.id}
          style={{
            "--name-index": index,
            opacity: position ? 1 : 0,
            transform: position ? `translate3d(${position.x}px, ${position.y}px, 0)` : "translate3d(0, 0, 0)",
            width: position?.width ?? 120,
          } as CSSProperties}
        >{member.nickname}</span>;
      })}
    </div>
  </div>;
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
        <div className={`${styles.teamMixer} ${overlay.phase !== "result" ? styles.teamMixerActive : ""}`}>
          <TeamMixBoard overlay={overlay} />
        </div>
        <p className={styles.popupEyebrow}>{overlay.phase === "mixing" ? "Names are changing places…" : overlay.phase === "settling" ? "Final move…" : "Teams are ready!"}</p>
        <h2>{overlay.phase === "mixing" ? `Mixing ${overlay.teams.length} teams` : overlay.phase === "settling" ? "Settling into place" : `${overlay.teams.length} teams settled`}</h2>
        {overlay.phase === "result" ? <button className={styles.popupAction} onClick={onRemix} type="button">↻ Mix again</button> : <div aria-label={overlay.phase === "settling" ? "Settling final teams" : "Mixing teams"} className={styles.pickerTrack} role="progressbar"><span /></div>}
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
  const [topicSettingsDialog, setTopicSettingsDialog] = useState<string | null>(null);
  const [copiedColumnId, setCopiedColumnId] = useState<string | null>(null);
  const [sheetSelection, setSheetSelection] = useState<SheetSelection>(null);
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
  const utilityShuffleInterval = useRef<number | null>(null);
  const utilityRevealTimer = useRef<number | null>(null);
  const rewardTimer = useRef<number | null>(null);
  const sheetScrollerRef = useRef<HTMLDivElement>(null);
  const sheetTableRef = useRef<HTMLTableElement>(null);
  const frozenSheetHeaderRef = useRef<HTMLDivElement>(null);
  const blockingOverlayOpen = Boolean(utilityOverlay || workCreatorOpen || assignmentPopupId || cwPopup || gradeColumnDialog || topicSettingsDialog || workColumnDialog || rewardEffect?.kind === "death");

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
      const legacyEvents: QueuedSkullEvent[] = Object.entries(legacy ?? {}).flatMap(([studentId, count]) => Array.from({ length: Math.max(0, Math.floor(Number(count) || 0)) }, (_, index) => ({ id: crypto.randomUUID(), student_id: studentId, week_label: "T1", action: "add" as const, source: navigator.onLine ? "classroom" as const : "offline_queue" as const, occurred_at: new Date(Date.now() + index).toISOString() })));
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
  }, [assignments, data.weeks, data.workItems, embedded, expandedWeeks, gradeColumns, sheetSelection]);

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
      if (utilityShuffleInterval.current !== null) window.clearInterval(utilityShuffleInterval.current);
      if (utilityRevealTimer.current !== null) window.clearTimeout(utilityRevealTimer.current);
      utilityShuffleInterval.current = null;
      utilityRevealTimer.current = null;
      setUtilityOverlay(null);
      setWorkCreatorOpen(false);
      setAssignmentPopupId(null);
      setCwPopup(null);
      setTopicSettingsDialog(null);
      setRewardEffect(null);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", closeOnEscape); };
  }, [blockingOverlayOpen]);

  useEffect(() => () => {
    if (utilityShuffleInterval.current !== null) window.clearInterval(utilityShuffleInterval.current);
    if (utilityRevealTimer.current !== null) window.clearTimeout(utilityRevealTimer.current);
    if (rewardTimer.current !== null) window.clearTimeout(rewardTimer.current);
  }, []);

  function clearUtilityAnimationTimers() {
    if (utilityShuffleInterval.current !== null) window.clearInterval(utilityShuffleInterval.current);
    if (utilityRevealTimer.current !== null) window.clearTimeout(utilityRevealTimer.current);
    utilityShuffleInterval.current = null;
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

  function addSkull(studentId: string, weekLabel = selectedWeek) {
    const student = data.students.find((item) => item.id === studentId);
    const currentSkulls = student?.skulls[weekLabel] ?? { today: 0, total: 0 };
    if (!student || currentSkulls.today >= 3) return;
    const nextToday = currentSkulls.today + 1;
    const event: QueuedSkullEvent = { id: crypto.randomUUID(), student_id: studentId, week_label: weekLabel, action: "add", source: navigator.onLine ? "classroom" : "offline_queue", occurred_at: new Date().toISOString() };
    setData((current) => ({ ...current, students: current.students.map((item) => item.id === studentId ? { ...item, skulls: { ...item.skulls, [weekLabel]: { today: (item.skulls[weekLabel]?.today ?? 0) + 1, total: (item.skulls[weekLabel]?.total ?? 0) + 1 } } } : item) }));
    enqueue({ skullEvents: [event] });
    showReward(nextToday === 3 ? "death" : "skull", student.id, student.fullName);
  }

  function clearStudentSkullsToday(studentId: string, weekLabel = selectedWeek) {
    const student = data.students.find((item) => item.id === studentId);
    if (!student || (student.skulls[weekLabel]?.today ?? 0) === 0) return;
    const event: QueuedSkullEvent = { id: crypto.randomUUID(), student_id: studentId, week_label: weekLabel, action: "clear_today", source: navigator.onLine ? "classroom" : "offline_queue", occurred_at: new Date().toISOString() };
    setData((current) => ({ ...current, students: current.students.map((item) => item.id === studentId ? { ...item, skulls: { ...item.skulls, [weekLabel]: { today: 0, total: item.skulls[weekLabel]?.total ?? 0 } } } : item) }));
    enqueue({ skullEvents: [event] });
  }

  function clearAllSkullsToday(weekLabel = selectedWeek) {
    const studentsWithSkulls = data.students.filter((student) => (student.skulls[weekLabel]?.today ?? 0) > 0);
    if (!studentsWithSkulls.length) return;
    const occurredAt = new Date().toISOString();
    const events: QueuedSkullEvent[] = studentsWithSkulls.map((student) => ({ id: crypto.randomUUID(), student_id: student.id, week_label: weekLabel, action: "clear_today", source: navigator.onLine ? "classroom" : "offline_queue", occurred_at: occurredAt }));
    setData((current) => ({ ...current, students: current.students.map((student) => ({ ...student, skulls: { ...student.skulls, [weekLabel]: { today: 0, total: student.skulls[weekLabel]?.total ?? 0 } } })) }));
    enqueue({ skullEvents: events });
  }

  function addTopic() {
    const nextOrder = Math.max(0, ...data.weeks.map((week) => week.sortOrder)) + 1;
    const label = `T${nextOrder}`;
    const topicName = window.prompt(`Name for Topic ${nextOrder}`, "New topic")?.trim();
    if (!topicName || data.weeks.some((week) => week.label === label)) return;
    const week = { id: crypto.randomUUID(), label, sort_order: nextOrder, title: topicName };
    setData((current) => ({ ...current, weeks: [...current.weeks.map((topic) => ({ ...topic, isCurrent: false })), { id: week.id, label, sortOrder: nextOrder, title: week.title, focus: null, isCurrent: true, finalGradeFormula: null, finalGradeMax: 20, summativeGradeColumnId: null }] }));
    setSelectedWeek(label);
    setOpenWeek(label);
    setExpandedWeeks(new Set([label]));
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
  const skullsTodayTotal = data.students.reduce((sum, student) => sum + (student.skulls[selectedWeek]?.today ?? 0), 0);
  const accumulatedSkullTotal = data.students.reduce((sum, student) => sum + (student.skulls[selectedWeek]?.total ?? 0), 0);
  const homeworkCount = data.workItems.filter((item) => item.weekLabel === selectedWeek && item.kind === "homework").length + assignments.filter((assignment) => assignment.weekLabel === selectedWeek).length;
  const classworkCount = data.workItems.filter((item) => item.weekLabel === selectedWeek && item.kind === "classwork").length;
  const testCount = gradeColumns.filter((column) => column.weekLabel === selectedWeek).length;
  const homeworkSummary = weekSummary(selectedWeek, "homework");
  const classworkSummary = weekSummary(selectedWeek, "classwork");
  const testAverages = gradeColumns.flatMap((column) => column.weekLabel === selectedWeek && column.average !== null ? [column.average] : []);
  const testAverage = testAverages.length ? `${Math.round(testAverages.reduce((sum, average) => sum + average, 0) / testAverages.length)}% average` : "No grades yet";
  const selectedTopic = data.weeks.find((topic) => topic.label === selectedWeek) ?? data.weeks[0];
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
    let index = 0;
    setUtilityOverlay({ kind: "randomizer", phase: "spinning", name: order[0].fullName });
    utilityShuffleInterval.current = window.setInterval(() => {
      index = (index + 1) % order.length;
      setUtilityOverlay((current) => current?.kind === "randomizer" ? { ...current, name: order[index].fullName } : current);
    }, 85);
    utilityRevealTimer.current = window.setTimeout(() => {
      if (utilityShuffleInterval.current !== null) window.clearInterval(utilityShuffleInterval.current);
      utilityShuffleInterval.current = null;
      setUtilityOverlay({ kind: "randomizer", phase: "result", name: winner.fullName });
      setUtilityMessage(`🎲 ${winner.fullName}`);
    }, 1900);
  }

  function makeTeams() {
    if (data.students.length < 2) return;
    clearUtilityAnimationTimers();
    const count = Math.max(2, Math.min(teamCount, data.students.length));
    const members = data.students.map((student) => ({ id: student.id, nickname: student.nickname }));
    const teams = dealTeams(shuffle(members), count);
    let shuffleStep = 0;
    setUtilityOverlay({ kind: "teams", phase: "mixing", teams, previewTeams: dealTeams(shuffle(members), count), shuffleStep });
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reducedMotion) {
      utilityShuffleInterval.current = window.setInterval(() => {
        shuffleStep += 1;
        setUtilityOverlay((current) => current?.kind === "teams" && current.phase === "mixing" ? { ...current, previewTeams: dealTeams(shuffle(members), count), shuffleStep } : current);
      }, 800);
    }
    const revealTeams = () => {
      utilityRevealTimer.current = null;
      setUtilityOverlay({ kind: "teams", phase: "result", teams, previewTeams: teams, shuffleStep: shuffleStep + 2 });
      setUtilityMessage(teams.map((team, index) => `Team ${index + 1}: ${team.map((member) => member.nickname).join(", ")}`).join("\n"));
    };
    utilityRevealTimer.current = window.setTimeout(() => {
      if (utilityShuffleInterval.current !== null) window.clearInterval(utilityShuffleInterval.current);
      utilityShuffleInterval.current = null;
      if (reducedMotion) revealTeams();
      else {
        setUtilityOverlay({ kind: "teams", phase: "settling", teams, previewTeams: teams, shuffleStep: shuffleStep + 1 });
        utilityRevealTimer.current = window.setTimeout(revealTeams, 950);
      }
    }, reducedMotion ? 350 : 4300);
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

  function topicSummativeColumn(weekLabel: string) {
    const topic = data.weeks.find((week) => week.label === weekLabel);
    const topicColumns = gradeColumns.filter((column) => column.weekLabel === weekLabel);
    return topicColumns.find((column) => column.id === topic?.summativeGradeColumnId) ?? null;
  }

  function topicFinalGrade(weekLabel: string, studentId: string) {
    const topic = data.weeks.find((week) => week.label === weekLabel);
    if (!topic?.finalGradeFormula) return null;
    const column = topicSummativeColumn(weekLabel);
    const score = column?.scores[studentId]?.score;
    if (topicGradeFormulaUsesVariable(topic.finalGradeFormula, "N") && score === undefined) return null;
    const student = data.students.find((item) => item.id === studentId);
    if (!student) return null;
    try {
      const result = evaluateTopicGradeFormula(topic.finalGradeFormula, {
        N: score ?? 0,
        stars: student.totals[weekLabel] ?? 0,
        skulls: student.skulls[weekLabel]?.total ?? 0,
      });
      return Math.round(clampTopicGrade(result, topic.finalGradeMax) * 100) / 100;
    } catch {
      return null;
    }
  }

  function topicFinalGradeSummary(weekLabel: string) {
    const topic = data.weeks.find((week) => week.label === weekLabel);
    if (!topic?.finalGradeFormula) return null;
    const grades = data.students.flatMap((student) => {
      const grade = topicFinalGrade(weekLabel, student.id);
      return grade === null ? [] : [grade];
    });
    const passed = grades.filter((grade) => isPassingTopicGrade(grade, topic.finalGradeMax)).length;
    return {
      passed,
      failed: grades.length - passed,
      passRate: grades.length === 0 ? null : Math.round((passed / grades.length) * 100),
    };
  }

  function saveTopicSettings(topic: ClassroomStarState["weeks"][number]) {
    setData((current) => ({ ...current, weeks: current.weeks.map((week) => week.id === topic.id ? topic : topic.isCurrent ? { ...week, isCurrent: false } : week) }));
    if (topic.isCurrent) {
      setSelectedWeek(topic.label);
      setExpandedWeeks((current) => new Set([...current, topic.label]));
    }
    setTopicSettingsDialog(null);
    router.refresh();
  }

  function saveGradeColumn(savedColumn: ClassroomGradeColumn) {
    setGradeColumns((current) => current.some((column) => column.id === savedColumn.id) ? current.map((column) => column.id === savedColumn.id ? savedColumn : column) : [...current, savedColumn]);
    setData((current) => ({ ...current, weeks: current.weeks.map((week) => {
      if (week.summativeGradeColumnId === savedColumn.id && week.label !== savedColumn.weekLabel) return { ...week, summativeGradeColumnId: null };
      return week;
    }) }));
    if (savedColumn.assignmentId) setAvailableAssessments((current) => current.filter((assessment) => assessment.id !== savedColumn.assignmentId));
    setExpandedWeeks((current) => new Set([...current, savedColumn.weekLabel]));
    setGradeColumnDialog(null);
    router.refresh();
  }

  function deleteGradeColumn(columnId: string) {
    setGradeColumns((current) => current.filter((column) => column.id !== columnId));
    setData((current) => ({ ...current, weeks: current.weeks.map((week) => week.summativeGradeColumnId === columnId ? { ...week, summativeGradeColumnId: null } : week) }));
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

  async function copyFinalGradeColumn(weekLabel: string) {
    const enrolledStudentIds = new Set(data.students.map((student) => student.id));
    const text = gradebookColumnClipboardText(data.gradebookRoster, enrolledStudentIds, (studentId) => topicFinalGrade(weekLabel, studentId));
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedColumnId(`final:${weekLabel}`);
      window.setTimeout(() => setCopiedColumnId((current) => current === `final:${weekLabel}` ? null : current), 1800);
    } catch {
      setSaveState("error");
      setSaveMessage("The final-grade column could not be copied. Allow clipboard access, then try again.");
    }
  }

  function toggleSheetSelection(kind: "row" | "column", id: string) {
    setSheetSelection((current) => current?.kind === kind && current.id === id ? null : { kind, id });
  }

  function selectedColumnClass(columnId: string) {
    return sheetSelection?.kind === "column" && sheetSelection.id === columnId ? styles.sheetSelectedColumn : "";
  }

  function copyColumnButton(sheetColumn: SheetDatedColumn) {
    const copied = copiedColumnId === sheetColumn.id;
    return <button aria-label={`Copy ${sheetColumn.type === "work" ? sheetColumn.item.title : sheetColumn.type === "assignment" ? sheetColumn.assignment.title : sheetColumn.column.title} grades in official gradebook order`} className={gradebookStyles.copyColumnButton} disabled={!data.gradebookRoster.length} onClick={() => void copyGradebookColumn(sheetColumn)} title={data.gradebookRoster.length ? "Copy one spreadsheet-ready value per official gradebook row" : "Official gradebook roster is not available"} type="button">{copied ? "✓ Copied" : "Copy grades"}</button>;
  }

  function sheetColumnHeader(sheetColumn: SheetDatedColumn, topicPaletteClass: string) {
    const selected = sheetSelection?.kind === "column" && sheetSelection.id === sheetColumn.id;
    if (sheetColumn.type === "work") {
      const { item } = sheetColumn;
      return <th className={`${gradebookStyles.datedColumnHead} ${item.kind === "homework" ? gradebookStyles.homeworkHead : gradebookStyles.classworkHead} ${topicPaletteClass} ${selectedColumnClass(sheetColumn.id)}`} key={sheetColumn.id}><div><button aria-label={`Select ${item.title} column`} aria-pressed={selected} className={styles.sheetColumnSelect} onClick={() => toggleSheetSelection("column", sheetColumn.id)} type="button"><strong>{item.kind === "homework" ? "HW" : "CW"}{item.position}</strong><span>{item.title}</span><small>{item.activityDate ? shortDate(item.activityDate) : "No date"}</small></button><div className={gradebookStyles.headerActions}>{copyColumnButton(sheetColumn)}<button aria-label={`Edit ${item.title} column`} onClick={() => setWorkColumnDialog(item)} type="button">Edit</button></div></div></th>;
    }
    if (sheetColumn.type === "assignment") {
      return <th className={`${gradebookStyles.datedColumnHead} ${gradebookStyles.assignmentHead} ${topicPaletteClass} ${selectedColumnClass(sheetColumn.id)}`} key={sheetColumn.id}><div><button aria-label={`Select ${sheetColumn.assignment.title} column`} aria-pressed={selected} className={styles.sheetColumnSelect} onClick={() => toggleSheetSelection("column", sheetColumn.id)} type="button"><strong>Online HW</strong><span>{sheetColumn.assignment.title}</span><small>{sheetColumn.date ? shortDate(sheetColumn.date) : "No due date"} · {sheetColumn.assignment.status}</small></button><div className={gradebookStyles.headerActions}>{copyColumnButton(sheetColumn)}</div></div></th>;
    }
    const { column } = sheetColumn;
    return <th className={`${gradebookStyles.assessmentHead} ${topicPaletteClass} ${selectedColumnClass(sheetColumn.id)}`} key={sheetColumn.id}><div><button aria-label={`Select ${column.title} column`} aria-pressed={selected} className={styles.sheetColumnSelect} onClick={() => toggleSheetSelection("column", sheetColumn.id)} type="button"><strong>{column.title}</strong><span>{shortDate(column.assessmentDate)} · {column.source === "manual" ? `Manual / ${column.maxScore}` : "Auto test"}</span><small>{column.average === null ? "No grades" : `Avg ${column.average}%`}</small></button><div className={gradebookStyles.headerActions}>{copyColumnButton(sheetColumn)}<button aria-label={`Edit ${column.title} column`} onClick={() => setGradeColumnDialog(column)} type="button">Edit</button></div></div></th>;
  }

  function sheetColumnCell(sheetColumn: SheetDatedColumn, student: ClassroomStarState["students"][number], topicPaletteClass: string) {
    const selectionClass = selectedColumnClass(sheetColumn.id);
    if (sheetColumn.type === "work") {
      const { item } = sheetColumn;
      const status = item.statuses[student.id];
      const statusLabel = status === "ok" ? (item.kind === "homework" ? "Done" : "OK") : status === "not_ok" ? (item.kind === "homework" ? "Missing" : "Not OK") : status === "late" ? "Late" : "—";
      const noteCount = item.kind === "classwork" ? cwRecords.filter((record) => record.studentId === student.id && record.weekLabel === item.weekLabel).length : 0;
      return <td className={`${gradebookStyles.workStatusCell} ${topicPaletteClass} ${selectionClass}`} key={sheetColumn.id}><button className={status ? gradebookStyles[`work_${status}`] : gradebookStyles.work_clear} onClick={() => cycleWorkStatus(item, student.id)} title={`${item.title}: ${statusLabel}. Click to change.`} type="button"><strong>{statusLabel}</strong><span>Click to change</span></button>{item.kind === "classwork" ? <button className={gradebookStyles.cwNoteButton} onClick={() => openCwRecords(student.id, item.weekLabel)} type="button">{noteCount ? `${noteCount} note${noteCount === 1 ? "" : "s"}` : "+ note"}</button> : null}</td>;
    }
    if (sheetColumn.type === "assignment") {
      const result = sheetColumn.assignment.results[student.id];
      return <td className={`${gradebookStyles.assessmentCell} ${gradebookStyles.onlineHomeworkCell} ${topicPaletteClass} ${selectionClass}`} key={sheetColumn.id}><button onClick={() => setAssignmentPopupId(sheetColumn.assignment.id)} type="button"><strong>{assignmentResultLabel(result)}</strong><span>{result?.status === "submitted" && result.score !== null ? `${result.score}/${result.maxScore}` : "Open results"}</span></button></td>;
    }
    const { column } = sheetColumn;
    const score = column.scores[student.id];
    if (column.source === "manual") return <ManualGradeCell classId={data.classroom.id} className={`${topicPaletteClass} ${selectionClass}`} column={column} key={sheetColumn.id} onSaved={(grade) => saveManualGrade(column.id, student.id, grade)} studentId={student.id} studentName={student.fullName} />;
    return <td className={`${gradebookStyles.assessmentCell} ${topicPaletteClass} ${selectionClass}`} key={sheetColumn.id}>{score && column.assignmentId && score.attemptId ? <a href={`/teacher/assignments/${column.assignmentId}/attempts/${score.attemptId}`}><strong>{score.percent}%</strong><span>{score.score}/{score.maxScore}</span></a> : <strong title="Absent">—</strong>}</td>;
  }

  return <div className={`${styles.page} ${embedded ? styles.embeddedPage : ""}`}>
    {embedded ? <section className={gradebookStyles.topicUmbrella} id="topic-gradebook"><header><div className={gradebookStyles.topicIdentity}><p className="eyebrow">{selectedTopic?.label ?? "T1"} · {selectedWeek === currentWeekLabel ? "Current topic" : "Viewing topic"}</p><h2>{selectedTopic?.title || `Topic ${selectedTopic?.sortOrder ?? 1}`}</h2><p>{selectedTopic?.finalGradeFormula || "No final grade configured"}</p></div><div className={gradebookStyles.topicMetrics} aria-label="Topic totals"><article><span>Stars</span><strong>★ {classStars}</strong><small>This topic</small></article><article><span>Skulls</span><strong>💀 {accumulatedSkullTotal}</strong><small>This topic</small></article><article><span>Homework</span><strong>{homeworkCount}</strong><small>{homeworkSummary.recorded ? `${homeworkSummary.ok}/${homeworkSummary.recorded} OK` : "No marks yet"}</small></article><article><span>Classwork</span><strong>{classworkCount}</strong><small>{classworkSummary.recorded ? `${classworkSummary.ok}/${classworkSummary.recorded} OK` : "No marks yet"}</small></article><article><span>Tests</span><strong>{testCount}</strong><small>{testAverage}</small></article></div><div className={gradebookStyles.topicHeaderActions}><button onClick={() => selectedTopic && setTopicSettingsDialog(selectedTopic.id)} type="button">⚙ Topic</button><button onClick={addTopic} type="button">＋ New topic</button></div></header><div className={`${styles.sheetTools} ${gradebookStyles.topicTools}`}><button className={gradebookStyles.addTestButton} onClick={() => setGradeColumnDialog("new")} type="button">＋ Test / grade column</button><button onClick={() => setWorkCreatorOpen(true)} type="button">＋ HW / CW · {selectedWeek}</button><button disabled={!data.students.length} onClick={chooseRandomStudent} type="button">🎲 Student</button><label>Teams<select aria-label="Number of teams" disabled={data.students.length < 2} onChange={(event) => setTeamCount(Number(event.target.value))} value={Math.min(teamCount, Math.max(2, data.students.length))}>{Array.from({ length: Math.max(1, Math.min(11, data.students.length) - 1) }, (_, index) => index + 2).map((count) => <option key={count}>{count}</option>)}</select></label><button disabled={data.students.length < 2} onClick={makeTeams} type="button">Mix teams</button><button onClick={openTimer} type="button">⏱ Timer</button><a className={styles.backupButton} href="/api/stars/export">Excel backup</a></div></section> : <section className={styles.heading}><div><p className="eyebrow">Teacher-only classroom tools</p><h1>{data.classroom.name} Topics</h1><p>Stars, skulls, homework, classwork, and tests organized by learning topic.</p></div><div className={styles.headingActions}><a className={styles.backupButton} href="/api/stars/export">Download Excel backup</a><button onClick={addTopic} type="button">＋ Add topic</button></div></section>}

    <div className={`${styles.saveBanner} ${styles[saveState]}`} role="status"><span>{saveState === "saved" ? "✓" : saveState === "syncing" ? "↻" : "●"}</span><div><strong>{saveState === "saved" ? "Safe and saved" : saveState === "syncing" ? "Saving now" : "Browser safety copy active"}</strong><p>{saveMessage}</p></div>{queueSize(queue) > 0 && isOnline ? <button onClick={() => void flushQueue()} type="button">Retry now</button> : null}</div>

    {embedded ? <section className={styles.sheetSection} aria-label="Topic class spreadsheet">
      <div className={styles.sheetHint}><span>Click a student name or column heading to highlight it</span><span><i /> Current topic</span><button className={gradebookStyles.resetButton} disabled={skullsTodayTotal === 0} onClick={() => clearAllSkullsToday(selectedWeek)} type="button">Reset today’s {selectedWeek} skulls</button></div>
      <div className={`${styles.sheetScroller} ${gradebookStyles.pageScroller}`} ref={sheetScrollerRef}>
        <table className={styles.sheetTable} ref={sheetTableRef}>
          <thead><tr><th className={`${styles.sheetStudentHead} ${selectedColumnClass("students")}`} rowSpan={2}><button aria-label="Select student names column" aria-pressed={sheetSelection?.kind === "column" && sheetSelection.id === "students"} className={styles.sheetColumnSelect} onClick={() => toggleSheetSelection("column", "students")} type="button">Student</button></th>{data.weeks.map((week, topicIndex) => { const expanded = expandedWeeks.has(week.label); const columns = sheetColumnsForWeek(week.label); const topicPaletteClass = topicPaletteClasses[topicIndex % topicPaletteClasses.length]; return <th className={`${styles.sheetWeekHead} ${topicPaletteClass} ${topicIndex > 0 ? styles.topicStart : ""} ${week.label === currentWeekLabel ? styles.sheetCurrentWeek : ""} ${expanded ? styles.sheetExpandedWeek : ""}`} colSpan={expanded ? 3 + columns.length : 1} key={week.id}><button aria-expanded={expanded} onClick={() => toggleSheetWeek(week.label)} title={`${expanded ? "Hide" : "Show"} ${week.title || week.label} columns`} type="button"><strong>{week.title || week.label}</strong><span>{week.label} · {expanded ? `${columns.length + 3} columns shown` : `${columns.length + 3} columns hidden`}</span>{week.label === currentWeekLabel ? <small>Current topic</small> : null}</button></th>; })}</tr>
          <tr>{data.weeks.map((week, topicIndex) => { const expanded = expandedWeeks.has(week.label); const topicPaletteClass = topicPaletteClasses[topicIndex % topicPaletteClasses.length]; const topicStartClass = topicIndex > 0 ? styles.topicStart : ""; if (!expanded) { const columnId = `${week.label}:summary`; return <th className={`${styles.sheetSubhead} ${styles.starSubhead} ${topicPaletteClass} ${topicStartClass} ${selectedColumnClass(columnId)}`} key={week.id}><button aria-label={`Select ${week.label} summary column`} aria-pressed={sheetSelection?.kind === "column" && sheetSelection.id === columnId} className={styles.sheetColumnSelect} onClick={() => toggleSheetSelection("column", columnId)} type="button">Summary</button></th>; } const summative = topicSummativeColumn(week.label); const finalSummary = topicFinalGradeSummary(week.label); const starColumnId = `${week.label}:stars`; const skullColumnId = `${week.label}:skulls`; const finalColumnId = `${week.label}:final`; const formulaUsesN = week.finalGradeFormula ? topicGradeFormulaUsesVariable(week.finalGradeFormula, "N") : false; return <Fragment key={week.id}><th className={`${styles.sheetSubhead} ${styles.starSubhead} ${topicPaletteClass} ${topicStartClass} ${selectedColumnClass(starColumnId)}`}><button aria-label={`Select ${week.label} stars column`} aria-pressed={sheetSelection?.kind === "column" && sheetSelection.id === starColumnId} className={styles.sheetColumnSelect} onClick={() => toggleSheetSelection("column", starColumnId)} type="button">★ Stars</button></th><th className={`${styles.sheetSubhead} ${styles.skullSubhead} ${topicPaletteClass} ${selectedColumnClass(skullColumnId)}`}><button aria-label={`Select ${week.label} skulls column`} aria-pressed={sheetSelection?.kind === "column" && sheetSelection.id === skullColumnId} className={styles.sheetColumnSelect} onClick={() => toggleSheetSelection("column", skullColumnId)} type="button">💀 Skulls</button></th>{sheetColumnsForWeek(week.label).map((column) => sheetColumnHeader(column, topicPaletteClass))}<th className={`${gradebookStyles.finalGradeHead} ${topicPaletteClass} ${selectedColumnClass(finalColumnId)}`}><div><button aria-label={`Select ${week.label} final grade column`} aria-pressed={sheetSelection?.kind === "column" && sheetSelection.id === finalColumnId} className={styles.sheetColumnSelect} onClick={() => toggleSheetSelection("column", finalColumnId)} type="button"><strong>{week.finalGradeFormula ? `Final grade / ${week.finalGradeMax}` : "Final grade not set"}</strong>{finalSummary ? <span className={gradebookStyles.finalGradeSummary}>{finalSummary.passRate === null ? "No grades yet" : `${finalSummary.passed} passed · ${finalSummary.failed} failed · ${finalSummary.passRate}% pass`}</span> : null}<span>{week.finalGradeFormula ? summative ? `N = ${summative.title}` : formulaUsesN ? "Choose summative test" : "No summative test needed" : "No grades calculated"}</span><small>{week.finalGradeFormula ? `${week.finalGradeFormula} · clamped 0–${week.finalGradeMax}` : "Configure when the topic is complete"}</small></button><div className={gradebookStyles.headerActions}><button onClick={() => setTopicSettingsDialog(week.id)} type="button">Edit final grade</button><button className={gradebookStyles.copyColumnButton} disabled={!week.finalGradeFormula || !data.gradebookRoster.length} onClick={() => void copyFinalGradeColumn(week.label)} type="button">{copiedColumnId === `final:${week.label}` ? "✓ Copied" : "Copy grades"}</button></div></div></th></Fragment>; })}</tr></thead>
          <tbody>{sortedStudents.map((student) => <tr className={sheetSelection?.kind === "row" && sheetSelection.id === student.id ? styles.sheetSelectedRow : ""} key={student.id}><th className={`${styles.sheetStudentCell} ${selectedColumnClass("students")}`}><button aria-label={`Select ${student.fullName} row`} aria-pressed={sheetSelection?.kind === "row" && sheetSelection.id === student.id} className={styles.sheetStudentSelect} onClick={() => toggleSheetSelection("row", student.id)} type="button"><span className={styles.sheetAvatar}>{student.fullName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("")}</span><span><strong>{student.fullName}</strong><small>{student.email || "Student"}</small></span></button><a aria-label={`Open ${student.fullName} profile`} className={styles.sheetStudentProfile} href={`/teacher/students/${student.id}`}>↗</a></th>{data.weeks.map((week, topicIndex) => {
             const topicPaletteClass = topicPaletteClasses[topicIndex % topicPaletteClasses.length];
             const topicStartClass = topicIndex > 0 ? styles.topicStart : "";
             const topicSkulls = student.skulls[week.label] ?? { today: 0, total: 0 };
             const finalGrade = topicFinalGrade(week.label, student.id);
             if (!expandedWeeks.has(week.label)) return <td className={`${styles.sheetCollapsedCell} ${topicPaletteClass} ${topicStartClass} ${week.label === currentWeekLabel ? styles.sheetCurrentCell : ""} ${selectedColumnClass(`${week.label}:summary`)}`} key={week.id}><strong>★ {student.totals[week.label] ?? 0} · 💀 {topicSkulls.total}</strong><small>{finalGrade === null ? "Final —" : `Final ${finalGrade}/${week.finalGradeMax}`}</small></td>;
             const passing = finalGrade !== null && isPassingTopicGrade(finalGrade, week.finalGradeMax);
             return <Fragment key={week.id}><td className={`${styles.sheetActionCell} ${styles.sheetStarCell} ${topicPaletteClass} ${topicStartClass} ${selectedColumnClass(`${week.label}:stars`)}`}><strong>★ {student.totals[week.label] ?? 0}</strong><div><button aria-label={`Remove a Star from ${student.fullName} in ${week.label}`} disabled={(student.totals[week.label] ?? 0) <= 0} onClick={() => changeStars(student.id, -1, week.label)} type="button">−</button><button aria-label={`Add a Star to ${student.fullName} in ${week.label}`} className={styles.sheetStarAdd} onClick={() => changeStars(student.id, 1, week.label)} type="button">＋</button></div></td><td className={`${styles.sheetActionCell} ${styles.sheetSkullCell} ${topicPaletteClass} ${selectedColumnClass(`${week.label}:skulls`)}`}><strong>💀 {topicSkulls.total}</strong><small>Today {topicSkulls.today}/3</small><div><button aria-label={`Clear today’s Skulls for ${student.fullName} in ${week.label}`} disabled={topicSkulls.today === 0} onClick={() => clearStudentSkullsToday(student.id, week.label)} type="button">Clear</button><button aria-label={`Add a Skull to ${student.fullName} in ${week.label}`} className={styles.sheetSkullAdd} disabled={topicSkulls.today >= 3} onClick={() => addSkull(student.id, week.label)} type="button">＋</button></div></td>{sheetColumnsForWeek(week.label).map((column) => sheetColumnCell(column, student, topicPaletteClass))}<td className={`${gradebookStyles.finalGradeCell} ${topicPaletteClass} ${finalGrade === null ? "" : passing ? gradebookStyles.finalGradePassed : gradebookStyles.finalGradeFailed} ${selectedColumnClass(`${week.label}:final`)}`}>{finalGrade === null ? <><strong title="No final grade">—</strong><small>{week.finalGradeFormula ? "Waiting for grades" : "Not configured"}</small></> : <><strong>{finalGrade} / {week.finalGradeMax}</strong><small>{passing ? "Passed · 65%+" : "Below 65%"}</small></>}</td></Fragment>;
          })}</tr>)}</tbody>
        </table>
      </div>
      <div aria-hidden="true" className={gradebookStyles.frozenSheetHeader} hidden ref={frozenSheetHeaderRef} />
    </section> : <section className={styles.weekAccordion} aria-label="Classroom topics">
      {data.weeks.map((week) => {
        const expanded = openWeek === week.label;
        const homework = weekSummary(week.label, "homework");
        const classwork = weekSummary(week.label, "classwork");
        const stars = data.students.reduce((sum, student) => sum + (student.totals[week.label] ?? 0), 0);
        return <article className={`${styles.weekPanel} ${week.label === currentWeekLabel ? styles.currentWeekPanel : ""} ${expanded ? styles.openWeekPanel : ""}`} key={week.id}>
          <button aria-controls={`week-${week.id}`} aria-expanded={expanded} className={styles.weekToggle} onClick={() => toggleWeek(week.label)} type="button">
            <div className={styles.weekTitle}><b>{week.label}</b><span><strong>{week.title || `Topic ${week.sortOrder}`}</strong><small>{week.focus || "Click to open topic"}</small></span></div>
            <div className={styles.weekMetric}><span>Stars</span><strong>★ {stars}</strong></div>
            <div className={styles.weekMetric}><span>Homework</span><strong>{homework.recorded ? `${homework.ok}/${homework.recorded} OK` : "—"}</strong><small>{homework.items} {homework.items === 1 ? "item" : "items"}{homework.late ? ` · ${homework.late} late` : ""}</small></div>
            <div className={styles.weekMetric}><span>Classwork</span><strong>{classwork.recorded ? `${classwork.ok}/${classwork.recorded} OK` : "—"}</strong><small>{classwork.items} {classwork.items === 1 ? "item" : "items"}</small></div>
            <i aria-hidden="true">⌄</i>
          </button>

          {expanded ? <div className={styles.weekPanelBody} id={`week-${week.id}`}>
            <section className={styles.controlRow}><article><span>Open topic</span><strong>{selectedWeek}</strong></article><article><span>Topic stars</span><strong>⭐ {classStars}</strong></article><article><span>Students</span><strong>{data.students.length}</strong></article><article><span>Skulls today / total</span><strong>💀 {skullsTodayTotal} / {accumulatedSkullTotal}</strong></article></section>

            <div className={styles.workspace}>
              <section className={styles.studentPanel}>
                <div className={styles.sectionHeader}><div><p className="eyebrow">{selectedWeek}</p><h2>Class roster</h2><p>Stars and skulls sync to Supabase. Skulls show today and accumulated totals separately.</p></div><button disabled={skullsTodayTotal === 0} onClick={() => clearAllSkullsToday(selectedWeek)} type="button">Reset today’s skulls</button></div>
                <div className={styles.studentGrid}>{sortedStudents.map((student) => { const topicSkulls = student.skulls[selectedWeek] ?? { today: 0, total: 0 }; return <article className={`${styles.studentCard} ${topicSkulls.today > 0 ? styles.warned : ""} ${rewardEffect?.studentId === student.id && rewardEffect.kind === "star" ? styles.starAwarded : ""} ${rewardEffect?.studentId === student.id && rewardEffect.kind !== "star" ? styles.skullMarked : ""}`} key={student.id}>
                  <div className={styles.studentIdentity}><span className={styles.avatar}>{student.fullName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("")}</span><div><strong>{student.fullName}</strong><small>{studentWorkSummary(student.id, "homework")} · {studentWorkSummary(student.id, "classwork")}</small></div></div>
                  <div className={styles.studentScores}><b>⭐ {student.totals[selectedWeek] ?? 0}</b><span>💀 Today {topicSkulls.today}/3 · Topic {topicSkulls.total}</span></div>
                  <div className={styles.studentActions}><button className={styles.starAdd} onClick={() => changeStars(student.id, 1)} type="button">＋ ⭐</button><button disabled={(student.totals[selectedWeek] ?? 0) <= 0} onClick={() => changeStars(student.id, -1)} type="button">− ⭐</button><button className={styles.skullAdd} disabled={topicSkulls.today >= 3} onClick={() => addSkull(student.id)} type="button">＋ 💀</button>{topicSkulls.today > 0 ? <button onClick={() => clearStudentSkullsToday(student.id)} type="button">Clear today 💀</button> : null}</div>
                </article>; })}</div>
              </section>

              <aside className={styles.sidebar}>
                <section className={styles.utilityCard}><p className="eyebrow">Classroom utilities</p><h2>Quick tools</h2><div className={styles.utilityActions}><button disabled={!data.students.length} onClick={chooseRandomStudent} type="button">🎲 Random student</button><label>Teams<select disabled={data.students.length < 2} onChange={(event) => setTeamCount(Number(event.target.value))} value={Math.min(teamCount, Math.max(2, data.students.length))}>{Array.from({ length: Math.max(1, Math.min(11, data.students.length) - 1) }, (_, index) => index + 2).map((count) => <option key={count}>{count}</option>)}</select></label><button disabled={data.students.length < 2} onClick={makeTeams} type="button">Mix teams</button></div><pre>{utilityMessage}</pre></section>
                <section className={styles.timerCard}><span>Ready for Math</span><strong>{formatTimer(timer)}</strong><p>Backpacks away · laptops closed · notebook and pen out.</p><div><button onClick={openTimer} type="button">{timerRunning ? "Show timer" : "Open timer"}</button><button onClick={() => { setTimerRunning(false); setTimerDuration(60); setTimer(60); }} type="button">Reset</button></div></section>
              </aside>
            </div>

            <section className={styles.workSection}>
              <div className={styles.sectionHeader}><div><p className="eyebrow">Topic records</p><h2>Homework and classwork</h2><p>Select a record to edit every student’s status. Changes save automatically.</p></div><button className={styles.workAddButton} onClick={() => setWorkCreatorOpen(true)} type="button">＋ Add HW / CW</button></div>
              {weekItems.length ? <><div className={styles.workTabs}>{weekItems.map((item) => <button className={activeWork?.id === item.id ? styles.activeTab : ""} key={item.id} onClick={() => setActiveWorkId(item.id)} type="button"><b>{item.kind === "homework" ? `HW${item.position}` : `CW${item.position}`}</b><span>{item.title}</span></button>)}</div>{activeWork ? <div className={styles.statusTable}><header><div className={styles.workEditor}><label><span>Name</span><input maxLength={120} onBlur={() => editWorkItem(activeWork, { title: activeWork.title.trim() || `${activeWork.kind === "homework" ? "HW" : "CW"} ${activeWork.position}` }, true)} onChange={(event) => editWorkItem(activeWork, { title: event.target.value }, false)} value={activeWork.title} /></label><label><span>Date</span><input onChange={(event) => editWorkItem(activeWork, { activityDate: event.target.value || null }, true)} type="date" value={activeWork.activityDate || ""} /></label><small>{activeWork.kind === "homework" ? "OK / Not OK / Late" : "OK / Not OK"} · changes save automatically</small></div></header>{sortedStudents.map((student) => { const options: WorkStatus[] = activeWork.kind === "homework" ? ["ok", "not_ok", "late"] : ["ok", "not_ok"]; const current = activeWork.statuses[student.id]; return <div className={styles.statusRow} key={student.id}><strong>{student.fullName}</strong><div>{options.map((status) => <button className={current === status ? styles.activeStatus : ""} key={status} onClick={() => setWorkStatus(activeWork, student.id, status)} type="button">{statusLabels[status]}</button>)}<button className={!current ? styles.activeStatus : ""} onClick={() => setWorkStatus(activeWork, student.id, "")} type="button">Clear</button></div></div>; })}</div> : null}</> : <p className={styles.emptyState}>No homework or classwork has been added for this topic. Use Add HW / CW to create the first record.</p>}
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
    {topicSettingsDialog && data.weeks.find((week) => week.id === topicSettingsDialog) ? <TopicSettingsDialog classId={data.classroom.id} gradeColumns={gradeColumns.filter((column) => column.weekLabel === data.weeks.find((week) => week.id === topicSettingsDialog)!.label)} onClose={() => setTopicSettingsDialog(null)} onSaved={saveTopicSettings} topic={data.weeks.find((week) => week.id === topicSettingsDialog)!} /> : null}
    {workColumnDialog ? <WorkColumnDialog classId={data.classroom.id} item={workColumnDialog} onClose={() => setWorkColumnDialog(null)} onDeleted={deleteWorkColumn} onSaved={saveWorkColumn} /> : null}
    {assignmentPopupId && assignments.find((assignment) => assignment.id === assignmentPopupId) ? <AssignmentResultsPopup assignment={assignments.find((assignment) => assignment.id === assignmentPopupId)!} onClose={() => setAssignmentPopupId(null)} students={sortedStudents} updatedAt={assignmentsUpdatedAt} /> : null}
    {cwPopup && cwPopupStudent ? <div className={`${styles.popupBackdrop} ${styles.cwBackdrop}`} role="presentation"><section aria-label={`Classwork records for ${cwPopupStudent.fullName} in ${cwPopup.weekLabel}`} aria-modal="true" className={`${styles.classroomPopup} ${styles.cwPopup}`} role="dialog"><button aria-label="Close popup" className={styles.popupClose} onClick={() => setCwPopup(null)} type="button">×</button><header><p className={styles.popupEyebrow}>Topic {cwPopup.weekLabel} · Classwork</p><h2>{cwPopupStudent.fullName}</h2><p>Add a dated Not OK record for this student only. The CW cell stays compact and shows the saved notes.</p></header><form onSubmit={(event) => { event.preventDefault(); void addCwRecord(); }}><label><span>Date</span><input onChange={(event) => setCwRecordDate(event.target.value)} required type="date" value={cwRecordDate} /></label><label><span>Reason / note</span><textarea autoFocus maxLength={500} onChange={(event) => setCwReason(event.target.value)} placeholder="Why was this classwork Not OK?" required rows={3} value={cwReason} /></label><div><span className={styles.cwNotOkPill}>Not OK CW</span><button disabled={cwBusy || !cwReason.trim()} type="submit">{cwBusy ? "Saving…" : "Save record"}</button></div></form>{cwMessage ? <p className={styles.cwMessage} role="status">{cwMessage}</p> : null}<section className={styles.cwRecordList}><div><strong>Saved records</strong><span>{cwPopupRecords.length}</span></div>{cwPopupRecords.length ? cwPopupRecords.map((record) => <article key={record.id}><time dateTime={record.recordDate}>{record.recordDate}</time><p>{record.reason}</p><button aria-label={`Delete classwork note from ${record.recordDate}`} disabled={cwBusy} onClick={() => void deleteCwRecord(record)} type="button">Delete</button></article>) : <p>No classwork notes for this student in this topic yet.</p>}</section></section></div> : null}
    {workCreatorOpen ? <div className={`${styles.popupBackdrop} ${styles.workBackdrop}`} role="presentation"><form aria-label={`Add homework or classwork to ${selectedWeek}`} aria-modal="true" className={`${styles.classroomPopup} ${styles.workPopup}`} onSubmit={(event) => { event.preventDefault(); addWorkItem(); }} role="dialog"><button aria-label="Close popup" className={styles.popupClose} onClick={() => setWorkCreatorOpen(false)} type="button">×</button><div aria-hidden="true" className={styles.workPopupIcon}>{newWorkKind === "homework" ? "HW" : "CW"}</div><p className={styles.popupEyebrow}>Topic {selectedWeek}</p><h2>Add {newWorkKind === "homework" ? "homework" : "classwork"}</h2><p className={styles.popupHint}>Every student starts as OK. Open the new record afterward to mark Late, Not OK, or Clear.</p><div className={styles.workPopupFields}><label><span>Record type</span><select aria-label="Work type" onChange={(event) => { const kind = event.target.value as WorkKind; setNewWorkKind(kind); setNewWorkTitle(automaticWorkTitle(data, selectedWeek, kind)); }} value={newWorkKind}><option value="homework">Homework</option><option value="classwork">Classwork</option></select></label><label><span>Title</span><input aria-label="Work title" autoFocus maxLength={120} onChange={(event) => setNewWorkTitle(event.target.value)} placeholder={newWorkKind === "homework" ? "Homework title" : "Classwork title"} required value={newWorkTitle} /></label><label><span>Activity date</span><input aria-label="Activity date" onChange={(event) => setNewWorkDate(event.target.value)} type="date" value={newWorkDate} /></label></div><button className={styles.popupAction} disabled={!newWorkTitle.trim()} type="submit">Add to {selectedWeek}</button></form></div> : null}
    {utilityOverlay ? <UtilityPopup onClose={closeUtilityOverlay} onPickAgain={chooseRandomStudent} onRemix={makeTeams} onSetTimer={setClassTimer} onToggleTimer={() => timer === 0 ? setClassTimer(timerDuration) : setTimerRunning((value) => !value)} overlay={utilityOverlay} timer={timer} timerDuration={timerDuration} timerRunning={timerRunning} /> : null}
    {rewardEffect ? <RewardAnimation effect={rewardEffect} key={rewardEffect.id} onClose={closeReward} /> : null}
  </div>;
}
