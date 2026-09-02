"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import DueDateInput from "@/app/components/due-date-input";
import MathText from "@/app/components/math-text";
import type { ImportedQuestion } from "@/lib/assignment-import";
import { assignmentImportExample, parseAssignmentImport } from "@/lib/assignment-import";
import { createAssignment, type DraftActionState } from "../assignment-actions";
import ExamModeSettings from "./exam-mode-settings";

type Classroom = { id: string; name: string; grade_level: number; academic_year: string };

export default function AssignmentBuilder({ classes }: { classes: Classroom[] }) {
  const [source, setSource] = useState(assignmentImportExample); const [questions, setQuestions] = useState<ImportedQuestion[] | null>(null); const [errors, setErrors] = useState<string[]>([]);
  const [saveState, saveAction] = useActionState<DraftActionState, FormData>(createAssignment, null);
  const parse = () => { const result = parseAssignmentImport(source); setErrors(result.errors); setQuestions(result.data?.questions ?? null); };
  const updateQuestion = (index: number, patch: Partial<ImportedQuestion>) => setQuestions((current) => current?.map((question, questionIndex) => questionIndex === index ? { ...question, ...patch } : question) ?? null);
  return <main className="teacher-main assessment-page"><Link className="back-link" href="/teacher/assignments">← Assignments</Link><section className="page-heading"><p className="eyebrow">Assessment workspace</p><h1>New assignment</h1><p>Import structured questions, review them, and save a private draft.</p><Link className="back-link" href="/teacher/questions">Reuse questions from your personal bank →</Link></section>
    <form className="assessment-form" action={saveAction}>
      <section className="teacher-section"><h2>Assignment settings</h2><div className="assessment-fields"><label>Title<input name="title" required placeholder="e.g. Linear equations check-in" /></label><label>Type<select name="kind" defaultValue="quiz"><option value="homework">Homework</option><option value="quiz">Quiz</option><option value="test">Test</option></select></label><DueDateInput dueAt={null} /><label>Duration in minutes <input name="duration_minutes" min="1" type="number" /></label><label>Maximum attempts <input defaultValue="1" min="1" name="max_attempts" required type="number" /></label></div><label className="wide-field">Description<textarea name="description" placeholder="Optional instructions for students." rows={3} /></label><div className="assignment-toggles"><label><input defaultChecked name="show_score_after_submit" type="checkbox" /> Show score after submit</label><label><input name="show_answers_after_submit" type="checkbox" /> Show answer review after submit</label><label><input name="shuffle_questions" type="checkbox" /> Shuffle question order</label></div><ExamModeSettings /></section>
      <section className="teacher-section"><h2>Assign to classes</h2>{classes.length ? <div className="class-checklist">{classes.map((classroom) => <label key={classroom.id}><input name="class_ids" type="checkbox" value={classroom.id} /> <span>{classroom.name} · Grade {classroom.grade_level} · {classroom.academic_year}</span></label>)}</div> : <p className="form-note">Create a class before creating an assignment.</p>}</section>
      <section className="teacher-section"><div className="section-row"><div><h2>Question import</h2><p className="form-note">Paste the agreed ChatGPT JSON format. Math wrapped in <code>$...$</code> or <code>$$...$$</code> is rendered safely.</p></div><button className="secondary-inline-button" onClick={parse} type="button">Validate & preview</button></div><textarea aria-label="Question import JSON" className="import-textarea" onChange={(event) => { setSource(event.target.value); setQuestions(null); }} rows={18} value={source} />{errors.length > 0 && <ul className="import-errors" role="alert">{errors.map((error) => <li key={error}>{error}</li>)}</ul>}</section>
      {questions && <section className="teacher-section question-preview"><div className="section-row"><div><h2>Validated questions</h2><p className="form-note">Make small edits here before saving. Re-validate imported JSON to replace the preview.</p></div><span className="muted-count">{questions.length} questions</span></div><input name="questions_json" type="hidden" value={JSON.stringify(questions)} />{questions.map((question, index) => <article className="question-editor" key={index}><p className="eyebrow">Question {index + 1} · {question.type.replace("_", " ")}</p><label>Prompt<textarea onChange={(event) => updateQuestion(index, { prompt: event.target.value })} rows={3} value={question.prompt} /></label><MathPreview label="Prompt preview" value={question.prompt} /><div className="assessment-fields compact-fields"><label>Difficulty<input max="5" min="1" onChange={(event) => updateQuestion(index, { difficulty: Number(event.target.value) })} type="number" value={question.difficulty} /></label><label>Points<input min="0.1" onChange={(event) => updateQuestion(index, { points: Number(event.target.value) })} step="0.1" type="number" value={question.points} /></label><label>Correct answer<input onChange={(event) => updateQuestion(index, { correct_answer: event.target.value })} value={question.correct_answer} /></label></div>{question.options && <div className="option-editor">{question.options.map((option, optionIndex) => <div className="option-edit-group" key={option.id}><label>{option.id}<input onChange={(event) => updateQuestion(index, { options: question.options?.map((item, itemIndex) => itemIndex === optionIndex ? { ...item, text: event.target.value } : item) ?? null })} value={option.text} /></label><MathPreview label={`${option.id} preview`} value={option.text} /></div>)}</div>}<label>Skills (comma-separated codes)<input onChange={(event) => updateQuestion(index, { skills: event.target.value.split(",").map((code, skillIndex) => ({ code: code.trim(), weight: 1, is_primary: skillIndex === 0 })) })} value={question.skills.map((skill) => skill.code).join(", ")} /></label><label>Explanation (teacher key / optional answer review)<textarea onChange={(event) => updateQuestion(index, { explanation: event.target.value || null })} rows={2} value={question.explanation ?? ""} /></label><MathPreview label="Explanation preview" value={question.explanation ?? ""} /></article>)}</section>}
      {saveState?.error && <p className="notice notice-error" role="alert">{saveState.error}</p>}
      <SaveDraftButton disabled={!questions || !classes.length} />
    </form>
  </main>;
}

function MathPreview({ label, value }: { label: string; value: string }) {
  return <div className="math-preview"><span>{label}</span><div><MathText>{value || "No content."}</MathText></div></div>;
}

function SaveDraftButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return <button aria-live="polite" className="teacher-button" disabled={disabled || pending} type="submit">{pending ? "Saving draft..." : "Save draft"} <span aria-hidden="true">→</span></button>;
}
