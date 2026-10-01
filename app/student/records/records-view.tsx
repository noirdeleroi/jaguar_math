import Link from "next/link";

import type { StudentClassroomRecord, StudentTopicRecord } from "@/lib/student-classroom-record";
import LogoutButton from "../logout-button";
import styles from "./records.module.css";

function TopicResult({ topic }: { topic: StudentTopicRecord }) {
  if (topic.gradingMode === "classwork") {
    return <div className={styles.result}><span>Classwork</span><strong>{topic.classworkGrade}%</strong></div>;
  }
  return <div className={`${styles.result} ${topic.stars < 0 ? styles.negativeResult : styles.starResult}`}><span>Stars</span><strong>★ {topic.stars}</strong></div>;
}

function FinalGrade({ topic }: { topic: StudentTopicRecord }) {
  return <div className={styles.finalGrade}><span>Final grade</span><strong>{topic.finalGrade !== null && topic.finalGradeMax !== null ? `${topic.finalGrade} / ${topic.finalGradeMax}` : "—"}</strong></div>;
}

export default function StudentRecordsView({ record }: { record: StudentClassroomRecord }) {
  return <main className="student-page"><div className={`student-container ${styles.container}`}>
    <header className="student-header"><Link className="auth-brand" href="/student"><span className="brand-mark" aria-hidden="true">∑</span>Jaguar Math</Link><nav aria-label="Student navigation" className="student-header-actions"><Link href="/student/assessments">Assessments</Link><Link aria-current="page" href="/student/records">Class record</Link><Link href="/student/progress">Progress</Link><Link href="/student/sat-math">SAT Math info</Link><LogoutButton /></nav></header>

    <section className={styles.heading}><p className="eyebrow">Your achievement record</p><h1>Class record</h1><p>Every topic, in order, with your topic result and final grade.</p></section>

    {record.classes.length ? <div className={styles.classList}>{record.classes.map((classroom) => <section className={styles.classSection} key={classroom.id}>
      <header className={styles.classHeader}><div><h2>{classroom.name}</h2><p>Grade {classroom.gradeLevel} · {classroom.academicYear}</p></div><span>{classroom.topics.length} {classroom.topics.length === 1 ? "topic" : "topics"}</span></header>
      {classroom.topics.length ? <div className={styles.topicList} role="table" aria-label={`${classroom.name} topics`}>
        <div className={styles.listHeader} role="row"><span role="columnheader">Topic</span><span role="columnheader">Topic result</span><span role="columnheader">Final grade</span></div>
        {classroom.topics.map((topic) => <div className={styles.topicRow} key={topic.id} role="row">
          <div className={styles.topicName} role="cell"><span aria-hidden="true">{String(topic.sortOrder).padStart(2, "0")}</span><strong>{topic.title}</strong></div>
          <div role="cell"><TopicResult topic={topic} /></div>
          <div role="cell"><FinalGrade topic={topic} /></div>
        </div>)}
      </div> : <div className={styles.emptyClass}><strong>No topics are available yet.</strong><p>Your teacher’s topics will appear here when they are ready.</p></div>}
    </section>)}</div> : <section className={styles.empty}><span aria-hidden="true">★</span><h2>No class record yet.</h2><p>Once you are enrolled in a class, your topic results and final grades will appear here.</p><Link href="/student">Return to dashboard →</Link></section>}
  </div></main>;
}
