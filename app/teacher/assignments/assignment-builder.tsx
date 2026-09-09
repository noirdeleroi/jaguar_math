"use client";

import { useActionState, useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import DueDateInput from "@/app/components/due-date-input";
import MathText from "@/app/components/math-text";
import type { ImportedAssessment, ImportedQuestion } from "@/lib/assignment-import";
import { assignmentImportExample, parseAssignmentImport } from "@/lib/assignment-import";
import { createAssignment, type DraftActionState } from "../assignment-actions";
import AssessmentPolicySettings, { type AssignmentKind } from "./assessment-policy-settings";

type Classroom = { id: string; name: string; grade_level: number; academic_year: string };
type ImportMode = "single" | "versions";
const MAX_IMPORT_FILE_BYTES = 2 * 1024 * 1024;

export default function AssignmentBuilder({ classes }: { classes: Classroom[] }) {
  const [source, setSource] = useState(assignmentImportExample);
  const [importMode, setImportMode] = useState<ImportMode>("single");
  const [versionSources, setVersionSources] = useState(["", "", ""]);
  const [activeVersion, setActiveVersion] = useState(0);
  const [assessment, setAssessment] = useState<ImportedAssessment | null>(null);
  const questions = assessment?.questions ?? null;
  const [errors, setErrors] = useState<string[]>([]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [titleError, setTitleError] = useState("");
  const [questionsError, setQuestionsError] = useState("");
  const [formError, setFormError] = useState("");
  const [kind, setKind] = useState<AssignmentKind>("quiz");
  const [importFileName, setImportFileName] = useState("");
  const [saveState, saveAction] = useActionState<DraftActionState, FormData>(createAssignment, null);

  const validateAndPreview = (nextSource: string) => {
    const result = parseAssignmentImport(nextSource);
    setErrors(result.errors);
    setAssessment(result.data ?? null);
    setQuestionsError(result.data ? "" : "Fix the import errors, then click Validate & preview again.");
    setPreviewOpen(Boolean(result.data));
    return Boolean(result.data);
  };
  const clearValidatedImport = () => { setAssessment(null); setPreviewOpen(false); setQuestionsError(""); setImportFileName(""); setErrors([]); };
  const parse = () => {
    if (importMode === "single") { validateAndPreview(source); return; }
    const pasted = versionSources.map((value) => value.trim());
    if (!pasted[0] || !pasted[1]) {
      setErrors(["Paste complete JSON into Version 1 and Version 2. Version 3 is optional."]);
      setAssessment(null); setPreviewOpen(false);
      return;
    }
    if (!pasted[2] && versionSources[2]) setVersionSources((current) => [current[0], current[1], ""]);
    const count = pasted[2] ? 3 : 2;
    const parsedVersions: unknown[] = [];
    const parseErrors: string[] = [];
    pasted.slice(0, count).forEach((value, index) => {
      try { parsedVersions.push(JSON.parse(value.replace(/^\uFEFF/, ""))); }
      catch { parseErrors.push(`Version ${index + 1} is not valid JSON.`); }
    });
    if (parseErrors.length) { setErrors(parseErrors); setAssessment(null); setPreviewOpen(false); return; }
    const combined = JSON.stringify({ versions: parsedVersions }, null, 2);
    setSource(combined);
    validateAndPreview(combined);
  };
  const chooseImportMode = (nextMode: ImportMode) => {
    if (nextMode === importMode) return;
    setImportMode(nextMode); clearValidatedImport();
    if (nextMode === "versions") {
      setVersionSources((current) => current.some((value) => value.trim()) ? current : [source, "", ""]);
      setActiveVersion(0);
    }
  };
  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const files = Array.from(input.files ?? []);
    if (!files.length) return;
    input.value = "";
    setImportFileName("");
    setAssessment(null);
    setPreviewOpen(false);
    setQuestionsError("");
    if (files.length > 3) {
      setErrors(["Choose no more than three JSON files."]);
      return;
    }
    if (files.some((file) => !file.name.toLowerCase().endsWith(".json"))) {
      setErrors(["Every selected file must use the .json extension."]);
      return;
    }
    if (files.some((file) => file.size > MAX_IMPORT_FILE_BYTES)) {
      setErrors(["Each JSON file must be 2 MB or smaller."]);
      return;
    }
    try {
      const sources = await Promise.all(files.map((file) => file.text().then((value) => value.replace(/^\uFEFF/, ""))));
      const nextSource = files.length === 1 ? sources[0] : JSON.stringify({ versions: sources.map((value) => JSON.parse(value)) }, null, 2);
      setImportMode(files.length === 1 ? "single" : "versions");
      if (files.length > 1) { setVersionSources([sources[0], sources[1], sources[2] ?? ""]); setActiveVersion(0); }
      setSource(nextSource);
      setImportFileName(files.map((file) => file.name).join(", "));
      validateAndPreview(nextSource);
    } catch {
      setErrors(["One of the selected files could not be read as valid JSON."]);
    }
  };
  const updateQuestion = (groupIndex: number, variantIndex: number, patch: Partial<ImportedQuestion>) => setAssessment((current) => {
    if (!current) return null;
    const questionGroups = current.question_groups.map((group, currentGroup) => currentGroup === groupIndex ? group.map((question, currentVariant) => currentVariant === variantIndex ? { ...question, ...patch } : question) : group);
    return { ...current, question_groups: questionGroups, questions: questionGroups.map((group) => group[0]) };
  });
  const validateBeforeSave = (event: FormEvent<HTMLFormElement>) => {
    setTitleError(""); setQuestionsError(""); setFormError("");
    if (!title.trim()) { event.preventDefault(); setTitleError("Enter an assignment title."); return; }
    if (!assessment) { event.preventDefault(); setQuestionsError(errors.length ? "Fix the import errors, then click Validate & preview." : "Click Validate & preview before saving the draft."); return; }
    if (assessment.version_count > 1 && kind !== "test") { event.preventDefault(); setQuestionsError("Choose Test under Assignment settings to use multiple question versions."); return; }
    if (!classes.length) { event.preventDefault(); setFormError("Create a class before saving an assignment."); }
  };

  return <main className="teacher-main assessment-page"><Link className="back-link" href="/teacher/assignments">← Assignments</Link><section className="page-heading"><p className="eyebrow">Assessment workspace</p><h1>New assignment</h1><p>Import structured questions, review them, and save a private draft.</p><Link className="back-link" href="/teacher/questions">Reuse questions from your personal bank →</Link></section>
    <form className="assessment-form" action={saveAction} onSubmit={validateBeforeSave}>
      <section className="teacher-section"><h2>Assignment settings</h2><div className="assessment-fields"><label>Title<input aria-describedby={titleError ? "assignment-title-error" : undefined} name="title" onChange={(event) => { setTitle(event.target.value); setTitleError(""); }} placeholder="e.g. Linear equations check-in" value={title} />{titleError && <span className="inline-error" id="assignment-title-error" role="alert">{titleError}</span>}</label><DueDateInput dueAt={null} /></div><label className="wide-field">Description<textarea name="description" placeholder="Optional instructions for students." rows={3} /></label><AssessmentPolicySettings onKindChange={(nextKind) => { setKind(nextKind); if (nextKind === "test") setQuestionsError(""); }} /></section>
      <section className="teacher-section"><h2>Assign to classes</h2>{classes.length ? <div className="class-checklist">{classes.map((classroom) => <label key={classroom.id}><input name="class_ids" type="checkbox" value={classroom.id} /> <span>{classroom.name} · Grade {classroom.grade_level} · {classroom.academic_year}</span></label>)}</div> : <p className="form-note">Create a class before creating an assignment.</p>}</section>
      <section className="teacher-section"><div className="section-row"><div><h2>Question import</h2><p className="form-note">Paste one JSON for homework or quiz. For a <strong>Test</strong>, paste or upload two or three complete JSONs: matching question positions become variants and the server chooses one independently for each student and question.</p></div><div className="assignment-import-actions"><label className="secondary-inline-button import-file-button">Choose 1–3 JSON files<input accept=".json,application/json" className="import-file-input" multiple onChange={importFile} type="file" /></label><button className="secondary-inline-button" onClick={parse} type="button">Validate & preview</button></div></div><div aria-label="JSON paste format" className="import-mode-picker"><button aria-pressed={importMode === "single"} className={importMode === "single" ? "active" : ""} onClick={() => chooseImportMode("single")} type="button">Paste one JSON</button><button aria-pressed={importMode === "versions"} className={importMode === "versions" ? "active" : ""} onClick={() => chooseImportMode("versions")} type="button">Paste 2–3 test JSONs</button></div>{importFileName && <p aria-live="polite" className={`import-file-status${questions ? "" : " has-error"}`}><span aria-hidden="true">{questions ? "✓" : "!"}</span> Loaded <strong>{importFileName}</strong>. {assessment ? `${assessment.questions.length} question slot${assessment.questions.length === 1 ? "" : "s"} × ${assessment.version_count} version${assessment.version_count === 1 ? "" : "s"} ready to review.` : "Review the import errors below."}</p>}{importMode === "single" ? <textarea aria-label="Question import JSON" className="import-textarea" onChange={(event) => { setSource(event.target.value); clearValidatedImport(); }} rows={18} value={source} /> : <section aria-labelledby={`paste-version-${activeVersion + 1}`} className="version-paste-panel"><nav aria-label="Test JSON versions" className="version-paste-tabs">{versionSources.map((value, index) => <button aria-current={activeVersion === index ? "page" : undefined} className={activeVersion === index ? "active" : ""} key={index} onClick={() => setActiveVersion(index)} type="button"><span>Version {index + 1}{index === 2 ? " (optional)" : ""}</span><small>{value.trim() ? "JSON pasted ✓" : "Empty"}</small></button>)}</nav><label id={`paste-version-${activeVersion + 1}`}>Version {activeVersion + 1} complete JSON{activeVersion === 2 ? " (optional)" : ""}<textarea aria-label={`Version ${activeVersion + 1} JSON`} autoFocus className="import-textarea" onChange={(event) => { const value = event.target.value; setVersionSources((current) => current.map((item, index) => index === activeVersion ? value : item)); clearValidatedImport(); }} placeholder={`Paste the complete JSON for test version ${activeVersion + 1} here`} rows={18} value={versionSources[activeVersion]} /></label><p className="form-note">Version 1 and 2 are required. Version 3 is optional. Each JSON may be a normal <code>{`{"questions":[...]}`}</code> object.</p></section>}{errors.length > 0 && <ul className="import-errors" role="alert">{errors.map((error) => <li key={error}>{error}</li>)}</ul>}{questionsError && <p className="notice notice-error" role="alert">{questionsError}</p>}</section>
      {assessment && <><input name="questions_json" type="hidden" value={JSON.stringify({ question_groups: assessment.question_groups })} /><section className="teacher-section validated-summary"><div><p className="eyebrow">Import ready</p><h2>{assessment.questions.length} question slot{assessment.questions.length === 1 ? "" : "s"} · {assessment.version_count} version{assessment.version_count === 1 ? "" : "s"}</h2><p className="form-note">Review every version and its student-facing presentation before saving.{assessment.version_count > 1 && kind !== "test" ? " Select Test above before saving this versioned import." : ""}</p></div><button className="teacher-button" onClick={() => setPreviewOpen(true)} type="button">Review all versions <span aria-hidden="true">→</span></button></section>{previewOpen && <ValidatedQuestionsModal groups={assessment.question_groups} onClose={() => setPreviewOpen(false)} onUpdate={updateQuestion} />}</>}
      {(formError || saveState?.error) && <p className="notice notice-error" role="alert">{formError || saveState?.error}</p>}
      <SaveDraftButton disabled={!classes.length} />
    </form>
  </main>;
}

function ValidatedQuestionsModal({ groups, onUpdate, onClose }: { groups: ImportedQuestion[][]; onUpdate: (groupIndex: number, variantIndex: number, patch: Partial<ImportedQuestion>) => void; onClose: () => void }) {
  const [selected, setSelected] = useState(0);
  const [variant, setVariant] = useState(0);
  const questions = groups.map((group) => group[0]);
  const question = groups[selected][variant];
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);
  const updateOption = (optionIndex: number, text: string) => onUpdate(selected, variant, { options: question.options?.map((option, index) => index === optionIndex ? { ...option, text } : option) ?? null });
  const updateSkills = (value: string) => onUpdate(selected, variant, { skills: value.split(",").map((code, index) => ({ code: code.trim(), weight: 1, is_primary: index === 0 })) });
  const selectQuestion = (index: number) => { setSelected(index); setVariant(0); };
  return <div aria-labelledby="validated-questions-title" aria-modal="true" className="validated-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }} role="dialog"><section className="validated-modal"><header className="validated-modal-header"><div><p className="eyebrow">Assignment review</p><h2 id="validated-questions-title">Validated question versions</h2><p>Edit each variant and compare it with the student view. The server gives each student one variant per question slot.</p></div><button aria-label="Close validated questions review" autoFocus className="validated-modal-close" onClick={onClose} type="button">×</button></header><div className="validated-modal-body"><aside className="validated-question-nav" aria-label="Validated questions">{questions.map((item, index) => <button aria-current={index === selected ? "step" : undefined} className={index === selected ? "active" : ""} key={`${item.prompt}-${index}`} onClick={() => selectQuestion(index)} type="button"><span>{index + 1}</span><strong>{item.type.replaceAll("_", " ")}</strong><small>{item.points} {item.points === 1 ? "point" : "points"} · {groups[index].length} version{groups[index].length === 1 ? "" : "s"}</small></button>)}</aside><div className="validated-question-workspace">{groups[selected].length > 1 && <nav aria-label={`Versions for question ${selected + 1}`} className="question-version-switcher">{groups[selected].map((_, index) => <button aria-current={index === variant ? "page" : undefined} className={index === variant ? "active" : ""} key={index} onClick={() => setVariant(index)} type="button">Version {index + 1}</button>)}</nav>}<section className="question-source-pane"><div className="pane-heading"><span>Editable source · Version {variant + 1}</span><small>LaTeX and answer key</small></div><label>Prompt source (LaTeX)<textarea onChange={(event) => onUpdate(selected, variant, { prompt: event.target.value })} rows={5} value={question.prompt} /></label>{question.options && <fieldset className="source-options"><legend>Option source (LaTeX)</legend>{question.options.map((option, index) => <label key={option.id}><span>{option.id}</span><input onChange={(event) => updateOption(index, event.target.value)} value={option.text} /></label>)}</fieldset>}<div className="assessment-fields compact-fields"><label>Difficulty<input max="5" min="1" onChange={(event) => onUpdate(selected, variant, { difficulty: Number(event.target.value) })} type="number" value={question.difficulty} /></label><label>Points<input min="0.1" onChange={(event) => onUpdate(selected, variant, { points: Number(event.target.value) })} step="0.1" type="number" value={question.points} /></label><label>Correct answer<input onChange={(event) => onUpdate(selected, variant, { correct_answer: event.target.value })} value={question.correct_answer} /></label>{question.type === "numeric" && <label>Numeric tolerance<input min="0" onChange={(event) => onUpdate(selected, variant, { numeric_tolerance: Number(event.target.value) })} step="0.01" type="number" value={question.numeric_tolerance} /></label>}</div><label>Jaguar skills (comma-separated codes)<input onChange={(event) => updateSkills(event.target.value)} value={question.skills.map((skill) => skill.code).join(", ")} /></label><label>Explanation / solution source (LaTeX)<textarea onChange={(event) => onUpdate(selected, variant, { explanation: event.target.value || null })} rows={5} value={question.explanation ?? ""} /></label></section><section className="student-question-preview"><div className="pane-heading"><span>Student presentation · Version {variant + 1}</span><small>Teacher-only answer key shown below</small></div><article><div className="question-number">Question {selected + 1} · {question.points} {question.points === 1 ? "point" : "points"}</div><div className="question-prompt"><MathText>{question.prompt || "Add a question prompt."}</MathText></div>{question.type === "multiple_choice" ? <div className="answer-options">{question.options?.map((option) => <div key={option.id}><b>{option.id}</b><MathText>{option.text}</MathText></div>)}</div> : <label className="answer-text">Your answer<input disabled placeholder={question.type === "numeric" ? "Enter a number" : "Type your answer"} /></label>}<div className="teacher-answer-preview"><span>Correct answer</span><MathText>{question.correct_answer || "Not set"}</MathText></div>{question.explanation && <div className="teacher-solution-preview"><span>Solution</span><MathText>{question.explanation}</MathText></div>}</article></section></div></div><footer className="validated-modal-footer"><span>Question {selected + 1} of {questions.length} · Version {variant + 1} of {groups[selected].length}</span><div><button className="secondary-inline-button" disabled={selected === 0} onClick={() => selectQuestion(selected - 1)} type="button">← Previous</button><button className="teacher-button" disabled={selected === questions.length - 1} onClick={() => selectQuestion(selected + 1)} type="button">Next question →</button></div></footer></section></div>;
}

function SaveDraftButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return <button aria-live="polite" className="teacher-button" disabled={disabled || pending} type="submit">{pending ? "Saving..." : "Save draft"} <span aria-hidden="true">→</span></button>;
}
