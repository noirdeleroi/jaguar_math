"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import MathText from "@/app/components/math-text";
import { teacherCanReviewAttempt } from "@/lib/teacher-attempt-review";
import { adjustPaperAnswerTime, forceSubmitTestAttempt, grantTestExtraTime, unsubmitTestAttempt } from "../assignment-actions";
import PaperAnswerEntry from "./paper-answer-entry";
import styles from "./test-manager-controls.module.css";

type Summary = { assigned_students: number; submitted_students: number; scored_students: number; average_percentage: number | null; median_percentage: number | null; highest_percentage: number | null; lowest_percentage: number | null; average_completion_seconds: number | null };
type Distribution = { label: string; count: number };
type Student = { student_id: string; student_name: string; email: string | null; attempt_id: string | null; attempt_number: number | null; score: number | null; max_score: number | null; percentage: number | null; submitted_at: string | null; completion_seconds: number | null; status: "submitted" | "in_progress" | "not_started"; started_at?: string | null; expires_at?: string | null; answered_count?: number; total_questions?: number; last_activity_at?: string | null; extra_time_minutes?: number; answer_adjustment_seconds?: number; focus_violations?: number; form_code?: string | null; offline_recovery_used?: boolean; offline_recovery_seconds?: number };
type Question = { question_id: string; position: number; points: number; prompt: string; type: string; difficulty: number; version_count?: number; primary_skill_code: string | null; primary_skill_name: string | null; submitted_count: number; correct_count: number; incorrect_count: number; unanswered_count: number; correct_percentage: number | null; incorrect_students: { student_id: string; student_name: string }[] };
type Skill = { code: string; name: string; evidence_count: number; correct_count: number; students_with_evidence: number; accuracy: number | null };
export type AssignmentResultsOverview = { summary: Summary; distribution: Distribution[]; students: Student[]; questions: Question[]; skills: Skill[] };
type ResultsTab = "performance" | "students" | "analysis" | "questions";

const percent = (value: number | null) => value === null || Number.isNaN(Number(value)) ? "—" : `${Math.round(Number(value))}%`;
const duration = (seconds: number | null) => { if (seconds === null || Number.isNaN(Number(seconds))) return "—"; const minutes = Math.round(Number(seconds) / 60); return minutes < 1 ? "<1m" : `${minutes}m`; };
const submittedAt = (value: string | null) => value ? new Date(value).toLocaleString() : "—";
const remainingTime = (expiresAt: string | null | undefined, now: number) => {
  if (!expiresAt) return "Untimed";
  if (!now) return "…";
  const seconds = Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 1000));
  if (seconds === 0) return "Time ended";
  const hours = Math.floor(seconds / 3600); const minutes = Math.floor((seconds % 3600) / 60); const remainder = seconds % 60;
  return hours ? `${hours}h ${minutes}m` : `${minutes}m ${remainder.toString().padStart(2, "0")}s`;
};

export default function ResultsOverviewClient({ assignmentId, overview, examMode = false, paperMode = false, paperAnswersReleased = false, allowedFocusExits = 0, live = false, tabbed = false, questionSet }: { assignmentId: string; overview: AssignmentResultsOverview; examMode?: boolean; paperMode?: boolean; paperAnswersReleased?: boolean; allowedFocusExits?: number; live?: boolean; tabbed?: boolean; questionSet?: ReactNode }) {
  const router = useRouter();
  const monitored = examMode || paperMode;
  const [sort, setSort] = useState<"name" | "percentage" | "submitted_at">("name"); const [ascending, setAscending] = useState(true); const [activeTab, setActiveTab] = useState<ResultsTab>(monitored && live ? "students" : "performance"); const [now, setNow] = useState(0); const [selectedStudents, setSelectedStudents] = useState<string[]>([]); const [answerEntryStudentId, setAnswerEntryStudentId] = useState<string | null>(null);
  const students = useMemo(() => [...overview.students].sort((left, right) => { const leftValue = sort === "name" ? left.student_name : sort === "percentage" ? left.percentage ?? -1 : left.submitted_at ? new Date(left.submitted_at).getTime() : -1; const rightValue = sort === "name" ? right.student_name : sort === "percentage" ? right.percentage ?? -1 : right.submitted_at ? new Date(right.submitted_at).getTime() : -1; const comparison = typeof leftValue === "string" && typeof rightValue === "string" ? leftValue.localeCompare(rightValue) : Number(leftValue) - Number(rightValue); return ascending ? comparison : -comparison; }), [ascending, overview.students, sort]);
  const reviewQuestions = overview.questions.filter((question) => question.correct_percentage !== null).slice(0, 3); const reviewSkills = overview.skills.filter((skill) => skill.accuracy !== null).slice(0, 3); const notSubmitted = overview.students.filter((student) => student.status === "not_started"); const maxBand = Math.max(1, ...overview.distribution.map((band) => Number(band.count)));
  const changeSort = (next: typeof sort) => { if (sort === next) setAscending((value) => !value); else { setSort(next); setAscending(next === "name"); } };
  const studentIds = useMemo(() => overview.students.map((student) => student.student_id), [overview.students]);
  const selectedAssignedStudents = selectedStudents.filter((studentId) => studentIds.includes(studentId));
  const allStudentsSelected = studentIds.length > 0 && studentIds.every((studentId) => selectedAssignedStudents.includes(studentId));
  const toggleStudent = (studentId: string) => setSelectedStudents((current) => current.includes(studentId) ? current.filter((id) => id !== studentId) : [...current, studentId]);

  useEffect(() => {
    if (!monitored) return;
    const initial = window.setTimeout(() => setNow(Date.now()), 0);
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); };
  }, [monitored]);

  useEffect(() => {
    if (!live || answerEntryStudentId) return;
    const timer = window.setInterval(() => router.refresh(), monitored ? 5000 : 10000);
    return () => window.clearInterval(timer);
  }, [answerEntryStudentId, live, monitored, router]);

  const performancePanel = <div className="results-performance-panel"><div className="results-summary"><article><span>Submitted</span><strong>{overview.summary.submitted_students} / {overview.summary.assigned_students}</strong></article><article><span>Average</span><strong>{percent(overview.summary.average_percentage)}</strong></article><article><span>Median</span><strong>{percent(overview.summary.median_percentage)}</strong></article><article><span>Highest</span><strong>{percent(overview.summary.highest_percentage)}</strong></article><article><span>Lowest</span><strong>{percent(overview.summary.lowest_percentage)}</strong></article>{overview.summary.average_completion_seconds !== null && <article><span>Average time</span><strong>{duration(overview.summary.average_completion_seconds)}</strong></article>}</div>
    {overview.summary.submitted_students === 0 ? <p className="form-note results-empty">No submitted attempts yet. Students who have not started are not treated as zero scores.</p> : <><section className="score-distribution"><h3>Score distribution</h3>{overview.distribution.map((band) => <div className="distribution-row" key={band.label}><span>{band.label}</span><i><b style={{ width: `${100 * Number(band.count) / maxBand}%` }} /></i><strong>{band.count}</strong></div>)}</section>{(reviewQuestions.length || reviewSkills.length) ? <section className="review-priorities"><h3>Review priorities</h3><p>Lowest observed accuracy among submitted responses.</p>{reviewQuestions.map((question) => <div key={`question-${question.question_id}`}><b>Q{question.position}</b><span><MathText>{question.prompt}</MathText></span><strong>{percent(question.correct_percentage)}</strong></div>)}{reviewSkills.map((skill) => <div key={`skill-${skill.code}`}><b>{skill.code}</b><span>{skill.name}</span><strong>{percent(skill.accuracy)}</strong></div>)}</section> : null}</>}
    <section className="assignment-skill-summary"><h3>Skill performance for this assignment</h3><p className="form-note">Each submitted response contributes once to each Jaguar skill linked to that question; no historical assignment evidence is included.</p>{overview.skills.length ? overview.skills.map((skill) => <article key={skill.code}><div><strong>{skill.name}</strong><small>{skill.code} · {skill.correct_count}/{skill.evidence_count} correct · {skill.students_with_evidence} students with evidence</small></div><b>{percent(skill.accuracy)}</b></article>) : <p className="form-note">No submitted skill evidence yet.</p>}</section></div>;

  const testManagerToolbar = examMode && live ? <form action={grantTestExtraTime} className={styles.managerToolbar} id="test-extra-time-form" onSubmit={(event) => { if (!window.confirm(`Give ${selectedAssignedStudents.length} selected student${selectedAssignedStudents.length === 1 ? "" : "s"} more time?`)) event.preventDefault(); }}>
    <input name="assignment_id" type="hidden" value={assignmentId} />
    <div className={styles.toolbarIntro}><span className={styles.liveStatus}>Live · refreshes every 5 seconds</span><strong>Give students extra time</strong><span>Select one, several, or every student. Active deadlines update now; others receive the time when they start.</span></div>
    <div className={styles.selectionActions}>
      <button disabled={!studentIds.length} onClick={() => setSelectedStudents(allStudentsSelected ? [] : studentIds)} type="button">{allStudentsSelected ? "Clear all" : "Select all students"}</button>
      <label className={styles.minutesField}>Extra minutes<input defaultValue="10" max="1440" min="1" name="extra_minutes" required type="number" /></label>
      <button disabled={!selectedAssignedStudents.length} type="submit">Give time ({selectedAssignedStudents.length})</button>
    </div>
  </form> : null;

  const paperManagerToolbar = paperMode && live ? paperAnswersReleased ? <form action={adjustPaperAnswerTime} className={styles.managerToolbar} id="paper-answer-time-form">
    <input name="assignment_id" type="hidden" value={assignmentId} />
    <div className={styles.toolbarIntro}><span className={styles.liveStatus}>Live · refreshes every 5 seconds</span><strong>Adjust individual answer time</strong><span>Select students, then add or remove seconds. Their open countdown updates automatically.</span></div>
    <div className={styles.selectionActions}>
      <button disabled={!studentIds.length} onClick={() => setSelectedStudents(allStudentsSelected ? [] : studentIds)} type="button">{allStudentsSelected ? "Clear all" : "Select all students"}</button>
      <label className={styles.minutesField}>Seconds<input defaultValue="30" max="3600" min="1" name="seconds" required type="number" /></label>
      <button disabled={!selectedAssignedStudents.length} name="direction" type="submit" value="increase">Add ({selectedAssignedStudents.length})</button>
      <button disabled={!selectedAssignedStudents.length} name="direction" type="submit" value="decrease">Remove ({selectedAssignedStudents.length})</button>
    </div>
  </form> : <div className={styles.managerToolbar}><div className={styles.toolbarIntro}><span className={styles.liveStatus}>Waiting room live</span><strong>Answer timing controls unlock after release</strong><span>Versions, fullscreen exits, and waiting-room status already appear below.</span></div></div> : null;

  const studentsPanel = <section className="results-table-section">
    <div className="section-row"><div><h3>{examMode ? "Test manager" : paperMode ? "Paper answer manager" : "Student results"}</h3><p className="form-note">{examMode ? "Live progress shows saved answers for every assigned student. Focus exits and offline recoveries are review signals, not proof of misconduct." : paperMode ? "Live progress shows each assigned paper version and the number of answers safely saved in Jaguar." : "Latest submitted attempt is used for scores and overview metrics."}</p></div></div>
    {testManagerToolbar}{paperManagerToolbar}
    <div className="results-sort" aria-label="Sort student results"><button className={sort === "name" ? "active" : ""} onClick={() => changeSort("name")} type="button">Name</button><button className={sort === "percentage" ? "active" : ""} onClick={() => changeSort("percentage")} type="button">Percentage</button><button className={sort === "submitted_at" ? "active" : ""} onClick={() => changeSort("submitted_at")} type="button">Submitted</button></div>
    <div className="results-table"><table><thead><tr>{monitored && live && <th className={styles.selectionCell}>Select</th>}<th>Student</th>{monitored && <><th>Form</th><th>Progress</th><th>Time left</th></>}<th>Score</th><th>Percentage</th><th>Submitted</th><th>Time</th>{monitored && <><th>Fullscreen exits</th><th>Recovery</th></>}<th>Status</th>{monitored && live && <th>Actions</th>}</tr></thead><tbody>{students.map((student) => {
      const answered = Number(student.answered_count ?? 0); const total = Number(student.total_questions ?? overview.questions.length); const progress = total > 0 ? Math.min(100, Math.round(100 * answered / total)) : 0; const timeLeft = student.status === "in_progress" ? remainingTime(student.expires_at, now) : "—"; const timeEnded = timeLeft === "Time ended";
      return <tr key={student.student_id}>
        {monitored && live && <td className={styles.selectionCell}><input aria-label={`Select ${student.student_name} for time controls`} checked={selectedStudents.includes(student.student_id)} disabled={paperMode && !paperAnswersReleased} form={paperMode ? "paper-answer-time-form" : "test-extra-time-form"} name="student_ids" onChange={() => toggleStudent(student.student_id)} type="checkbox" value={student.student_id} /></td>}
        <th>{teacherCanReviewAttempt(student) ? <Link href={`/teacher/assignments/${assignmentId}/attempts/${student.attempt_id}`} prefetch={student.status === "submitted" ? undefined : false}>{student.student_name}</Link> : student.student_name}</th>
        {monitored && <><td>{student.form_code ?? "—"}</td><td><div className={styles.progressCell}><strong>{answered} / {total} saved</strong><span className={styles.progressTrack}><i style={{ width: `${progress}%` }} /></span><small>{student.last_activity_at ? `Last save ${new Date(student.last_activity_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : student.status === "not_started" ? "Waiting to join" : paperMode && !paperAnswersReleased ? "Secure waiting room" : "No answers saved"}</small></div></td><td><div className={styles.timeCell}><strong className={timeEnded ? styles.timeEnded : ""}>{paperMode && !paperAnswersReleased ? "Not open" : timeLeft}</strong>{Boolean(student.extra_time_minutes) && <small>+{student.extra_time_minutes}m granted</small>}{Boolean(student.answer_adjustment_seconds) && <small>{Number(student.answer_adjustment_seconds) > 0 ? "+" : ""}{student.answer_adjustment_seconds}s adjusted</small>}</div></td></>}
        <td>{student.score !== null && student.max_score !== null ? `${student.score}/${student.max_score}` : "—"}</td><td>{percent(student.percentage)}</td><td>{submittedAt(student.submitted_at)}</td><td>{duration(student.completion_seconds)}</td>
        {monitored && <><td className={(student.focus_violations ?? 0) > allowedFocusExits ? "exam-focus-high" : ""}>{student.focus_violations ?? 0}{(student.focus_violations ?? 0) > allowedFocusExits ? " ⚠" : ""}</td><td className={student.offline_recovery_used ? "exam-focus-high" : ""}>{student.offline_recovery_used ? `Wi-Fi · ${student.offline_recovery_seconds}s` : "—"}</td></>}
        <td><span className={`attempt-status ${student.status}`}>{student.status === "not_started" ? "Not started" : student.status === "in_progress" ? "In progress" : "Submitted"}</span></td>
        {monitored && live && <td><div className={styles.rowActions}>{paperMode && paperAnswersReleased && <button className={styles.enterAnswersAction} onClick={() => setAnswerEntryStudentId(student.student_id)} type="button">Enter answers</button>}{student.status === "in_progress" && student.attempt_id && (!paperMode || paperAnswersReleased) ? <form action={forceSubmitTestAttempt} onSubmit={(event) => { if (!window.confirm(`Submit ${student.student_name}'s saved answers now?`)) event.preventDefault(); }}><input name="assignment_id" type="hidden" value={assignmentId} /><input name="attempt_id" type="hidden" value={student.attempt_id} /><button className={styles.submitAction} type="submit">Submit now</button></form> : examMode && student.status === "submitted" && student.attempt_id ? <form action={unsubmitTestAttempt} onSubmit={(event) => { if (!window.confirm(`Unsubmit ${student.student_name}'s Test? Their answers stay saved and grading is cleared. If their timer has ended, add extra time too.`)) event.preventDefault(); }}><input name="assignment_id" type="hidden" value={assignmentId} /><input name="attempt_id" type="hidden" value={student.attempt_id} /><button className={styles.unsubmitAction} type="submit">Unsubmit</button></form> : !paperMode && <span>—</span>}</div></td>}
      </tr>;
    })}</tbody></table></div>
    {notSubmitted.length ? <details className="not-submitted"><summary>Not started ({notSubmitted.length})</summary><p>{notSubmitted.map((student) => student.student_name).join(", ")}</p></details> : null}
  </section>;

  const analysisPanel = <section className="question-analysis"><h3>Question analysis</h3>{overview.questions.length ? overview.questions.map((question) => <article key={question.question_id}><div><span>Q{question.position} · {question.type.replace("_", " ")} · {question.points} pts{(question.version_count ?? 1) > 1 ? ` · ${question.version_count} versions` : ""}</span><strong><MathText>{question.prompt}</MathText></strong><small>Difficulty {question.difficulty}{question.primary_skill_code ? ` · ${question.primary_skill_code} — ${question.primary_skill_name}` : " · No primary skill"}{(question.version_count ?? 1) > 1 ? " · Results combine all assigned versions" : ""}</small></div><div className="question-observed"><b>{percent(question.correct_percentage)} correct</b><span>{question.correct_count} correct · {question.incorrect_count} incorrect · {question.unanswered_count} unanswered</span>{question.incorrect_students.length ? <details><summary>Students needing review ({question.incorrect_students.length})</summary><p>{question.incorrect_students.map((student) => student.student_name).join(", ")}</p></details> : null}</div></article>) : <p className="form-note">No questions are attached to this assignment.</p>}</section>;

  const answerEntry = answerEntryStudentId && paperMode ? <PaperAnswerEntry assignmentId={assignmentId} initialStudentId={answerEntryStudentId} onClose={() => setAnswerEntryStudentId(null)} students={students.map((student) => ({ studentId: student.student_id, name: student.student_name, status: student.status, answeredCount: Number(student.answered_count ?? 0), totalQuestions: Number(student.total_questions ?? overview.questions.length) }))} /> : null;
  if (!tabbed) return <div className="assignment-results-overview">{performancePanel}{studentsPanel}{analysisPanel}{answerEntry}</div>;
  const tabs: { id: ResultsTab; label: string }[] = [{ id: "performance", label: "Class performance" }, { id: "students", label: examMode ? "Test manager" : paperMode ? "Paper answer manager" : "Student results" }, { id: "analysis", label: "Question analysis" }, ...(questionSet ? [{ id: "questions" as const, label: "Question set" }] : [])];
  const activePanel = activeTab === "performance" ? performancePanel : activeTab === "students" ? studentsPanel : activeTab === "analysis" ? analysisPanel : questionSet;
  return <div className="assignment-results-overview is-tabbed"><div className="assignment-results-tabs" role="tablist" aria-label="Assignment results sections">{tabs.map((tab) => <button aria-controls={`assignment-tab-panel-${tab.id}`} aria-selected={activeTab === tab.id} className={activeTab === tab.id ? "active" : ""} id={`assignment-tab-${tab.id}`} key={tab.id} onClick={() => setActiveTab(tab.id)} role="tab" type="button"><span>{tab.label}</span>{tab.id === "students" && <small>{overview.students.length}</small>}{tab.id === "analysis" && <small>{overview.questions.length}</small>}</button>)}</div><div aria-labelledby={`assignment-tab-${activeTab}`} className="assignment-results-tab-panel" id={`assignment-tab-panel-${activeTab}`} role="tabpanel">{activePanel}</div>{answerEntry}</div>;
}
