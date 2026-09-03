"use client";

import { useActionState, useState, type FormEvent } from "react";
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
  const [source, setSource] = useState(assignmentImportExample);
  const [questions, setQuestions] = useState<ImportedQuestion[] | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [titleError, setTitleError] = useState("");
  const [questionsError, setQuestionsError] = useState("");
  const [formError, setFormError] = useState("");
  const [saveState, saveAction] = useActionState<DraftActionState, FormData>(createAssignment, null);

  const parse = () => {
    const result = parseAssignmentImport(source);
    setErrors(result.errors);
    setQuestions(result.data?.questions ?? null);
    setQuestionsError(result.data ? "" : "Fix the import errors, then click Validate & preview again.");
    setPreviewOpen(Boolean(result.data));
  };
  const updateQuestion = (index: number, patch: Partial<ImportedQuestion>) => setQuestions((current) => current?.map((question, questionIndex) => questionIndex === index ? { ...question, ...patch } : question) ?? null);
  const validateBeforeSave = (event: FormEvent<HTMLFormElement>) => {
    setTitleError(""); setQuestionsError(""); setFormError("");
    if (!title.trim()) { event.preventDefault(); setTitleError("Enter an assignment title."); return; }
    if (!questions) { event.preventDefault(); setQuestionsError(errors.length ? "Fix the import errors, then click Validate & preview." : "Click Validate & preview before saving the draft."); return; }
    if (!classes.length) { event.preventDefault(); setFormError("Create a class before saving an assignment."); }
  };

  return <main className="teacher-main assessment-page"><Link className="back-link" href="/teacher/assignments">← Assignments</Link><section className="page-heading"><p className="eyebrow">Assessment workspace</p><h1>New assignment</h1><p>Import structured questions, review them, and save a private draft.</p><Link className="back-link" href="/teacher/questions">Reuse questions from your personal bank →</Link></section>
    <form className="assessment-form" action={saveAction} onSubmit={validateBeforeSave}>
      <section className="teacher-section"><h2>Assignment settings</h2><div className="assessment-fields"><label>Title<input aria-describedby={titleError ? "assignment-title-error" : undefined} name="title" onChange={(event) => { setTitle(event.target.value); setTitleError(""); }} placeholder="e.g. Linear equations check-in" value={title} />{titleError && <span className="inline-error" id="assignment-title-error" role="alert">{titleError}</span>}</label><label>Type<select name="kind" defaultValue="quiz"><option value="homework">Homework</option><option value="quiz">Quiz</option><option value="test">Test</option></select></label><DueDateInput dueAt={null} /><label>Duration in minutes <input name="duration_minutes" min="1" type="number" /></label><label>Maximum attempts <input defaultValue="1" min="1" name="max_attempts" required type="number" /></label><label>Question display<select defaultValue="one_at_a_time" name="question_display_mode"><option value="one_at_a_time">One question at a time</option><option value="all_at_once">All questions on one page</option></select></label></div><label className="wide-field">Description<textarea name="description" placeholder="Optional instructions for students." rows={3} /></label><div className="assignment-toggles"><label><input defaultChecked name="show_score_after_submit" type="checkbox" /> Show score after submit</label><label><input name="show_answers_after_submit" type="checkbox" /> Show answer review after submit</label><label><input name="show_feedback_after_each_question" type="checkbox" /> Show correct or incorrect after each saved answer</label><label><input name="shuffle_questions" type="checkbox" /> Shuffle question order</label></div><ExamModeSettings /></section>
      <section className="teacher-section"><h2>Assign to classes</h2>{classes.length ? <div className="class-checklist">{classes.map((classroom) => <label key={classroom.id}><input name="class_ids" type="checkbox" value={classroom.id} /> <span>{classroom.name} · Grade {classroom.grade_level} · {classroom.academic_year}</span></label>)}</div> : <p className="form-note">Create a class before creating an assignment.</p>}</section>
      <section className="teacher-section"><div className="section-row"><div><h2>Question import</h2><p className="form-note">Paste the agreed ChatGPT JSON format. Math wrapped in <code>$...$</code> or <code>$$...$$</code> is rendered safely.</p></div><button className="secondary-inline-button" onClick={parse} type="button">Validate & preview</button></div><textarea aria-label="Question import JSON" className="import-textarea" onChange={(event) => { setSource(event.target.value); setQuestions(null); setPreviewOpen(false); setQuestionsError(""); }} rows={18} value={source} />{errors.length > 0 && <ul className="import-errors" role="alert">{errors.map((error) => <li key={error}>{error}</li>)}</ul>}{questionsError && <p className="notice notice-error" role="alert">{questionsError}</p>}</section>
      {questions && <><input name="questions_json" type="hidden" value={JSON.stringify(questions)} /><section className="teacher-section validated-summary"><div><p className="eyebrow">Import ready</p><h2>Validated questions</h2><p className="form-note">Review the editable source and the student-facing presentation before saving.</p></div><button className="teacher-button" onClick={() => setPreviewOpen(true)} type="button">Review {questions.length} question{questions.length === 1 ? "" : "s"} <span aria-hidden="true">→</span></button></section>{previewOpen && <ValidatedQuestionsModal onClose={() => setPreviewOpen(false)} onUpdate={updateQuestion} questions={questions} />}</>}
      {(formError || saveState?.error) && <p className="notice notice-error" role="alert">{formError || saveState?.error}</p>}
      <SaveDraftButton disabled={!classes.length} />
    </form>
  </main>;
}

function ValidatedQuestionsModal({ questions, onUpdate, onClose }: { questions: ImportedQuestion[]; onUpdate: (index: number, patch: Partial<ImportedQuestion>) => void; onClose: () => void }) {
  const [selected, setSelected] = useState(0);
  const question = questions[selected];
  const updateOption = (optionIndex: number, text: string) => onUpdate(selected, { options: question.options?.map((option, index) => index === optionIndex ? { ...option, text } : option) ?? null });
  const updateSkills = (value: string) => onUpdate(selected, { skills: value.split(",").map((code, index) => ({ code: code.trim(), weight: 1, is_primary: index === 0 })) });
  return <div aria-labelledby="validated-questions-title" aria-modal="true" className="validated-modal-backdrop" role="dialog"><section className="validated-modal"><header className="validated-modal-header"><div><p className="eyebrow">Assignment review</p><h2 id="validated-questions-title">Validated questions</h2><p>Source edits update the rendered student view instantly.</p></div><button aria-label="Close validated questions review" className="validated-modal-close" onClick={onClose} type="button">×</button></header><div className="validated-modal-body"><aside className="validated-question-nav" aria-label="Validated questions">{questions.map((item, index) => <button aria-current={index === selected ? "step" : undefined} className={index === selected ? "active" : ""} key={`${item.prompt}-${index}`} onClick={() => setSelected(index)} type="button"><span>{index + 1}</span><strong>{item.type.replaceAll("_", " ")}</strong><small>{item.points} {item.points === 1 ? "point" : "points"}</small></button>)}</aside><div className="validated-question-workspace"><section className="question-source-pane"><div className="pane-heading"><span>Editable source</span><small>LaTeX and answer key</small></div><label>Prompt source (LaTeX)<textarea onChange={(event) => onUpdate(selected, { prompt: event.target.value })} rows={5} value={question.prompt} /></label>{question.options && <fieldset className="source-options"><legend>Option source (LaTeX)</legend>{question.options.map((option, index) => <label key={option.id}><span>{option.id}</span><input onChange={(event) => updateOption(index, event.target.value)} value={option.text} /></label>)}</fieldset>}<div className="assessment-fields compact-fields"><label>Difficulty<input max="5" min="1" onChange={(event) => onUpdate(selected, { difficulty: Number(event.target.value) })} type="number" value={question.difficulty} /></label><label>Points<input min="0.1" onChange={(event) => onUpdate(selected, { points: Number(event.target.value) })} step="0.1" type="number" value={question.points} /></label><label>Correct answer<input onChange={(event) => onUpdate(selected, { correct_answer: event.target.value })} value={question.correct_answer} /></label>{question.type === "numeric" && <label>Numeric tolerance<input min="0" onChange={(event) => onUpdate(selected, { numeric_tolerance: Number(event.target.value) })} step="0.01" type="number" value={question.numeric_tolerance} /></label>}</div><label>Jaguar skills (comma-separated codes)<input onChange={(event) => updateSkills(event.target.value)} value={question.skills.map((skill) => skill.code).join(", ")} /></label><label>Explanation / solution source (LaTeX)<textarea onChange={(event) => onUpdate(selected, { explanation: event.target.value || null })} rows={5} value={question.explanation ?? ""} /></label></section><section className="student-question-preview"><div className="pane-heading"><span>Student presentation</span><small>Teacher-only answer key shown below</small></div><article><div className="question-number">Question {selected + 1} · {question.points} {question.points === 1 ? "point" : "points"}</div><div className="question-prompt"><MathText>{question.prompt || "Add a question prompt."}</MathText></div>{question.type === "multiple_choice" ? <div className="answer-options">{question.options?.map((option) => <div key={option.id}><b>{option.id}</b><MathText>{option.text}</MathText></div>)}</div> : <label className="answer-text">Your answer<input disabled placeholder={question.type === "numeric" ? "Enter a number" : "Type your answer"} /></label>}<div className="teacher-answer-preview"><span>Correct answer</span><MathText>{question.correct_answer || "Not set"}</MathText></div>{question.explanation && <div className="teacher-solution-preview"><span>Solution</span><MathText>{question.explanation}</MathText></div>}</article></section></div></div><footer className="validated-modal-footer"><span>Question {selected + 1} of {questions.length}</span><div><button className="secondary-inline-button" disabled={selected === 0} onClick={() => setSelected((current) => current - 1)} type="button">← Previous</button><button className="teacher-button" disabled={selected === questions.length - 1} onClick={() => setSelected((current) => current + 1)} type="button">Next question →</button></div></footer></section></div>;
}

function SaveDraftButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return <button aria-live="polite" className="teacher-button" disabled={disabled || pending} type="submit">{pending ? "Saving..." : "Save draft"} <span aria-hidden="true">→</span></button>;
}
