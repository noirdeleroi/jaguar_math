import Link from "next/link";

import type { StudentClassroomRecord, StudentRecordStatus, StudentWorkRecord, StudentWorkSummary } from "@/lib/student-classroom-record";
import LogoutButton from "../logout-button";
import styles from "./records.module.css";

function percentage(summary: StudentWorkSummary) {
  return summary.recorded ? `${Math.round(summary.ok / summary.recorded * 100)}%` : "—";
}

function WorkSummary({ kind, summary }: { kind: "HW" | "CW"; summary: StudentWorkSummary }) {
  return <div className={styles.workSummary}>
    <span>{kind}</span>
    <strong>{summary.recorded ? `${summary.ok}/${summary.recorded}` : "—"}</strong>
    <small>{summary.items ? `${summary.items} ${summary.items === 1 ? "item" : "items"}` : `No ${kind} items`}</small>
    {summary.late || summary.notOk ? <div>{summary.late ? <b className={styles.late}>Late {summary.late}</b> : null}{summary.notOk ? <b className={styles.notOk}>Not OK {summary.notOk}</b> : null}</div> : null}
  </div>;
}

const statusLabels: Record<StudentRecordStatus, string> = { ok: "OK", not_ok: "Not OK", late: "Late" };

function WorkItem({ item }: { item: StudentWorkRecord }) {
  return <article className={styles.workItem}>
    <div><strong>{item.kind === "homework" ? "HW" : "CW"} {item.position} · {item.title}</strong>{item.activityDate ? <small>{new Date(`${item.activityDate}T00:00:00`).toLocaleDateString(undefined, { dateStyle: "medium" })}</small> : null}</div>
    <span className={item.status ? styles[item.status] : styles.unrecorded}>{item.status ? statusLabels[item.status] : "Not recorded"}</span>
  </article>;
}

function WorkDetails({ label, items }: { label: string; items: StudentWorkRecord[] }) {
  return <section><h4>{label}</h4>{items.length ? <div>{items.map((item) => <WorkItem item={item} key={item.id} />)}</div> : <p>No {label.toLowerCase()} items were entered for this week.</p>}</section>;
}

export default function StudentRecordsView({ record }: { record: StudentClassroomRecord }) {
  return <main className="student-page"><div className={`student-container ${styles.container}`}>
    <header className="student-header"><Link className="auth-brand" href="/student"><span className="brand-mark" aria-hidden="true">∑</span>Jaguar Math</Link><nav aria-label="Student navigation" className="student-header-actions"><Link href="/student/assessments">Assessments</Link><Link aria-current="page" href="/student/records">Class record</Link><Link href="/student/progress">Progress</Link><Link href="/student/sat-math">SAT Math info</Link><LogoutButton /></nav></header>

    <section className={styles.heading}><p className="eyebrow">Your achievement record</p><h1>Stars, homework and classwork.</h1><p>Follow your weekly classroom record. HW and CW totals show how many recorded items were marked OK.</p></section>

    {record.classes.length ? <>
      <section aria-label="Overall classroom record" className={styles.overview}>
        <article className={styles.starOverview}><span>Total stars</span><strong>★ {record.totalStars}</strong><small>Across {record.classes.length} {record.classes.length === 1 ? "class" : "classes"}</small></article>
        <article><span>Homework OK</span><strong>{percentage(record.homework)}</strong><small>{record.homework.ok} of {record.homework.recorded} recorded</small></article>
        <article><span>Classwork OK</span><strong>{percentage(record.classwork)}</strong><small>{record.classwork.ok} of {record.classwork.recorded} recorded</small></article>
        <article><span>Weeks with records</span><strong>{record.activeWeeks}</strong><small>Stars or classroom work entered</small></article>
      </section>

      <div className={styles.classList}>{record.classes.map((classroom) => {
        const latestActiveIndex = classroom.weeks.reduce((latest, week, index) => week.hasActivity ? index : latest, -1);
        return <section className={styles.classCard} key={classroom.id}>
          <header className={styles.classHeader}><div><p className="eyebrow">Grade {classroom.gradeLevel} · {classroom.academicYear}</p><h2>{classroom.name}</h2><span>{classroom.weeks.length} teaching weeks · {classroom.activeWeeks} with records</span></div><div className={styles.classTotals}><strong>★ {classroom.totalStars}</strong><span>HW {percentage(classroom.homework)}</span><span>CW {percentage(classroom.classwork)}</span></div></header>
          {classroom.weeks.length ? <div className={styles.weekList}>{classroom.weeks.map((week, weekIndex) => <details className={`${styles.weekCard} ${week.hasActivity ? styles.hasActivity : ""}`} key={week.id} open={weekIndex === latestActiveIndex}>
            <summary>
              <div className={styles.weekName}><b>{week.label}</b><span><strong>{week.topic}</strong><small>{week.unit}</small></span></div>
              <div className={`${styles.weekStars} ${week.stars < 0 ? styles.negativeStars : ""}`}><span>Stars</span><strong>★ {week.stars}</strong></div>
              <WorkSummary kind="HW" summary={week.homework} />
              <WorkSummary kind="CW" summary={week.classwork} />
              <i aria-hidden="true">⌄</i>
            </summary>
            <div className={styles.weekDetails}>{week.work.length ? <div className={styles.workColumns}><WorkDetails items={week.work.filter(({ kind }) => kind === "homework")} label="Homework" /><WorkDetails items={week.work.filter(({ kind }) => kind === "classwork")} label="Classwork" /></div> : <p className={styles.noWeekWork}>{week.stars ? "No HW or CW items were entered for this week." : "No classroom records have been entered for this week yet."}</p>}</div>
          </details>)}</div> : <div className={styles.emptyClass}><strong>No teaching weeks are available yet.</strong><p>Your teacher’s records will appear here when they are ready.</p></div>}
        </section>;
      })}</div>
    </> : <section className={styles.empty}><span aria-hidden="true">★</span><h2>No class record yet.</h2><p>Once you are enrolled in a class, your weekly Stars, HW, and CW records will appear here.</p><Link href="/student">Return to dashboard →</Link></section>}
  </div></main>;
}
