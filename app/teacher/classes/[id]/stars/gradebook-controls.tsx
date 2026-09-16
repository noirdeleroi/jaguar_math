"use client";

import { useState } from "react";
import type { AvailableClassroomAssessment, ClassroomGrade, ClassroomGradeColumn, ClassroomWeek, ClassroomWorkItem } from "@/lib/classroom-stars";
import { evaluateTopicGradeFormula, normalizeTopicGradeFormula } from "@/lib/classroom-topic-grade";
import styles from "./class-gradebook.module.css";

function todayKey() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function TopicSettingsDialog({ classId, topic, gradeColumns, onClose, onSaved }: {
  classId: string;
  topic: ClassroomWeek;
  gradeColumns: ClassroomGradeColumn[];
  onClose: () => void;
  onSaved: (topic: ClassroomWeek) => void;
}) {
  const [title, setTitle] = useState(topic.title || `Topic ${topic.sortOrder}`);
  const [formula, setFormula] = useState(topic.finalGradeFormula);
  const [summativeGradeColumnId, setSummativeGradeColumnId] = useState(topic.summativeGradeColumnId ?? gradeColumns[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  let preview = "";
  try {
    preview = String(Math.round(evaluateTopicGradeFormula(formula, { N: 16, stars: 4, skulls: 2 }) * 100) / 100);
  } catch { /* The submit handler presents the precise validation message. */ }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    let normalizedFormula: string;
    try {
      normalizedFormula = normalizeTopicGradeFormula(formula);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Check the final-grade formula.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`/api/classes/${classId}/topics/${topic.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, finalGradeFormula: normalizedFormula, summativeGradeColumnId: summativeGradeColumnId || null }),
      });
      const result = await response.json() as { topic?: ClassroomWeek; error?: string };
      if (!response.ok || !result.topic) throw new Error(result.error || "The topic settings could not be saved.");
      onSaved(result.topic);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "The topic settings could not be saved.");
      setBusy(false);
    }
  }

  return <div className={styles.dialogBackdrop} role="presentation"><section aria-modal="true" className={styles.columnDialog} role="dialog">
    <button aria-label="Close topic settings" className={styles.dialogClose} disabled={busy} onClick={onClose} type="button">×</button>
    <p className={styles.dialogEyebrow}>{topic.label} · Topic settings</p>
    <h2>Final topic grade</h2>
    <p>Choose the summative test used as <strong>N</strong>, then adjust the formula if this topic needs different grading.</p>
    <form className={styles.columnForm} onSubmit={submit}>
      <label>Topic name<input autoFocus maxLength={120} onChange={(event) => setTitle(event.target.value)} required value={title} /></label>
      <label>Summative test (N)<select disabled={!gradeColumns.length} onChange={(event) => setSummativeGradeColumnId(event.target.value)} value={summativeGradeColumnId}><option value="">{gradeColumns.length ? "No summative test selected" : "Add a test column first"}</option>{gradeColumns.map((column) => <option key={column.id} value={column.id}>{column.title}{column.maxScore ? ` · out of ${column.maxScore}` : ""}</option>)}</select></label>
      <label>Final-grade formula<input maxLength={120} onChange={(event) => setFormula(event.target.value)} placeholder="N + stars - skulls" required value={formula} /></label>
      <div className={styles.formulaHelp}><code>N</code><span>summative points</span><code>stars</code><span>topic stars</span><code>skulls</code><span>topic skulls</span></div>
      <p className={styles.formulaPreview}>{preview ? `Example: N 16 + 4 stars − 2 skulls = ${preview}` : "Enter a valid formula using N, stars, and skulls."}</p>
      {message ? <p className={styles.formError} role="alert">{message}</p> : null}
      <div className={styles.dialogActions}><button disabled={busy || !title.trim()} type="submit">{busy ? "Saving…" : "Save topic"}</button></div>
    </form>
  </section></div>;
}

export function GradeColumnDialog({ classId, weeks, availableAssessments, defaultWeek, column, onClose, onSaved, onDeleted }: {
  classId: string;
  weeks: ClassroomWeek[];
  availableAssessments: AvailableClassroomAssessment[];
  defaultWeek: string;
  column: ClassroomGradeColumn | null;
  onClose: () => void;
  onSaved: (column: ClassroomGradeColumn) => void;
  onDeleted: (columnId: string) => void;
}) {
  const [source, setSource] = useState<"assessment" | "manual">(column?.source ?? (availableAssessments.length ? "assessment" : "manual"));
  const [assignmentId, setAssignmentId] = useState(column?.assignmentId ?? availableAssessments[0]?.id ?? "");
  const [weekLabel, setWeekLabel] = useState(column?.weekLabel ?? defaultWeek);
  const selectedAssessment = availableAssessments.find((assessment) => assessment.id === assignmentId);
  const initialAssessmentDate = selectedAssessment?.dueAt?.slice(0, 10) ?? todayKey();
  const [assessmentDate, setAssessmentDate] = useState(column?.assessmentDate ?? initialAssessmentDate);
  const [title, setTitle] = useState(column?.title ?? "");
  const [maxScore, setMaxScore] = useState(String(column?.maxScore ?? 100));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const url = column ? `/api/classes/${classId}/grade-columns/${column.id}` : `/api/classes/${classId}/grade-columns`;
      const response = await fetch(url, {
        method: column ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(column ? { weekLabel, assessmentDate, title, maxScore: Number(maxScore) } : { source, assignmentId, weekLabel, assessmentDate, title, maxScore: Number(maxScore) }),
      });
      const result = await response.json() as { column?: Partial<ClassroomGradeColumn>; error?: string };
      if (!response.ok || !result.column) throw new Error(result.error || "The column could not be saved.");
      onSaved(column ? { ...column, ...result.column } : result.column as ClassroomGradeColumn);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "The column could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteColumn() {
    if (!column || !window.confirm(`Delete the entire “${column.title}” column and all of its manual grades?`)) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/classes/${classId}/grade-columns/${column.id}`, { method: "DELETE" });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "The column could not be deleted.");
      onDeleted(column.id);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "The column could not be deleted.");
      setBusy(false);
    }
  }

  return <div className={styles.dialogBackdrop} role="presentation"><section aria-modal="true" className={styles.columnDialog} role="dialog">
    <button aria-label="Close test column editor" className={styles.dialogClose} disabled={busy} onClick={onClose} type="button">×</button>
    <p className={styles.dialogEyebrow}>{column ? "Edit grade column" : "Add to class manager"}</p>
    <h2>{column ? column.title : "Add a test column"}</h2>
    <p>Tests are placed inside a learning topic and sorted by date.</p>
    <form className={styles.columnForm} onSubmit={submit}>
      {!column ? <fieldset><legend>Grade source</legend><label><input checked={source === "assessment"} disabled={!availableAssessments.length} name="grade-source" onChange={() => setSource("assessment")} type="radio" /> Existing assessment</label><label><input checked={source === "manual"} name="grade-source" onChange={() => setSource("manual")} type="radio" /> Fresh manual test</label></fieldset> : <div className={styles.sourceNotice}><strong>{column.source === "assessment" ? "Automatic assessment" : "Manual test"}</strong><span>{column.source === "assessment" ? "Scores come from submitted attempts and stay read-only." : "Every student grade can be edited directly in the table."}</span></div>}
      {!column && source === "assessment" ? <label>Assessment<select required value={assignmentId} onChange={(event) => { const nextId = event.target.value; setAssignmentId(nextId); const dueAt = availableAssessments.find((assessment) => assessment.id === nextId)?.dueAt; if (dueAt) setAssessmentDate(dueAt.slice(0, 10)); }}><option disabled value="">Choose an assessment</option>{availableAssessments.map((assessment) => <option key={assessment.id} value={assessment.id}>{assessment.title} · {assessment.kind}</option>)}</select></label> : null}
      {(column?.source === "manual" || (!column && source === "manual")) ? <div className={styles.formPair}><label>Test name<input maxLength={120} onChange={(event) => setTitle(event.target.value)} placeholder="Arithmetic test" required value={title} /></label><label>Maximum score<input min="0.01" onChange={(event) => setMaxScore(event.target.value)} required step="any" type="number" value={maxScore} /></label></div> : null}
      <div className={styles.formPair}><label>Topic<select onChange={(event) => setWeekLabel(event.target.value)} required value={weekLabel}>{weeks.map((week) => <option key={week.id} value={week.label}>{week.title || week.label}{week.focus ? ` · ${week.focus}` : ""}</option>)}</select></label><label>Test date<input onChange={(event) => setAssessmentDate(event.target.value)} required type="date" value={assessmentDate} /></label></div>
      {message ? <p className={styles.formError} role="alert">{message}</p> : null}
      <div className={styles.dialogActions}>{column ? <button className={styles.deleteColumnButton} disabled={busy} onClick={deleteColumn} type="button">Delete whole column</button> : <span />}<button disabled={busy || (!column && source === "assessment" && !assignmentId)} type="submit">{busy ? "Saving…" : column ? "Save column" : "Add test"}</button></div>
    </form>
  </section></div>;
}

export function ManualGradeCell({ classId, studentId, studentName, column, onSaved }: {
  classId: string;
  studentId: string;
  studentName: string;
  column: ClassroomGradeColumn;
  onSaved: (grade: ClassroomGrade | null) => void;
}) {
  const grade = column.scores[studentId];
  const [value, setValue] = useState(grade ? String(grade.score) : "");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function save(nextValue = value) {
    if (!dirty && nextValue === value) return;
    const score = nextValue.trim() === "" ? null : Number(nextValue);
    if (score !== null && (!Number.isFinite(score) || score < 0 || score > Number(column.maxScore))) {
      setError(`Use 0–${column.maxScore}`);
      return;
    }
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/classes/${classId}/grade-columns/${column.id}/grades/${studentId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ score }) });
      const result = await response.json() as { grade?: ClassroomGrade | null; error?: string };
      if (!response.ok) throw new Error(result.error || "Grade was not saved.");
      setDirty(false);
      onSaved(result.grade ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Not saved");
    } finally {
      setSaving(false);
    }
  }

  return <td className={`${styles.assessmentCell} ${styles.manualGradeCell}`}>
    <div><input aria-label={`${column.title} grade for ${studentName}`} disabled={saving} max={column.maxScore ?? undefined} min="0" onBlur={() => void save()} onChange={(event) => { setValue(event.target.value); setDirty(true); setError(""); }} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") { setValue(grade ? String(grade.score) : ""); setDirty(false); event.currentTarget.blur(); } }} placeholder="—" step="any" type="number" value={value} /><span>/ {column.maxScore}</span>{grade ? <button aria-label={`Clear ${column.title} grade for ${studentName}`} disabled={saving} onMouseDown={(event) => event.preventDefault()} onClick={() => { setValue(""); setDirty(true); void save(""); }} type="button">×</button> : null}</div>
    <small className={error ? styles.gradeError : ""}>{error || (saving ? "Saving…" : dirty ? "Press Enter" : grade ? `${grade.percent}%` : "Enter grade")}</small>
  </td>;
}

export function WorkColumnDialog({ classId, item, onClose, onSaved, onDeleted }: {
  classId: string;
  item: ClassroomWorkItem;
  onClose: () => void;
  onSaved: (item: ClassroomWorkItem) => void;
  onDeleted: (itemId: string) => void;
}) {
  const [title, setTitle] = useState(item.title);
  const [activityDate, setActivityDate] = useState(item.activityDate ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const code = `${item.kind === "homework" ? "HW" : "CW"}${item.position}`;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/classes/${classId}/work-items/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, activityDate: activityDate || null }) });
      const result = await response.json() as { item?: { title: string; activityDate: string | null }; error?: string };
      if (!response.ok || !result.item) throw new Error(result.error || "The column could not be saved.");
      onSaved({ ...item, title: result.item.title, activityDate: result.item.activityDate });
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "The column could not be saved.");
      setBusy(false);
    }
  }

  async function deleteColumn() {
    if (!window.confirm(`Delete the entire “${item.title}” ${code} column and every student status in it?`)) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/classes/${classId}/work-items/${item.id}`, { method: "DELETE" });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "The column could not be deleted.");
      onDeleted(item.id);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "The column could not be deleted.");
      setBusy(false);
    }
  }

  return <div className={styles.dialogBackdrop} role="presentation"><section aria-modal="true" className={styles.columnDialog} role="dialog">
    <button aria-label="Close homework or classwork editor" className={styles.dialogClose} disabled={busy} onClick={onClose} type="button">×</button>
    <p className={styles.dialogEyebrow}>{item.weekLabel} · {code}</p>
    <h2>Edit {item.kind === "homework" ? "homework" : "classwork"} column</h2>
    <p>The name and date appear in the table header for every student.</p>
    <form className={styles.columnForm} onSubmit={submit}>
      <label>Column name<input autoFocus maxLength={120} onChange={(event) => setTitle(event.target.value)} required value={title} /></label>
      <label>Date<input onChange={(event) => setActivityDate(event.target.value)} type="date" value={activityDate} /></label>
      {message ? <p className={styles.formError} role="alert">{message}</p> : null}
      <div className={styles.dialogActions}><button className={styles.deleteColumnButton} disabled={busy} onClick={deleteColumn} type="button">Delete whole column</button><button disabled={busy || !title.trim()} type="submit">{busy ? "Saving…" : "Save column"}</button></div>
    </form>
  </section></div>;
}
