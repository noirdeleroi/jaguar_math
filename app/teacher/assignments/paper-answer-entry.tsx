"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { loadOwnedPaperAnswerEntry, saveOwnedPaperAnswers, type PaperAnswerEntrySheet } from "../assignment-actions";
import styles from "./paper-answer-entry.module.css";

type StudentOption = {
  studentId: string;
  name: string;
  status: "submitted" | "in_progress" | "not_started";
  answeredCount: number;
  totalQuestions: number;
};

export default function PaperAnswerEntry({ assignmentId, initialStudentId, students, onClose }: { assignmentId: string; initialStudentId: string; students: StudentOption[]; onClose: () => void }) {
  const router = useRouter();
  const [studentId, setStudentId] = useState(initialStudentId);
  const [sheet, setSheet] = useState<PaperAnswerEntrySheet | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [savedAnswers, setSavedAnswers] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
  const [pendingLabel, setPendingLabel] = useState<"loading" | "saving" | "submitting" | null>("loading");
  const [isPending, startTransition] = useTransition();
  const panelRef = useRef<HTMLElement | null>(null);
  const requestIdRef = useRef(0);
  const currentStudent = students.find((student) => student.studentId === studentId) ?? students[0];
  const currentIndex = students.findIndex((student) => student.studentId === studentId);
  const dirty = sheet !== null && sheet.questions.some((question) => (answers[question.id] ?? "") !== (savedAnswers[question.id] ?? ""));
  const answeredCount = sheet?.questions.filter((question) => Boolean((answers[question.id] ?? "").trim())).length ?? 0;

  const loadStudent = useCallback((nextStudentId: string) => {
    const requestId = ++requestIdRef.current;
    setStudentId(nextStudentId); setSheet(null); setAnswers({}); setSavedAnswers({}); setNotice(""); setPendingLabel("loading");
    startTransition(async () => {
      const result = await loadOwnedPaperAnswerEntry(assignmentId, nextStudentId);
      if (requestId !== requestIdRef.current) return;
      if ("error" in result) { setNotice(result.error); setPendingLabel(null); return; }
      const nextAnswers = Object.fromEntries(result.sheet.questions.map((question) => [question.id, question.answer]));
      setSheet(result.sheet); setAnswers(nextAnswers); setSavedAnswers(nextAnswers); setPendingLabel(null);
      window.setTimeout(() => panelRef.current?.querySelector<HTMLElement>("[data-answer-field]")?.focus(), 50);
    });
  }, [assignmentId]);

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    let cancelled = false;
    void loadOwnedPaperAnswerEntry(assignmentId, initialStudentId).then((result) => {
      if (cancelled || requestId !== requestIdRef.current) return;
      if ("error" in result) { setNotice(result.error); setPendingLabel(null); return; }
      const nextAnswers = Object.fromEntries(result.sheet.questions.map((question) => [question.id, question.answer]));
      setSheet(result.sheet); setAnswers(nextAnswers); setSavedAnswers(nextAnswers); setPendingLabel(null);
      window.setTimeout(() => panelRef.current?.querySelector<HTMLElement>("[data-answer-field]")?.focus(), 50);
    });
    return () => { cancelled = true; };
  }, [assignmentId, initialStudentId]);

  const requestClose = useCallback(() => {
    if (dirty && !window.confirm("Close without saving these answer changes?")) return;
    onClose();
  }, [dirty, onClose]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") requestClose(); };
    document.body.style.overflow = "hidden"; window.addEventListener("keydown", onKeyDown);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", onKeyDown); };
  }, [requestClose]);

  const moveToStudent = (offset: number) => {
    const target = students[currentIndex + offset];
    if (!target) return;
    if (dirty && !window.confirm(`Switch students without saving ${currentStudent?.name ?? "this student"}'s changes?`)) return;
    loadStudent(target.studentId);
  };

  const chooseStudent = (nextStudentId: string) => {
    if (nextStudentId === studentId) return;
    if (dirty && !window.confirm(`Switch students without saving ${currentStudent?.name ?? "this student"}'s changes?`)) return;
    loadStudent(nextStudentId);
  };

  const setAnswer = (questionId: string, answer: string) => {
    setAnswers((current) => ({ ...current, [questionId]: answer })); setNotice("");
  };

  const save = (submit: boolean) => {
    if (!sheet || isPending) return;
    setNotice(""); setPendingLabel(submit ? "submitting" : "saving");
    startTransition(async () => {
      const responses = sheet.questions.map((question) => ({ questionId: question.id, answer: answers[question.id] ?? "" }));
      const result = await saveOwnedPaperAnswers(assignmentId, studentId, responses, submit);
      if ("error" in result) { setNotice(result.error); setPendingLabel(null); return; }
      setSavedAnswers({ ...answers }); setSheet((current) => current ? { ...current, status: result.status } : current); setPendingLabel(null);
      setNotice(result.status === "submitted" ? `Saved and scored${result.score !== null && result.maxScore !== null ? ` · ${result.score}/${result.maxScore} points` : ""}.` : "All answers saved. You can continue with the next student.");
      router.refresh();
    });
  };

  const version = sheet?.formCode.replace(/^Version\s+/i, "") ?? "—";
  const progress = sheet?.questions.length ? Math.round(100 * answeredCount / sheet.questions.length) : 0;
  const studentProgress = useMemo(() => currentStudent ? `${currentStudent.answeredCount}/${currentStudent.totalQuestions}` : "0/0", [currentStudent]);

  return <div aria-labelledby="paper-answer-entry-title" aria-modal="true" className={styles.backdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) requestClose(); }} role="dialog">
    <section className={styles.panel} ref={panelRef}>
      <header className={styles.header}>
        <div><p className="eyebrow">Teacher answer entry</p><h2 id="paper-answer-entry-title">Enter the printed answer sheet</h2><p>Choose the student, copy answers straight down, then save or score.</p></div>
        <button aria-label="Close answer entry" className={styles.close} onClick={requestClose} type="button">×</button>
      </header>
      <div className={styles.studentBar}>
        <button aria-label="Previous student" disabled={currentIndex <= 0 || pendingLabel === "loading"} onClick={() => moveToStudent(-1)} type="button">←</button>
        <label><span>Student</span><select disabled={pendingLabel === "loading"} onChange={(event) => chooseStudent(event.target.value)} value={studentId}>{students.map((student) => <option key={student.studentId} value={student.studentId}>{student.name} · {student.status === "not_started" ? "not started" : student.status.replace("_", " ")}</option>)}</select></label>
        <button aria-label="Next student" disabled={currentIndex < 0 || currentIndex >= students.length - 1 || pendingLabel === "loading"} onClick={() => moveToStudent(1)} type="button">→</button>
        <div className={styles.studentMeta}><span>Paper version</span><strong>{version}</strong></div>
        <div className={styles.studentMeta}><span>Before opening</span><strong>{studentProgress} saved</strong></div>
      </div>

      {pendingLabel === "loading" || !sheet ? <div className={styles.loading}><span aria-hidden="true" /><strong>{notice || `Opening ${currentStudent?.name ?? "student"}'s answer sheet…`}</strong>{notice && <button onClick={() => loadStudent(studentId)} type="button">Try again</button>}</div> : <>
        <div className={styles.progress}><div><strong>{answeredCount} of {sheet.questions.length} answered</strong><span>{sheet.status === "submitted" ? "Submitted · changes will be rescored" : "Draft · not scored yet"}</span></div><i><b style={{ width: `${progress}%` }} /></i></div>
        <div className={styles.answerGrid}>{sheet.questions.map((question, index) => {
          const value = answers[question.id] ?? ""; const answered = Boolean(value.trim());
          return <article className={`${styles.answerCard}${answered ? ` ${styles.answered}` : ""}`} key={question.id}>
            <div className={styles.questionNumber}><span>{question.number}</span>{answered && <button aria-label={`Clear answer ${question.number}`} onClick={() => setAnswer(question.id, "")} type="button">Clear</button>}</div>
            {question.type === "multiple_choice" ? <div aria-label={`Question ${question.number} choices`} className={styles.choices}>{question.optionIds.map((optionId, optionIndex) => <button aria-pressed={value === optionId} data-answer-field={optionIndex === 0 ? "true" : undefined} key={optionId} onClick={() => setAnswer(question.id, optionId)} type="button">{String.fromCharCode(65 + optionIndex)}</button>)}</div> : <input aria-label={`Answer for question ${question.number}`} data-answer-field="true" inputMode={question.type === "numeric" ? "decimal" : undefined} onChange={(event) => setAnswer(question.id, event.target.value)} onKeyDown={(event) => { if (event.key !== "Enter") return; event.preventDefault(); const fields = Array.from(panelRef.current?.querySelectorAll<HTMLElement>("[data-answer-field]") ?? []); fields[fields.indexOf(event.currentTarget) + 1]?.focus(); }} placeholder={question.type === "numeric" ? "Number" : "Answer"} value={value} />}
            <small>{index + 1 === sheet.questions.length ? "Last answer" : `Next: ${question.number + 1}`}</small>
          </article>;
        })}</div>
      </>}

      <footer className={styles.footer}>
        <div aria-live="polite"><strong>{dirty ? "Unsaved changes" : notice || "Ready"}</strong><span>{dirty ? "Save before switching students." : sheet?.status === "submitted" ? "This attempt is scored." : "Answers stay editable until you submit."}</span></div>
        <div>{sheet?.status !== "submitted" && <button disabled={!sheet || isPending || !dirty} onClick={() => save(false)} type="button">{pendingLabel === "saving" ? "Saving…" : "Save draft"}</button>}<button className={styles.primary} disabled={!sheet || isPending || (sheet.status === "submitted" && !dirty)} onClick={() => save(true)} type="button">{pendingLabel === "submitting" ? "Scoring…" : sheet?.status === "submitted" ? "Save & rescore" : "Save & score"}</button></div>
      </footer>
    </section>
  </div>;
}
