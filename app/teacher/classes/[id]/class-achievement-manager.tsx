"use client";

import Link from "next/link";
import styles from "./class-manager.module.css";

export type WorkSummary = { ok: number; notOk: number; late: number; recorded: number };
export type WeekAchievement = { stars: number; homework: WorkSummary; classwork: WorkSummary };
export type ManagerScore = { attemptId: string; score: number; maxScore: number; percent: number };
export type ManagerAssessment = { id: string; title: string; kind: string; status: string; average: number | null };
export type ManagerStudent = { id: string; fullName: string; email: string | null; totalStars: number; homework: WorkSummary; classwork: WorkSummary; weeks: Record<string, WeekAchievement>; scores: Record<string, ManagerScore>; assessmentAverage: number | null };

export default function ClassAchievementManager({ students, assessments }: { students: ManagerStudent[]; assessments: ManagerAssessment[] }) {
  return <section className={styles.gradebookSection}>
      <header className={styles.sectionHeader}><div><p className="eyebrow">Assessment grades</p><h2>Class manager gradebook</h2><p>Only assessments marked “Show this grade in the class manager” appear here.</p></div><Link className={styles.assessmentLink} href="/teacher/assignments">Manage assessments →</Link></header>
      {assessments.length ? <div className={styles.tableScroller}><table className={styles.gradeTable}><thead><tr><th className={styles.studentColumn}>Student</th>{assessments.map((assessment) => <th key={assessment.id}><Link href={`/teacher/assignments/${assessment.id}`}><strong>{assessment.title}</strong><span>{assessment.kind} · {assessment.status}</span><small>{assessment.average === null ? "No submissions" : `Class average ${assessment.average}%`}</small></Link></th>)}<th className={styles.overallColumn}>Grade average</th></tr></thead><tbody>{students.map((student) => <tr key={student.id}><th className={styles.studentColumn}><Link href={`/teacher/students/${student.id}`}><strong>{student.fullName}</strong><span>View full progress →</span></Link></th>{assessments.map((assessment) => { const score = student.scores[assessment.id]; return <td key={assessment.id}>{score ? <Link className={styles.score} href={`/teacher/assignments/${assessment.id}/attempts/${score.attemptId}`}><strong>{score.percent}%</strong><span>{score.score}/{score.maxScore}</span></Link> : <span className={styles.noScore}>Not submitted</span>}</td>; })}<td className={styles.overallColumn}>{student.assessmentAverage === null ? <span className={styles.noScore}>—</span> : <strong className={styles.average}>{student.assessmentAverage}%</strong>}</td></tr>)}</tbody></table></div> : <div className={styles.emptyGradebook}><strong>No assessment grades selected yet.</strong><p>Open an assignment and enable its class-manager grade setting. Arithmetic Homework is enabled automatically.</p></div>}
  </section>;
}
