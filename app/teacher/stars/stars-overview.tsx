"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import CurrentWeekSelector from "@/app/teacher/current-week-selector";
import styles from "./stars-overview.module.css";

type WeekOption = { label: string; sortOrder: number; trimester: string };
type ClassSummary = { id: string; name: string; gradeLevel: number; academicYear: string; studentCount: number; unit: string; topic: string };
type WorkKind = "homework" | "classwork";

function today() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function automaticTitle(kind: WorkKind, week: string) {
  return `${kind === "homework" ? "HW" : "CW"} ${week}`;
}

export default function StarsOverview({ classes, currentWeek, weekOptions }: { classes: ClassSummary[]; currentWeek: string; weekOptions: WeekOption[] }) {
  const router = useRouter();
  const [scope, setScope] = useState("all");
  const [kind, setKind] = useState<WorkKind>("homework");
  const [title, setTitle] = useState(() => automaticTitle("homework", currentWeek));
  const [activityDate, setActivityDate] = useState(today);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  function changeKind(nextKind: WorkKind) {
    setKind(nextKind);
    setTitle(automaticTitle(nextKind, currentWeek));
  }

  async function createWork() {
    if (!title.trim()) return;
    setSaving(true);
    setMessage(`Creating ${kind === "homework" ? "homework" : "classwork"} with OK selected for every student…`);
    try {
      const response = await fetch("/api/stars/work-items", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope, weekLabel: currentWeek, kind, title, activityDate }) });
      const result = await response.json() as { error?: string; created?: { class_count?: number } };
      if (!response.ok) throw new Error(result.error || "The work record could not be created.");
      const count = result.created?.class_count ?? (scope === "all" ? classes.length : 1);
      setMessage(`${title} created in ${count} ${count === 1 ? "class" : "classes"}. Every student starts as OK; open a class to mark Not OK or Late.`);
      router.refresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "The work record could not be created.");
    } finally {
      setSaving(false);
    }
  }

  return <main className={`teacher-main ${styles.main}`}>
    <section className={styles.heading}><div><p className="eyebrow">Classroom rewards</p><h1>Jaguar Stars</h1><p>One compact place for weekly stars, homework, classwork, and curriculum topics.</p></div><a className={styles.backup} href="/api/stars/export">Download Excel backup</a></section>

    <section className={styles.weekPanel}><CurrentWeekSelector currentWeek={currentWeek} options={weekOptions} /><div><span>Active across Stars</span><strong>{currentWeek}</strong><small>Each grade keeps its own curriculum topic.</small></div></section>

    <section className={styles.creator}>
      <div><p className="eyebrow">Add to one class or all</p><h2>New HW / CW</h2><p>Name and today’s date are filled automatically. You can change both before creating it.</p></div>
      <div className={styles.creatorFields}>
        <label><span>Classes</span><select onChange={(event) => setScope(event.target.value)} value={scope}><option value="all">All classes</option>{classes.map((classroom) => <option key={classroom.id} value={classroom.id}>{classroom.name}</option>)}</select></label>
        <label><span>Type</span><select onChange={(event) => changeKind(event.target.value as WorkKind)} value={kind}><option value="homework">Homework</option><option value="classwork">Classwork</option></select></label>
        <label className={styles.titleField}><span>Name</span><input maxLength={120} onChange={(event) => setTitle(event.target.value)} value={title} /></label>
        <label><span>Date</span><input onChange={(event) => setActivityDate(event.target.value)} type="date" value={activityDate} /></label>
        <button disabled={saving || !classes.length || !title.trim()} onClick={() => void createWork()} type="button">{saving ? "Creating…" : `Create ${kind === "homework" ? "HW" : "CW"}`}</button>
      </div>
      {message ? <p className={styles.message} role="status">{message}</p> : null}
    </section>

    <section className={styles.classes}>
      <div className={styles.sectionHeading}><div><p className="eyebrow">{currentWeek}</p><h2>Classes and topics</h2></div><span>{classes.length} classes</span></div>
      {classes.length ? <div className={styles.classGrid}>{classes.map((classroom) => <Link href={`/teacher/classes/${classroom.id}/stars`} key={classroom.id}><header><div><strong>{classroom.name}</strong><span>Grade {classroom.gradeLevel} · {classroom.studentCount} students</span></div><b>Open →</b></header><p>{classroom.topic}</p><small>{classroom.unit}</small></Link>)}</div> : <div className="compact-empty"><h3>No classes yet.</h3><p>Create or sync a class before opening Jaguar Stars.</p></div>}
    </section>
  </main>;
}
