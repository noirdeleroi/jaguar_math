"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import MathText from "@/app/components/math-text";
import { saveStudentResponse, submitExamAttempt, submitStudentAttempt } from "../actions";
import { sendExamActivity, type ExamActivityEvent } from "./exam-activity-client";
import styles from "./exam-mode.module.css";

type Question = { id: string; prompt: string; type: string; options: { id: string; text: string }[] | null; points: number; answer: string };
type ExamMode = { requireFullscreen: boolean; trackFocusExits: boolean; allowedFocusExits: number; focusViolations: number };

export default function AssessmentRunner({ attemptId, startedAt, durationMinutes, questions, responsesClosed = false, examMode }: { attemptId: string; startedAt: string; durationMinutes: number | null; questions: Question[]; responsesClosed?: boolean; examMode?: ExamMode }) {
  const router = useRouter();
  const [answers, setAnswers] = useState(() => Object.fromEntries(questions.map((question) => [question.id, question.answer ?? ""])));
  const [notice, setNotice] = useState("");
  const [pending, startTransition] = useTransition();
  const [savingQuestionId, setSavingQuestionId] = useState<string | null>(null);
  const [focusViolations, setFocusViolations] = useState(examMode?.focusViolations ?? 0);
  const [examWarning, setExamWarning] = useState("");
  const [fullscreenBlocked, setFullscreenBlocked] = useState(false);
  const [autoSubmitted, setAutoSubmitted] = useState(false);
  const awayAt = useRef<number | null>(null);
  const lastViolationAt = useRef(0);
  const autoSubmitKnown = useRef(false);
  const activeRef = useRef(true);
  const expiresAt = useMemo(() => durationMinutes ? new Date(startedAt).getTime() + durationMinutes * 60_000 : null, [durationMinutes, startedAt]);
  const [remaining, setRemaining] = useState(() => expiresAt ? Math.max(0, expiresAt - Date.now()) : 0);

  useEffect(() => { if (!expiresAt) return; const timer = window.setInterval(() => setRemaining(Math.max(0, expiresAt - Date.now())), 1000); return () => window.clearInterval(timer); }, [expiresAt]);
  useEffect(() => { activeRef.current = true; return () => { activeRef.current = false; }; }, []);

  const warningFor = useCallback((count: number) => {
    if (!examMode) return "";
    if (count >= examMode.allowedFocusExits) return "FINAL WARNING: If you leave the assessment again, your test will be submitted automatically.";
    const remainingExits = examMode.allowedFocusExits - count;
    return `You have ${remainingExits} permitted interruption${remainingExits === 1 ? "" : "s"} remaining. Further interruptions after that will automatically submit your test.`;
  }, [examMode]);

  const logActivity = useCallback(async (eventType: ExamActivityEvent, awayDurationSeconds?: number, violation = false, keepalive = false) => {
    if (!examMode || !activeRef.current || autoSubmitKnown.current || (violation && Date.now() - lastViolationAt.current < 1200)) return;
    if (violation) lastViolationAt.current = Date.now();
    const result = await sendExamActivity(attemptId, eventType, awayDurationSeconds, keepalive);
    if ("error" in result) { setExamWarning(result.error ?? "Exam activity could not be recorded. Your saved answers are unaffected."); return; }
    if (process.env.NODE_ENV === "development") console.info("exam event response:", { success: true, eventType, focusViolations: result.focusViolations, autoSubmitted: result.autoSubmitted });
    setFocusViolations(result.focusViolations);
    if (result.autoSubmitted) {
      autoSubmitKnown.current = true;
      setAutoSubmitted(true);
      setFullscreenBlocked(true);
      setExamWarning("");
      window.setTimeout(() => { if (activeRef.current) router.refresh(); }, 600);
      return;
    }
    if (violation) setExamWarning(`Focus exits: ${result.focusViolations} of ${examMode.allowedFocusExits}. ${warningFor(result.focusViolations)}`);
  }, [attemptId, examMode, router, warningFor]);

  useEffect(() => {
    if (!examMode || responsesClosed || autoSubmitted) return;
    const visibility = () => {
      if (document.visibilityState === "hidden") { awayAt.current = Date.now(); if (examMode.trackFocusExits) void logActivity("page_hidden", undefined, true, true); }
      else {
        const duration = awayAt.current ? Math.round((Date.now() - awayAt.current) / 1000) : undefined;
        awayAt.current = null;
        if (examMode.requireFullscreen && !document.fullscreenElement) setFullscreenBlocked(true);
        window.setTimeout(() => void logActivity("page_visible", duration), 150);
      }
    };
    const blur = () => { if (document.visibilityState === "visible") void logActivity("window_blur"); };
    const focus = () => { if (document.visibilityState === "visible") void logActivity("window_focus"); };
    const fullscreen = () => {
      if (document.fullscreenElement) return;
      if (examMode.requireFullscreen) {
        if (process.env.NODE_ENV === "development") console.info("exam fullscreen exit detected");
        setFullscreenBlocked(true);
        window.setTimeout(() => { if (document.visibilityState === "visible" && !document.fullscreenElement) void logActivity("fullscreen_exited", undefined, true); }, 250);
      }
    };
    document.addEventListener("visibilitychange", visibility); window.addEventListener("blur", blur); window.addEventListener("focus", focus); document.addEventListener("fullscreenchange", fullscreen);
    return () => { document.removeEventListener("visibilitychange", visibility); window.removeEventListener("blur", blur); window.removeEventListener("focus", focus); document.removeEventListener("fullscreenchange", fullscreen); };
  }, [autoSubmitted, examMode, logActivity, responsesClosed]);

  const restoreFullscreen = async () => {
    if (autoSubmitKnown.current) return;
    try {
      if (!document.documentElement.requestFullscreen) throw new Error("unsupported");
      await document.documentElement.requestFullscreen();
      if (!document.fullscreenElement) throw new Error("not-entered");
      setFullscreenBlocked(false); setExamWarning(""); await logActivity("fullscreen_restored");
    } catch { await logActivity("fullscreen_unavailable"); setExamWarning("Fullscreen could not be restored. Try again to continue the assessment."); }
  };
  const save = (questionId: string, answer: string) => { if (pending || responsesClosed || fullscreenBlocked || autoSubmitted) return; setAnswers((current) => ({ ...current, [questionId]: answer })); setSavingQuestionId(questionId); startTransition(async () => { const result = await saveStudentResponse(attemptId, questionId, answer); if (result.error) setNotice(result.error); else setNotice("Saved."); setSavingQuestionId(null); }); };
  const submit = () => { if (pending || fullscreenBlocked || autoSubmitted) return; startTransition(async () => { const result = examMode ? await submitExamAttempt(attemptId) : await submitStudentAttempt(attemptId); if (result.error) setNotice(result.error); else router.refresh(); }); };
  const clock = `${String(Math.floor(remaining / 60_000)).padStart(2, "0")}:${String(Math.floor((remaining % 60_000) / 1000)).padStart(2, "0")}`;
  const interactionBlocked = fullscreenBlocked || autoSubmitted;

  return <section className={`runner ${interactionBlocked ? styles.runnerBlocked : ""}`}><div className="runner-header"><div><p className="eyebrow">{examMode ? "Exam Mode" : "Active attempt"}</p><h2>{questions.length} questions</h2>{examMode && <p className={styles.status}>Focus exits: {focusViolations} / {examMode.allowedFocusExits}</p>}</div><div className={styles.meta}>{expiresAt && <strong className={remaining === 0 ? "timer-expired" : ""}>Time remaining: {clock}</strong>}</div></div>{examWarning && !interactionBlocked && <section className={styles.warning} role="status"><strong>Exam Mode interrupted</strong><p>{examWarning}</p></section>}{responsesClosed && <p className="form-note lifecycle-note">Overdue. Answers can no longer be changed, but you may submit the work already saved.</p>}{questions.map((question, index) => <article className="student-question" key={question.id}><div className="question-number">{index + 1} · {question.points} {question.points === 1 ? "point" : "points"}</div><div className="question-prompt"><MathText>{question.prompt}</MathText></div>{question.type === "multiple_choice" ? <div className="answer-options">{question.options?.map((option) => <label key={option.id}><input checked={answers[question.id] === option.id} disabled={pending || responsesClosed || interactionBlocked || (remaining === 0 && Boolean(expiresAt))} name={question.id} onChange={() => save(question.id, option.id)} type="radio" /> <b>{option.id}</b> <MathText>{option.text}</MathText></label>)}</div> : <label className="answer-text">Your answer<input disabled={pending || responsesClosed || interactionBlocked || (remaining === 0 && Boolean(expiresAt))} onBlur={(event) => save(question.id, event.target.value)} onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))} value={answers[question.id]} /></label>}</article>)}{notice && <p className="notice notice-error" role="status">{notice}</p>}<button aria-live="polite" className="teacher-button" disabled={pending || interactionBlocked} onClick={submit} type="button">{savingQuestionId ? "Saving..." : pending ? "Submitting..." : "Submit attempt"} <span aria-hidden="true">→</span></button>{interactionBlocked && <section className={styles.blockOverlay} role="alert">{autoSubmitted ? <><p className="eyebrow">Exam submitted</p><h2>Your assessment was submitted automatically.</h2><p>The allowed number of focus interruptions was exceeded.</p><p>Loading your submitted result…</p></> : <><p className="eyebrow">Exam Mode interrupted</p><h2>You exited fullscreen.</h2><p>Focus exits: {focusViolations} of {examMode?.allowedFocusExits ?? 0}</p><p>{examWarning || warningFor(focusViolations)}</p><button className="teacher-button" onClick={restoreFullscreen} type="button">Return to fullscreen <span aria-hidden="true">→</span></button></>}</section>}</section>;
}
