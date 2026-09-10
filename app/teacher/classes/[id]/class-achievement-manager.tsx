"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import styles from "./class-manager.module.css";

export type WorkSummary = { ok: number; notOk: number; late: number; recorded: number };
export type WeekAchievement = { stars: number; homework: WorkSummary; classwork: WorkSummary };
export type ManagerWeek = { id: string; label: string; sortOrder: number; unit: string; topic: string; homeworkItems: number; classworkItems: number };
export type ManagerScore = { attemptId: string; score: number; maxScore: number; percent: number };
export type ManagerAssessment = { id: string; title: string; kind: string; status: string; average: number | null };
export type ManagerStudent = { id: string; fullName: string; email: string | null; totalStars: number; homework: WorkSummary; classwork: WorkSummary; weeks: Record<string, WeekAchievement>; scores: Record<string, ManagerScore>; assessmentAverage: number | null };

const emptyWork = (): WorkSummary => ({ ok: 0, notOk: 0, late: 0, recorded: 0 });
const emptyWeek = (): WeekAchievement => ({ stars: 0, homework: emptyWork(), classwork: emptyWork() });

function WorkLine({ kind, summary }: { kind: "HW" | "CW"; summary: WorkSummary }) {
  if (!summary.recorded) return <small className={styles.emptyWork}>{kind} —</small>;
  return <small className={styles.workLine}><span>{kind} {summary.ok}/{summary.recorded}</span>{summary.late ? <b className={styles.late}>L{summary.late}</b> : null}{summary.notOk ? <b className={styles.missing}>✕{summary.notOk}</b> : null}</small>;
}

export default function ClassAchievementManager({ classId, currentWeekLabel, weeks, students, assessments }: { classId: string; currentWeekLabel: string; weeks: ManagerWeek[]; students: ManagerStudent[]; assessments: ManagerAssessment[] }) {
  const trimesterOptions = useMemo(() => [...new Set(weeks.map((week) => week.label.slice(0, 1)))], [weeks]);
  const [view, setView] = useState(() => trimesterOptions.includes(currentWeekLabel.slice(0, 1)) ? currentWeekLabel.slice(0, 1) : trimesterOptions[0] ?? "A");
  const visibleWeeks = view === "all" ? weeks : weeks.filter((week) => week.label.startsWith(view));

  return <>
    <section className={styles.matrixSection}>
      <header className={styles.sectionHeader}><div><p className="eyebrow">Week-by-week achievement</p><h2>Stars, homework and classwork</h2><p>Open any week to manage its individual Stars page. HW and CW figures show OK records out of recorded statuses.</p></div><nav aria-label="Choose weeks to display">{trimesterOptions.map((trimester) => <button aria-pressed={view === trimester} className={view === trimester ? styles.activeFilter : ""} key={trimester} onClick={() => setView(trimester)} type="button">Trimester {trimester}</button>)}<button aria-pressed={view === "all"} className={view === "all" ? styles.activeFilter : ""} onClick={() => setView("all")} type="button">All weeks</button></nav></header>
      <div className={styles.tableScroller}>
        <table className={styles.weekTable}>
          <thead><tr><th className={styles.studentColumn}>Student</th>{visibleWeeks.map((week) => <th className={week.label === currentWeekLabel ? styles.currentWeek : ""} key={week.id}><Link href={`/teacher/classes/${classId}/stars?week=${week.label}`} title={`${week.unit}: ${week.topic}`}><strong>{week.label}</strong><span>{week.homeworkItems} HW · {week.classworkItems} CW</span><small>{week.label === currentWeekLabel ? "Current · open →" : "Open week →"}</small></Link></th>)}<th className={styles.overallColumn}>Overall</th></tr></thead>
          <tbody>{students.map((student) => <tr key={student.id}><th className={styles.studentColumn}><Link href={`/teacher/students/${student.id}`}><strong>{student.fullName}</strong><span>{student.email || "Student profile"}</span></Link></th>{visibleWeeks.map((week) => { const achievement = student.weeks[week.label] ?? emptyWeek(); return <td className={week.label === currentWeekLabel ? styles.currentWeek : ""} key={week.id}><strong className={styles.starTotal}>★ {achievement.stars}</strong><WorkLine kind="HW" summary={achievement.homework} /><WorkLine kind="CW" summary={achievement.classwork} /></td>; })}<td className={styles.overallColumn}><strong className={styles.starTotal}>★ {student.totalStars}</strong><WorkLine kind="HW" summary={student.homework} /><WorkLine kind="CW" summary={student.classwork} /></td></tr>)}</tbody>
        </table>
      </div>
    </section>

    <section className={styles.gradebookSection}>
      <header className={styles.sectionHeader}><div><p className="eyebrow">Assessment grades</p><h2>Class manager gradebook</h2><p>Only assessments marked “Show this grade in the class manager” appear here.</p></div><Link className={styles.assessmentLink} href="/teacher/assignments">Manage assessments →</Link></header>
      {assessments.length ? <div className={styles.tableScroller}><table className={styles.gradeTable}><thead><tr><th className={styles.studentColumn}>Student</th>{assessments.map((assessment) => <th key={assessment.id}><Link href={`/teacher/assignments/${assessment.id}`}><strong>{assessment.title}</strong><span>{assessment.kind} · {assessment.status}</span><small>{assessment.average === null ? "No submissions" : `Class average ${assessment.average}%`}</small></Link></th>)}<th className={styles.overallColumn}>Grade average</th></tr></thead><tbody>{students.map((student) => <tr key={student.id}><th className={styles.studentColumn}><Link href={`/teacher/students/${student.id}`}><strong>{student.fullName}</strong><span>View full progress →</span></Link></th>{assessments.map((assessment) => { const score = student.scores[assessment.id]; return <td key={assessment.id}>{score ? <Link className={styles.score} href={`/teacher/assignments/${assessment.id}/attempts/${score.attemptId}`}><strong>{score.percent}%</strong><span>{score.score}/{score.maxScore}</span></Link> : <span className={styles.noScore}>Not submitted</span>}</td>; })}<td className={styles.overallColumn}>{student.assessmentAverage === null ? <span className={styles.noScore}>—</span> : <strong className={styles.average}>{student.assessmentAverage}%</strong>}</td></tr>)}</tbody></table></div> : <div className={styles.emptyGradebook}><strong>No assessment grades selected yet.</strong><p>Open an assignment and enable its class-manager grade setting. Arithmetic Homework is enabled automatically.</p></div>}
    </section>
  </>;
}
