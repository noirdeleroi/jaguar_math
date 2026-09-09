"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import MathText from "@/app/components/math-text";
import { saveStudentResponseWithFeedback, submitAttemptSnapshot, submitExamAttempt, submitStudentAttempt } from "../actions";
import { flushExamActivityQueue, sendExamActivity, type ExamActivityEvent } from "./exam-activity-client";
import styles from "./exam-mode.module.css";

type Question = { id: string; prompt: string; type: string; options: { id: string; text: string }[] | null; points: number; answer: string; isCorrect: boolean | null; pointsAwarded: number | null };
type ExamMode = { requireFullscreen: boolean; trackFocusExits: boolean; allowedFocusExits: number; focusViolations: number; violationAction: "warn" | "auto_submit" };
type Feedback = { isCorrect: boolean; pointsAwarded: number };
type PendingAnswer = { answer: string; revision: number };
type SyncState = "saved" | "saving" | "offline" | "error";

const draftKey = (attemptId: string) => `jaguar-attempt-draft:${attemptId}`;

export default function AssessmentRunner({ attemptId, expiresAt, formCode, questions, responsesClosed = false, examMode, questionDisplayMode, showFeedbackAfterEachQuestion }: { attemptId: string; expiresAt: string | null; formCode: string | null; questions: Question[]; responsesClosed?: boolean; examMode?: ExamMode; questionDisplayMode: "one_at_a_time" | "all_at_once"; showFeedbackAfterEachQuestion: boolean }) {
  const router = useRouter();
  const initialAnswers = useMemo(() => Object.fromEntries(questions.map((question) => [question.id, question.answer ?? ""])), [questions]);
  const [answers, setAnswers] = useState<Record<string, string>>(initialAnswers);
  const [feedback, setFeedback] = useState<Record<string, Feedback | null>>(() => Object.fromEntries(questions.map((question) => [question.id, question.isCorrect === null ? null : { isCorrect: question.isCorrect, pointsAwarded: question.pointsAwarded ?? 0 }])));
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [notice, setNotice] = useState("");
  const [checkingQuestionId, setCheckingQuestionId] = useState<string | null>(null);
  const [submitting, startSubmitting] = useTransition();
  const [syncState, setSyncState] = useState<SyncState>("saved");
  const [online, setOnline] = useState(true);
  const [focusViolations, setFocusViolations] = useState(examMode?.focusViolations ?? 0);
  const [examWarning, setExamWarning] = useState("");
  const [fullscreenBlocked, setFullscreenBlocked] = useState(false);
  const [autoSubmitted, setAutoSubmitted] = useState(false);
  const awayAt = useRef<number | null>(null);
  const lastViolationAt = useRef(0);
  const autoSubmitKnown = useRef(false);
  const activeRef = useRef(true);
  const pendingRef = useRef<Record<string, PendingAnswer>>({});
  const syncTimerRef = useRef<number | null>(null);
  const syncPromiseRef = useRef<Promise<boolean> | null>(null);
  const revisionRef = useRef(0);
  const timedSubmitStarted = useRef(false);
  const timedSubmissionPending = useRef(false);
  const submissionRef = useRef<{ responses: { questionId: string; answer: string; revision: number }[]; clientSubmittedAt: string; timed: boolean } | null>(null);
  const deadline = expiresAt ? new Date(expiresAt).getTime() : null;
  const [remaining, setRemaining] = useState(() => deadline ? Math.max(0, deadline - Date.now()) : 0);

  const persistPending = useCallback(() => {
    try {
      const pending = pendingRef.current;
      if (Object.keys(pending).length) localStorage.setItem(draftKey(attemptId), JSON.stringify({ pending }));
      else localStorage.removeItem(draftKey(attemptId));
    } catch { /* Answers remain in memory when browser storage is unavailable. */ }
  }, [attemptId]);

  const syncPending = useCallback(async () => {
    if (syncPromiseRef.current) return syncPromiseRef.current;
    const work = async () => {
      const entries = Object.entries(pendingRef.current);
      if (!entries.length) { setSyncState("saved"); return true; }
      if (!navigator.onLine) { setOnline(false); setSyncState("offline"); return false; }
      setSyncState("saving");
      try {
        const payload = entries.map(([questionId, value]) => ({ questionId, answer: value.answer, revision: value.revision }));
        const response = await fetch("/api/attempt-responses", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ attemptId, responses: payload }) });
        const data = await response.json().catch(() => null) as { error?: string } | null;
        if (!response.ok) {
          setSyncState(response.status === 409 ? "error" : "offline");
          setNotice(data?.error ?? "Answers could not be synchronized. They remain saved on this device.");
          return false;
        }
        for (const [questionId, value] of entries) if (pendingRef.current[questionId]?.revision === value.revision) delete pendingRef.current[questionId];
        persistPending();
        setOnline(true);
        setSyncState(Object.keys(pendingRef.current).length ? "saving" : "saved");
        if (!Object.keys(pendingRef.current).length) setNotice("");
        return !Object.keys(pendingRef.current).length;
      } catch {
        setOnline(false); setSyncState("offline");
        setNotice("Connection interrupted. Your answers are safe on this device and will retry automatically.");
        return false;
      }
    };
    syncPromiseRef.current = work().finally(() => { syncPromiseRef.current = null; });
    return syncPromiseRef.current;
  }, [attemptId, persistPending]);

  const scheduleSync = useCallback(() => {
    if (syncTimerRef.current !== null) window.clearTimeout(syncTimerRef.current);
    syncTimerRef.current = window.setTimeout(() => void syncPending(), 450);
  }, [syncPending]);

  const queueAnswer = useCallback((questionId: string, answer: string) => {
    const revision = revisionRef.current = Math.max(revisionRef.current + 1, Date.now() * 1000);
    setAnswers((current) => ({ ...current, [questionId]: answer }));
    pendingRef.current[questionId] = { answer, revision };
    persistPending();
    setSyncState(navigator.onLine ? "saving" : "offline");
    scheduleSync();
  }, [persistPending, scheduleSync]);

  const sendPendingBeacon = useCallback(() => {
    const entries = Object.entries(pendingRef.current);
    if (!entries.length || !navigator.sendBeacon) return;
    const responses = entries.map(([questionId, value]) => ({ questionId, answer: value.answer, revision: value.revision }));
    navigator.sendBeacon("/api/attempt-responses", JSON.stringify({ attemptId, responses }));
  }, [attemptId]);

  useEffect(() => {
    activeRef.current = true;
    try {
      const stored = JSON.parse(localStorage.getItem(draftKey(attemptId)) ?? "null") as { pending?: Record<string, PendingAnswer> } | null;
      if (stored?.pending && typeof stored.pending === "object") {
        const validQuestionIds = new Set(questions.map((question) => question.id));
        pendingRef.current = Object.fromEntries(Object.entries(stored.pending).filter(([questionId, value]) => validQuestionIds.has(questionId) && typeof value?.answer === "string" && Number.isSafeInteger(value?.revision)));
        if (Object.keys(pendingRef.current).length) window.setTimeout(() => {
          setAnswers((current) => ({ ...current, ...Object.fromEntries(Object.entries(pendingRef.current).map(([questionId, value]) => [questionId, value.answer])) }));
          setSyncState(navigator.onLine ? "saving" : "offline");
          void syncPending();
        }, 0);
      }
    } catch { try { localStorage.removeItem(draftKey(attemptId)); } catch { /* Storage is unavailable. */ } }
    return () => { activeRef.current = false; if (syncTimerRef.current !== null) window.clearTimeout(syncTimerRef.current); };
  }, [attemptId, questions, syncPending]);

  useEffect(() => {
    if (!deadline) return;
    const timer = window.setInterval(() => setRemaining(Math.max(0, deadline - Date.now())), 1000);
    return () => window.clearInterval(timer);
  }, [deadline]);

  const warningFor = useCallback((count: number) => {
    if (!examMode) return "";
    if (examMode.violationAction === "warn") return count > examMode.allowedFocusExits ? "This interruption is flagged for your teacher to review." : `${examMode.allowedFocusExits - count} permitted interruption${examMode.allowedFocusExits - count === 1 ? "" : "s"} remaining.`;
    if (count >= examMode.allowedFocusExits) return "FINAL WARNING: Leaving again will submit your assessment automatically.";
    const remainingExits = examMode.allowedFocusExits - count;
    return `${remainingExits} permitted interruption${remainingExits === 1 ? "" : "s"} remaining.`;
  }, [examMode]);

  const applyActivityResult = useCallback((result: Awaited<ReturnType<typeof sendExamActivity>> | null, violation = false) => {
    if (!result) return;
    if ("error" in result) { setExamWarning(result.error ?? "Exam activity is queued until the connection returns."); return; }
    setFocusViolations(result.focusViolations);
    if (result.autoSubmitted) { autoSubmitKnown.current = true; setAutoSubmitted(true); setFullscreenBlocked(true); setExamWarning(""); localStorage.removeItem(draftKey(attemptId)); window.setTimeout(() => { if (activeRef.current) router.refresh(); }, 600); return; }
    if (violation) setExamWarning(`Focus exits: ${result.focusViolations}. ${warningFor(result.focusViolations)}`);
  }, [attemptId, router, warningFor]);

  const logActivity = useCallback(async (eventType: ExamActivityEvent, awayDurationSeconds?: number, violation = false, keepalive = false) => {
    if (!examMode || !activeRef.current || autoSubmitKnown.current || (violation && Date.now() - lastViolationAt.current < 1200)) return;
    if (violation) lastViolationAt.current = Date.now();
    applyActivityResult(await sendExamActivity(attemptId, eventType, awayDurationSeconds, keepalive), violation);
  }, [applyActivityResult, attemptId, examMode]);

  useEffect(() => {
    const onlineHandler = () => { setOnline(true); setSyncState(Object.keys(pendingRef.current).length ? "saving" : "saved"); void syncPending(); if (examMode) void flushExamActivityQueue(attemptId).then((result) => applyActivityResult(result)); };
    const offlineHandler = () => { setOnline(false); if (Object.keys(pendingRef.current).length) setSyncState("offline"); };
    window.addEventListener("online", onlineHandler); window.addEventListener("offline", offlineHandler);
    return () => { window.removeEventListener("online", onlineHandler); window.removeEventListener("offline", offlineHandler); };
  }, [applyActivityResult, attemptId, examMode, syncPending]);

  useEffect(() => {
    if (!examMode || responsesClosed || autoSubmitted) return;
    const visibility = () => {
      if (document.visibilityState === "hidden") { awayAt.current = Date.now(); sendPendingBeacon(); if (examMode.trackFocusExits) void logActivity("page_hidden", undefined, true, true); }
      else { const duration = awayAt.current ? Math.round((Date.now() - awayAt.current) / 1000) : undefined; awayAt.current = null; if (examMode.requireFullscreen && !document.fullscreenElement) setFullscreenBlocked(true); window.setTimeout(() => void logActivity("page_visible", duration), 150); }
    };
    const blur = () => { if (document.visibilityState === "visible") void logActivity("window_blur"); };
    const focus = () => { if (document.visibilityState === "visible") void logActivity("window_focus"); };
    const fullscreen = () => { if (!document.fullscreenElement && examMode.requireFullscreen) { setFullscreenBlocked(true); window.setTimeout(() => { if (document.visibilityState === "visible" && !document.fullscreenElement) void logActivity("fullscreen_exited", undefined, true); }, 250); } };
    document.addEventListener("visibilitychange", visibility); window.addEventListener("blur", blur); window.addEventListener("focus", focus); document.addEventListener("fullscreenchange", fullscreen);
    return () => { document.removeEventListener("visibilitychange", visibility); window.removeEventListener("blur", blur); window.removeEventListener("focus", focus); document.removeEventListener("fullscreenchange", fullscreen); };
  }, [autoSubmitted, examMode, logActivity, responsesClosed, sendPendingBeacon]);

  const restoreFullscreen = async () => {
    if (autoSubmitKnown.current) return;
    try { if (!document.documentElement.requestFullscreen) throw new Error("unsupported"); await document.documentElement.requestFullscreen(); if (!document.fullscreenElement) throw new Error("not-entered"); setFullscreenBlocked(false); setExamWarning(""); await logActivity("fullscreen_restored"); }
    catch { await logActivity("fullscreen_unavailable"); setExamWarning("Fullscreen could not be restored. Try again to continue the assessment."); }
  };

  const checkFeedback = async (questionId: string, answer: string) => {
    setCheckingQuestionId(questionId);
    try {
      if (!(await syncPending())) { setNotice("Feedback will be available after this answer synchronizes."); setCheckingQuestionId(null); return; }
      const result = await saveStudentResponseWithFeedback(attemptId, questionId, answer);
      if ("error" in result) setNotice(result.error);
      else setFeedback((current) => ({ ...current, [questionId]: { isCorrect: result.isCorrect, pointsAwarded: result.pointsAwarded } }));
    } catch { setNotice("Feedback is waiting for a connection. Your answer remains saved on this device."); }
    setCheckingQuestionId(null);
  };
  const save = (questionId: string, answer: string, checkImmediately = false) => { if (responsesClosed || fullscreenBlocked || autoSubmitted || (deadline !== null && remaining === 0)) return; queueAnswer(questionId, answer); if (checkImmediately) void checkFeedback(questionId, answer); };

  const submit = useCallback((timed = false) => {
    if (submitting || autoSubmitted || (!timed && fullscreenBlocked && !responsesClosed)) return;
    if (timed) timedSubmissionPending.current = true;
    if (!responsesClosed && !submissionRef.current) submissionRef.current = {
      responses: questions.map((question) => ({ questionId: question.id, answer: answers[question.id] ?? "", revision: pendingRef.current[question.id]?.revision ?? 0 })),
      clientSubmittedAt: new Date(timed && deadline !== null ? deadline : Date.now()).toISOString(),
      timed,
    };
    startSubmitting(async () => {
      setNotice(timed ? "Time is up. Submitting your final answer snapshot..." : "Submitting your final answer snapshot...");
      try {
        if (responsesClosed) {
          const result = examMode ? await submitExamAttempt(attemptId) : await submitStudentAttempt(attemptId);
          if (result.error) { setNotice(result.error); return; }
          localStorage.removeItem(draftKey(attemptId)); router.refresh(); return;
        }
        const snapshot = submissionRef.current;
        if (!snapshot) return;
        const result = await submitAttemptSnapshot(attemptId, snapshot.responses, snapshot.clientSubmittedAt, snapshot.timed);
        if (result.error) { timedSubmissionPending.current = timed && result.error.includes("Keep this page open"); if (!timed) submissionRef.current = null; setNotice(result.error); }
        else { timedSubmissionPending.current = false; localStorage.removeItem(draftKey(attemptId)); router.refresh(); }
      } catch { if (!timed) submissionRef.current = null; setOnline(false); setNotice(timed ? "Submission is waiting for Wi-Fi. Keep this page open; it will retry automatically." : "Submission is waiting for Wi-Fi. Your answers are safe on this device; try Submit again after reconnecting."); }
    });
  }, [answers, attemptId, autoSubmitted, deadline, examMode, fullscreenBlocked, questions, responsesClosed, router, submitting]);

  useEffect(() => {
    if (deadline === null || remaining > 0 || responsesClosed || autoSubmitted || timedSubmitStarted.current) return;
    timedSubmitStarted.current = true;
    submit(true);
  }, [autoSubmitted, deadline, remaining, responsesClosed, submit]);
  useEffect(() => {
    if (!timedSubmissionPending.current || syncState === "error") return;
    const retry = window.setInterval(() => { if (navigator.onLine && !submitting) submit(true); }, 10_000);
    return () => window.clearInterval(retry);
  }, [submit, submitting, syncState]);

  const clock = `${String(Math.floor(remaining / 60_000)).padStart(2, "0")}:${String(Math.floor((remaining % 60_000) / 1000)).padStart(2, "0")}`;
  const timeEnded = deadline !== null && remaining === 0;
  const interactionBlocked = fullscreenBlocked || autoSubmitted || timeEnded;
  const displayQuestions = questionDisplayMode === "all_at_once" ? questions.map((question, index) => ({ question, index })) : questions[currentQuestion] ? [{ question: questions[currentQuestion], index: currentQuestion }] : [];
  const inputDisabled = responsesClosed || interactionBlocked;
  const syncLabel = syncState === "saved" ? "All answers saved" : syncState === "saving" ? "Saving answers…" : syncState === "offline" ? "Offline · answers safe on this device" : "Answers need attention";

  return <section className={`runner ${interactionBlocked ? styles.runnerBlocked : ""}`}><div className="runner-header"><div><p className="eyebrow">{examMode ? "Secure mode · Exam Mode" : "Active attempt"}</p><h2>{questions.length} questions</h2><div className={styles.runnerStatus}><span className={`${styles.syncStatus} ${styles[syncState]}`}>{syncLabel}</span>{formCode && <span>Form {formCode}</span>}{examMode && <span>Focus exits: {focusViolations} · allowance {examMode.allowedFocusExits}</span>}</div></div><div className={styles.meta}>{deadline && <strong className={timeEnded ? "timer-expired" : ""}>Time remaining: {clock}</strong>}</div></div>{examWarning && !interactionBlocked && <section className={styles.warning} role="status"><strong>Exam Mode activity</strong><p>{examWarning}</p></section>}{responsesClosed && <p className="form-note lifecycle-note">Overdue. Answers can no longer be changed. Submitting now grades only work already synchronized to the server.</p>}
    {questionDisplayMode === "one_at_a_time" && <nav aria-label="Question navigation" className={`${styles.questionNavigator} ${examMode ? styles.secureNavigator : ""}`}>{questions.map((question, index) => { const itemFeedback = feedback[question.id]; const state = itemFeedback ? itemFeedback.isCorrect ? styles.correct : styles.incorrect : answers[question.id]?.trim() ? styles.answered : ""; return <button aria-current={index === currentQuestion ? "step" : undefined} aria-label={`Question ${index + 1}: ${itemFeedback ? itemFeedback.isCorrect ? "correct" : "incorrect" : answers[question.id]?.trim() ? "answered" : "not answered"}`} className={`${styles.questionNavButton} ${index === currentQuestion ? styles.active : ""} ${state}`} key={question.id} onClick={() => setCurrentQuestion(index)} type="button">{index + 1}</button>; })}</nav>}
    {displayQuestions.map(({ question, index }) => { const itemFeedback = feedback[question.id]; return <article className="student-question" key={question.id}><div className="question-number">Question {index + 1} · {question.points} {question.points === 1 ? "point" : "points"}</div><div className="question-prompt"><MathText>{question.prompt}</MathText></div>{question.type === "multiple_choice" ? <div className="answer-options">{question.options?.map((option, optionIndex) => <label key={option.id}><input checked={answers[question.id] === option.id} disabled={inputDisabled} name={question.id} onChange={() => save(question.id, option.id, showFeedbackAfterEachQuestion)} type="radio" /><b>{String.fromCharCode(65 + optionIndex)}</b><MathText>{option.text}</MathText></label>)}</div> : <><label className="answer-text">Your answer<input disabled={inputDisabled} onChange={(event) => save(question.id, event.target.value)} value={answers[question.id] ?? ""} /></label>{showFeedbackAfterEachQuestion && <button className="secondary-inline-button" disabled={inputDisabled || checkingQuestionId === question.id} onClick={() => void checkFeedback(question.id, answers[question.id] ?? "")} type="button">{checkingQuestionId === question.id ? "Checking..." : "Check answer"}</button>}</>}{showFeedbackAfterEachQuestion && itemFeedback && <p className={itemFeedback.isCorrect ? styles.feedbackCorrect : styles.feedbackIncorrect}>{itemFeedback.isCorrect ? `Correct · ${itemFeedback.pointsAwarded} points` : "Try again."}</p>}</article>; })}
    {questionDisplayMode === "one_at_a_time" && <div className={styles.questionControls}><button className="secondary-inline-button" disabled={currentQuestion === 0} onClick={() => setCurrentQuestion((current) => current - 1)} type="button">← Previous</button>{currentQuestion === questions.length - 1 ? <button className="teacher-button" disabled={submitting || interactionBlocked} onClick={() => submit(false)} type="button">{submitting ? "Submitting..." : "Submit assessment"} <span aria-hidden="true">→</span></button> : <button className="secondary-inline-button" onClick={() => setCurrentQuestion((current) => current + 1)} type="button">Next question →</button>}</div>}
    {notice && <p className={syncState === "offline" ? styles.connectionNotice : "notice notice-error"} role="status">{notice}</p>}{questionDisplayMode === "all_at_once" && <button className="teacher-button" disabled={submitting || interactionBlocked} onClick={() => submit(false)} type="button">{submitting ? "Submitting..." : "Submit assignment"} <span aria-hidden="true">→</span></button>}{interactionBlocked && <section aria-live="assertive" className={`${styles.blockOverlay} ${fullscreenBlocked && !timeEnded && !autoSubmitted ? styles.fullscreenAlert : ""}`} role="alert">{autoSubmitted ? <><p className="eyebrow">Assessment submitted</p><h2>Exam Mode submitted your work.</h2><p>The configured focus-exit limit was exceeded.</p></> : fullscreenBlocked && !timeEnded ? <><span aria-hidden="true" className={styles.alertIcon}>!</span><p className="eyebrow">Security warning · Exit recorded</p><h2>You left fullscreen.</h2><p>This interruption is being recorded and will be visible to your teacher. {examWarning || warningFor(focusViolations)}</p><strong className={styles.alertInstruction}>Return immediately. Do not switch tabs, apps, or windows during the assessment.</strong><button className="teacher-button" onClick={restoreFullscreen} type="button">Return to fullscreen <span aria-hidden="true">→</span></button></> : <><p className="eyebrow">Time is up</p><h2>{submitting ? "Submitting your assessment…" : online ? "Finalizing your assessment…" : "Waiting for Wi-Fi"}</h2><p>{online ? "Your synchronized answers are being submitted." : "Keep this page open. Your answers are safe on this device and submission will retry after reconnection."}</p></>}</section>}</section>;
}
