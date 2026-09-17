"use client";

import { useState } from "react";
import { FINAL_GRADE_COMMENT_MAX_LENGTH, normalizeFinalGradeOverride } from "@/lib/classroom-final-grade";
import type { AvailableClassroomAssessment, ClassroomFinalGradeOverride, ClassroomGrade, ClassroomGradeColumn, ClassroomWeek, ClassroomWorkItem } from "@/lib/classroom-stars";
import { clampTopicGrade, evaluateTopicFinalGradeFormula, normalizeOptionalTopicGradeFormula } from "@/lib/classroom-topic-grade";
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
  const [formula, setFormula] = useState(topic.finalGradeFormula ?? "");
  const [finalGradeMax, setFinalGradeMax] = useState(String(topic.finalGradeMax));
  const [summativeGradeColumnId, setSummativeGradeColumnId] = useState(topic.summativeGradeColumnId ?? "");
  const [makeCurrent, setMakeCurrent] = useState(topic.isCurrent);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  let preview = "";
  try {
    if (formula.trim()) preview = String(Math.round(clampTopicGrade(evaluateTopicFinalGradeFormula(formula, { N: 16, stars: 4, skulls: 2 }), Number(finalGradeMax)) * 100) / 100);
  } catch { /* The submit handler presents the precise validation message. */ }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    let normalizedFormula: string | null;
    try {
      normalizedFormula = normalizeOptionalTopicGradeFormula(formula);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Check the final-grade formula.");
      return;
    }
    const maximum = Number(finalGradeMax);
    if (!Number.isFinite(maximum) || maximum <= 0 || maximum > 100000) {
      setMessage("Enter a final-grade maximum between 0 and 100,000.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`/api/classes/${classId}/topics/${topic.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, finalGradeFormula: normalizedFormula, finalGradeMax: maximum, summativeGradeColumnId: summativeGradeColumnId || null, makeCurrent }),
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
    <p>Final grades are optional. Choose a summative test and enter a formula only when the topic is ready to be graded.</p>
    <form className={styles.columnForm} onSubmit={submit}>
      <label>Topic name<input autoFocus maxLength={120} onChange={(event) => setTitle(event.target.value)} required value={title} /></label>
      <label className={styles.currentTopicChoice}><input checked={makeCurrent} disabled={topic.isCurrent} onChange={(event) => setMakeCurrent(event.target.checked)} type="checkbox" /><span><strong>{topic.isCurrent ? "Current topic" : "Set as current topic"}</strong><small>{topic.isCurrent ? "This topic opens by default in the class manager." : "Make this the default open topic for this class."}</small></span></label>
      <label>Summative test (N)<select disabled={!gradeColumns.length} onChange={(event) => setSummativeGradeColumnId(event.target.value)} value={summativeGradeColumnId}><option value="">{gradeColumns.length ? "No summative test selected" : "Add a test column first"}</option>{gradeColumns.map((column) => <option key={column.id} value={column.id}>{column.title}{column.maxScore ? ` · out of ${column.maxScore}` : ""}</option>)}</select></label>
      <div className={styles.formPair}><label>Final-grade formula (optional)<input maxLength={120} onChange={(event) => setFormula(event.target.value)} placeholder="N + stars - skulls" value={formula} /></label><label>Maximum points<input max="100000" min="0.01" onChange={(event) => setFinalGradeMax(event.target.value)} required step="any" type="number" value={finalGradeMax} /></label></div>
      <div className={styles.formulaHelp}><code>N</code><span>summative points</span><code>stars</code><span>topic stars</span><code>skulls</code><span>cancel stars only (never lower N)</span></div>
      <p className={styles.formulaPreview}>{preview ? `Example: N 16 + 4 stars − 2 skulls = ${preview}. Results stay between 0 and ${finalGradeMax}.` : "Leave the formula empty to keep final grades off for this topic."}</p>
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

export function ManualGradeCell({ classId, studentId, studentName, column, className = "", onSaved }: {
  classId: string;
  studentId: string;
  studentName: string;
  column: ClassroomGradeColumn;
  className?: string;
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

  return <td className={`${styles.assessmentCell} ${styles.manualGradeCell} ${className}`}>
    <div><input aria-label={`${column.title} grade for ${studentName}`} disabled={saving} max={column.maxScore ?? undefined} min="0" onBlur={() => void save()} onChange={(event) => { setValue(event.target.value); setDirty(true); setError(""); }} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") { setValue(grade ? String(grade.score) : ""); setDirty(false); event.currentTarget.blur(); } }} placeholder="—" title="Absent" step="any" type="number" value={value} /><span>/ {column.maxScore}</span>{grade ? <button aria-label={`Clear ${column.title} grade for ${studentName}`} disabled={saving} onMouseDown={(event) => event.preventDefault()} onClick={() => { setValue(""); setDirty(true); void save(""); }} type="button">×</button> : null}</div>
    <small className={error ? styles.gradeError : ""}>{error || (saving ? "Saving…" : dirty ? "Press Enter" : grade ? `${grade.percent}%` : "—")}</small>
  </td>;
}

export function FinalGradeCell({ classId, topic, studentId, studentName, calculatedGrade, override, className = "", onSaved }: {
  classId: string;
  topic: ClassroomWeek;
  studentId: string;
  studentName: string;
  calculatedGrade: number | null;
  override: ClassroomFinalGradeOverride | null;
  className?: string;
  onSaved: (override: ClassroomFinalGradeOverride | null) => void;
}) {
  const visibleOverride = topic.finalGradeFormula ? override : null;
  const finalGrade = topic.finalGradeFormula ? visibleOverride?.score ?? calculatedGrade : null;
  const [editing, setEditing] = useState(false);
  const [score, setScore] = useState(finalGrade === null ? "" : String(finalGrade));
  const [comment, setComment] = useState(override?.comment ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const editable = Boolean(topic.finalGradeFormula);
  const commentTooltip = visibleOverride?.comment || "Manually changed grade (no comment)";

  function startEditing() {
    if (!editable || busy) return;
    setScore(finalGrade === null ? "" : String(finalGrade));
    setComment(visibleOverride?.comment ?? "");
    setError("");
    setEditing(true);
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    let normalized: ClassroomFinalGradeOverride;
    try {
      normalized = normalizeFinalGradeOverride(score, comment, topic.finalGradeMax);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Check the final grade.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/classes/${classId}/topics/${topic.id}/final-grades/${studentId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(normalized),
      });
      const result = await response.json() as { override?: ClassroomFinalGradeOverride; error?: string };
      if (!response.ok || !result.override) throw new Error(result.error || "The final grade was not saved.");
      onSaved(result.override);
      setEditing(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The final grade was not saved.");
    } finally {
      setBusy(false);
    }
  }

  async function restoreCalculatedGrade() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/classes/${classId}/topics/${topic.id}/final-grades/${studentId}`, { method: "DELETE" });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "The calculated grade was not restored.");
      onSaved(null);
      setEditing(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The calculated grade was not restored.");
    } finally {
      setBusy(false);
    }
  }

  if (editing) return <td className={`${styles.finalGradeCell} ${styles.finalGradeEditor} ${className}`}>
    <form onSubmit={save}>
      <label><span>Grade / {topic.finalGradeMax}</span><input autoFocus disabled={busy} max={topic.finalGradeMax} min="0" onChange={(event) => setScore(event.target.value)} required step="any" type="number" value={score} /></label>
      <label><span>Comment (optional)</span><input disabled={busy} maxLength={FINAL_GRADE_COMMENT_MAX_LENGTH} onChange={(event) => setComment(event.target.value)} placeholder="Reason for change" type="text" value={comment} /></label>
      {error ? <small className={styles.gradeError} role="alert">{error}</small> : null}
      <div><button disabled={busy} type="submit">{busy ? "Saving…" : "Save"}</button>{visibleOverride ? <button className={styles.restoreGradeButton} disabled={busy} onClick={() => void restoreCalculatedGrade()} type="button">Reset</button> : null}<button disabled={busy} onClick={() => setEditing(false)} type="button">Cancel</button></div>
    </form>
  </td>;

  return <td
    aria-label={`${topic.label} final grade for ${studentName}${visibleOverride ? ", manually changed" : ""}`}
    className={`${styles.finalGradeCell} ${editable ? styles.finalGradeEditable : ""} ${className}`}
    onDoubleClick={startEditing}
    onKeyDown={(event) => { if (editable && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); startEditing(); } }}
    tabIndex={editable ? 0 : undefined}
    title={visibleOverride ? commentTooltip : editable ? "Double-click to change this final grade" : "Configure the topic final grade first"}
  >
    {finalGrade === null ? <><strong>—</strong><small>{editable ? "Waiting · double-click to enter" : "Not configured"}</small></> : <><strong>{finalGrade} / {topic.finalGradeMax}{visibleOverride ? <sup aria-label={`Manually changed: ${commentTooltip}`} className={styles.finalGradeManualMarker} title={commentTooltip}>*</sup> : null}</strong><small>{finalGrade / topic.finalGradeMax >= 0.65 ? "Passed · 65%+" : "Below 65%"}{editable ? " · double-click to edit" : ""}</small></>}
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
