"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import MathText from "@/app/components/math-text";
import { saveStudentResponseWithFeedback, submitAttemptSnapshot, submitExamAttempt, submitStudentAttempt } from "../actions";
import { flushExamActivityQueue, sendExamActivity, type ExamActivityEvent, type ExamResponseSnapshot } from "./exam-activity-client";
import { restoreFullscreenBeforeVerification } from "./exam-mode-attempt";
import { canRequestFullscreen, createFullscreenExitTracker, isFullscreenActive, requestAppFullscreen, subscribeToFullscreen } from "./fullscreen-api";
import { requestScreenWakeLock, type ScreenWakeLockHandle } from "./screen-wake-lock";
import styles from "./exam-mode.module.css";

type Question = { id: string; prompt: string; type: string; options: { id: string; text: string }[] | null; points: number; answer: string; serverRevision: number; isCorrect: boolean | null; pointsAwarded: number | null };
type ExamMode = { requireFullscreen: boolean; trackFocusExits: boolean; allowedFocusExits: number; focusViolations: number; violationAction: "warn" | "auto_submit" };
type Feedback = { isCorrect: boolean; pointsAwarded: number };
type PendingAnswer = { answer: string; revision: number };
type StoredDraft = { version: 2; updatedAt: string; answers: Record<string, PendingAnswer>; pending: Record<string, PendingAnswer> };
type SyncState = "saved" | "saving" | "offline" | "error";
type WakeLockState = "idle" | "requesting" | "active" | "unavailable";
type AttemptStatus = { status: "in_progress" | "submitted"; expiresAt: string | null; assignmentStatus: "published" | "closed"; examMode: Omit<ExamMode, "focusViolations"> | null };

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
  const [authRequired, setAuthRequired] = useState(false);
  const [wakeLockState, setWakeLockState] = useState<WakeLockState>(examMode ? "requesting" : "idle");
  const [focusViolations, setFocusViolations] = useState(examMode?.focusViolations ?? 0);
  const [examWarning, setExamWarning] = useState("");
  // The live fullscreen snapshot below provides the initial closed state; this
  // state keeps the warning locked after each detected exit until confirmation.
  const [fullscreenBlocked, setFullscreenBlocked] = useState(false);
  const [verifyingExit, setVerifyingExit] = useState(false);
  const [autoSubmitted, setAutoSubmitted] = useState(false);
  const fullscreenActive = useSyncExternalStore(subscribeToFullscreen, () => isFullscreenActive(), () => false);
  const awayAt = useRef<number | null>(null);
  const fullscreenExitTracker = useRef(createFullscreenExitTracker());
  const restoringFullscreen = useRef(false);
  const autoSubmitKnown = useRef(false);
  const activeRef = useRef(true);
  const restoreButtonRef = useRef<HTMLButtonElement | null>(null);
  const pendingRef = useRef<Record<string, PendingAnswer>>({});
  const localAnswersRef = useRef<Record<string, PendingAnswer>>(Object.fromEntries(questions.map((question) => [question.id, { answer: question.answer ?? "", revision: question.serverRevision ?? 0 }])));
  const answersRef = useRef<Record<string, string>>(initialAnswers);
  const syncTimerRef = useRef<number | null>(null);
  const syncPromiseRef = useRef<Promise<boolean> | null>(null);
  const revisionRef = useRef(0);
  const timedSubmitStarted = useRef(false);
  const timedSubmissionPending = useRef(false);
  const submissionRef = useRef<{ responses: { questionId: string; answer: string; revision: number }[]; clientSubmittedAt: string; timed: boolean } | null>(null);
  const deadline = expiresAt ? new Date(expiresAt).getTime() : null;
  const [remaining, setRemaining] = useState(() => deadline ? Math.max(0, deadline - Date.now()) : 0);

  const persistDraft = useCallback(() => {
    try {
      const draft: StoredDraft = { version: 2, updatedAt: new Date().toISOString(), answers: localAnswersRef.current, pending: pendingRef.current };
      localStorage.setItem(draftKey(attemptId), JSON.stringify(draft));
    } catch { /* Answers remain in memory when browser storage is unavailable. */ }
  }, [attemptId]);

  const syncPending = useCallback(async () => {
    if (syncPromiseRef.current) return syncPromiseRef.current;
    const work = async () => {
      const entries = Object.entries(pendingRef.current);
      if (!entries.length) { setSyncState("saved"); return true; }
      setSyncState("saving");
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 8_000);
      try {
        const payload = entries.map(([questionId, value]) => ({ questionId, answer: value.answer, revision: value.revision }));
        const response = await fetch("/api/attempt-responses", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ attemptId, responses: payload }), signal: controller.signal });
        const data = await response.json().catch(() => null) as { error?: string } | null;
        if (!response.ok) {
          setSyncState(response.status === 409 ? "error" : "offline");
          setAuthRequired(response.status === 401);
          setNotice(data?.error ?? "Answers could not be synchronized. They remain saved on this device.");
          return false;
        }
        for (const [questionId, value] of entries) if (pendingRef.current[questionId]?.revision === value.revision) delete pendingRef.current[questionId];
        persistDraft();
        setOnline(true);
        setAuthRequired(false);
        setSyncState(Object.keys(pendingRef.current).length ? "saving" : "saved");
        if (!Object.keys(pendingRef.current).length) setNotice("");
        return !Object.keys(pendingRef.current).length;
      } catch {
        setOnline(false); setSyncState("offline");
        setNotice("Connection interrupted. Your answers are safe on this device and will retry automatically.");
        return false;
      } finally {
        window.clearTimeout(timeout);
      }
    };
    syncPromiseRef.current = work().finally(() => { syncPromiseRef.current = null; });
    return syncPromiseRef.current;
  }, [attemptId, persistDraft]);

  const scheduleSync = useCallback(() => {
    if (syncTimerRef.current !== null) window.clearTimeout(syncTimerRef.current);
    syncTimerRef.current = window.setTimeout(() => void syncPending(), 450);
  }, [syncPending]);

  const queueAnswer = useCallback((questionId: string, answer: string) => {
    const revision = revisionRef.current = Math.max(revisionRef.current + 1, Date.now() * 1000, (localAnswersRef.current[questionId]?.revision ?? 0) + 1);
    answersRef.current = { ...answersRef.current, [questionId]: answer };
    setAnswers((current) => ({ ...current, [questionId]: answer }));
    pendingRef.current[questionId] = { answer, revision };
    localAnswersRef.current[questionId] = { answer, revision };
    persistDraft();
    setSyncState(navigator.onLine ? "saving" : "offline");
    scheduleSync();
  }, [persistDraft, scheduleSync]);

  const responseSnapshot = useCallback((): ExamResponseSnapshot[] => questions.flatMap((question) => {
    const local = localAnswersRef.current[question.id];
    const answer = answersRef.current[question.id] ?? question.answer ?? "";
    const revision = local?.revision ?? question.serverRevision ?? 0;
    return answer.trim() || revision > question.serverRevision ? [{ questionId: question.id, answer, revision }] : [];
  }), [questions]);

  const sendPendingBeacon = useCallback(() => {
    const entries = Object.entries(pendingRef.current);
    if (!entries.length || !navigator.sendBeacon) return;
    const responses = entries.map(([questionId, value]) => ({ questionId, answer: value.answer, revision: value.revision }));
    navigator.sendBeacon("/api/attempt-responses", JSON.stringify({ attemptId, responses }));
  }, [attemptId]);

  useEffect(() => {
    activeRef.current = true;
    try {
      const stored = JSON.parse(localStorage.getItem(draftKey(attemptId)) ?? "null") as Partial<StoredDraft> | null;
      if (stored && typeof stored === "object") {
        const validQuestionIds = new Set(questions.map((question) => question.id));
        const valid = (value: PendingAnswer | undefined) => typeof value?.answer === "string" && Number.isSafeInteger(value.revision) && value.revision >= 0;
        const storedAnswers = stored.answers && typeof stored.answers === "object" ? stored.answers : stored.pending;
        const localAnswers = Object.fromEntries(Object.entries(storedAnswers ?? {}).filter(([questionId, value]) => validQuestionIds.has(questionId) && valid(value)));
        localAnswersRef.current = Object.fromEntries(questions.map((question) => {
          const local = localAnswers[question.id];
          return [question.id, local && local.revision >= question.serverRevision ? local : { answer: question.answer ?? "", revision: question.serverRevision ?? 0 }];
        }));
        pendingRef.current = Object.fromEntries(Object.entries(stored.pending ?? {}).filter(([questionId, value]) => validQuestionIds.has(questionId) && valid(value) && value.revision > (questions.find((question) => question.id === questionId)?.serverRevision ?? 0)));
        revisionRef.current = Math.max(0, ...Object.values(localAnswersRef.current).map((value) => value.revision));
        const restoredAnswers = Object.fromEntries(Object.entries(localAnswersRef.current).map(([questionId, value]) => [questionId, value.answer]));
        answersRef.current = restoredAnswers;
        setAnswers(restoredAnswers);
        persistDraft();
        if (Object.keys(pendingRef.current).length) window.setTimeout(() => {
          setSyncState(navigator.onLine ? "saving" : "offline");
          void syncPending();
        }, 0);
      }
    } catch { /* A malformed old draft is ignored without deleting recoverable browser data. */ }
    return () => { activeRef.current = false; if (syncTimerRef.current !== null) window.clearTimeout(syncTimerRef.current); };
  }, [attemptId, persistDraft, questions, syncPending]);

  useEffect(() => {
    if (!deadline) return;
    const timer = window.setInterval(() => setRemaining(Math.max(0, deadline - Date.now())), 1000);
    return () => window.clearInterval(timer);
  }, [deadline]);

  useEffect(() => {
    if (!examMode || responsesClosed || autoSubmitted) return;
    let disposed = false;
    let requesting = false;
    let wakeLock: ScreenWakeLockHandle | null = null;
    let retryTimer: number | null = null;

    const scheduleRetry = (acquire: () => Promise<void>) => {
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      retryTimer = window.setTimeout(() => void acquire(), 30_000);
    };
    const acquire = async () => {
      if (disposed || requesting || wakeLock || document.visibilityState !== "visible") return;
      requesting = true;
      setWakeLockState("requesting");
      const nextLock = await requestScreenWakeLock();
      requesting = false;
      if (disposed) { await nextLock?.release().catch(() => undefined); return; }
      if (!nextLock) { setWakeLockState("unavailable"); scheduleRetry(acquire); return; }
      wakeLock = nextLock;
      setWakeLockState("active");
      nextLock.addEventListener("release", () => {
        if (disposed || wakeLock !== nextLock) return;
        wakeLock = null;
        setWakeLockState("unavailable");
        if (document.visibilityState === "visible") scheduleRetry(acquire);
      }, { once: true });
    };
    const visibility = () => { if (document.visibilityState === "visible") void acquire(); };

    void acquire();
    document.addEventListener("visibilitychange", visibility);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", visibility);
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      void wakeLock?.release().catch(() => undefined);
      wakeLock = null;
    };
  }, [autoSubmitted, examMode, responsesClosed]);

  const warningFor = useCallback((count: number) => {
    if (!examMode) return "";
    if (examMode.violationAction === "warn") return count > examMode.allowedFocusExits ? "This interruption is flagged for your teacher to review." : `${examMode.allowedFocusExits - count} permitted interruption${examMode.allowedFocusExits - count === 1 ? "" : "s"} remaining.`;
    if (count >= examMode.allowedFocusExits) return "FINAL WARNING: Leaving again will submit your assessment automatically.";
    const remainingExits = examMode.allowedFocusExits - count;
    return `${remainingExits} permitted interruption${remainingExits === 1 ? "" : "s"} remaining.`;
  }, [examMode]);

  const applyActivityResult = useCallback((result: Awaited<ReturnType<typeof sendExamActivity>> | null, violation = false) => {
    if (!result) return;
    if ("error" in result) { setVerifyingExit(false); setExamWarning(result.error ?? "This exit is saved locally and will be verified when the connection returns."); return; }
    setFocusViolations((current) => Math.max(current, result.focusViolations));
    setVerifyingExit(false);
    if (result.autoSubmitted) { autoSubmitKnown.current = true; setAutoSubmitted(true); setFullscreenBlocked(true); setExamWarning(""); persistDraft(); window.setTimeout(() => { if (activeRef.current) router.refresh(); }, 1200); return; }
    if (violation) setExamWarning(`Focus exits: ${result.focusViolations}. ${warningFor(result.focusViolations)}`);
  }, [persistDraft, router, warningFor]);

  const logActivity = useCallback(async (eventType: ExamActivityEvent, awayDurationSeconds?: number, violation = false, keepalive = false) => {
    if (!examMode || !activeRef.current || autoSubmitKnown.current) return;
    if (violation) { setVerifyingExit(true); setExamWarning("Checking this exit against your teacher's limit…"); }
    const result = await sendExamActivity(attemptId, eventType, awayDurationSeconds, keepalive, violation ? responseSnapshot() : undefined);
    applyActivityResult(result, violation);
  }, [applyActivityResult, attemptId, examMode, responseSnapshot]);

  useEffect(() => {
    const onlineHandler = () => { setOnline(true); setSyncState(Object.keys(pendingRef.current).length ? "saving" : "saved"); void syncPending(); if (examMode) void flushExamActivityQueue(attemptId).then((result) => { applyActivityResult(result); if (result && !("error" in result)) setVerifyingExit(false); }); };
    const offlineHandler = () => { setOnline(false); if (Object.keys(pendingRef.current).length) setSyncState("offline"); };
    window.addEventListener("online", onlineHandler); window.addEventListener("offline", offlineHandler);
    return () => { window.removeEventListener("online", onlineHandler); window.removeEventListener("offline", offlineHandler); };
  }, [applyActivityResult, attemptId, examMode, syncPending]);

  useEffect(() => {
    const retry = window.setInterval(() => { if (Object.keys(pendingRef.current).length && document.visibilityState === "visible") void syncPending(); }, 5_000);
    const retryVisible = () => { if (document.visibilityState === "visible" && Object.keys(pendingRef.current).length) void syncPending(); };
    document.addEventListener("visibilitychange", retryVisible);
    return () => { window.clearInterval(retry); document.removeEventListener("visibilitychange", retryVisible); };
  }, [syncPending]);

  useEffect(() => {
    if (!examMode) return;
    const refreshIfChanged = async () => {
      if (document.visibilityState !== "visible") return;
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 8_000);
      try {
        const response = await fetch(`/api/attempt-status?attemptId=${encodeURIComponent(attemptId)}`, { cache: "no-store", credentials: "same-origin", signal: controller.signal });
        if (response.status === 401) { setAuthRequired(true); setNotice("Your session needs to be renewed. Your answers remain safe on this device."); return; }
        if (!response.ok) return;
        const status = await response.json() as AttemptStatus;
        setAuthRequired(false);
        if (status.status !== "in_progress" || status.assignmentStatus !== "published" || status.expiresAt !== expiresAt || !status.examMode || status.examMode.requireFullscreen !== examMode.requireFullscreen || status.examMode.trackFocusExits !== examMode.trackFocusExits || status.examMode.allowedFocusExits !== examMode.allowedFocusExits || status.examMode.violationAction !== examMode.violationAction) router.refresh();
      } catch { /* Autosave owns the visible connection state; status polling is best-effort. */ }
      finally { window.clearTimeout(timeout); }
    };
    const timer = window.setInterval(() => void refreshIfChanged(), 15_000);
    window.addEventListener("online", refreshIfChanged);
    return () => { window.clearInterval(timer); window.removeEventListener("online", refreshIfChanged); };
  }, [attemptId, examMode, expiresAt, router]);

  useEffect(() => {
    if (!examMode || responsesClosed || autoSubmitted) return;
    const recordFullscreenExit = (keepalive = false) => {
      if (!examMode.requireFullscreen || autoSubmitKnown.current || !fullscreenExitTracker.current.beginExit()) return;
      setFullscreenBlocked(true);
      void logActivity("fullscreen_exited", undefined, true, keepalive);
    };
    const enforceFullscreen = (keepalive = false) => {
      if (examMode.requireFullscreen && !isFullscreenActive()) recordFullscreenExit(keepalive);
    };
    const visibility = () => {
      if (document.visibilityState === "hidden") {
        awayAt.current = Date.now();
        sendPendingBeacon();
        if (examMode.requireFullscreen) recordFullscreenExit(true);
        else if (examMode.trackFocusExits) void logActivity("page_hidden", undefined, true, true);
      } else {
        const duration = awayAt.current ? Math.round((Date.now() - awayAt.current) / 1000) : undefined;
        awayAt.current = null;
        enforceFullscreen();
        window.setTimeout(() => void logActivity("page_visible", duration), 150);
      }
    };
    const blur = () => { if (document.visibilityState === "visible") { if (examMode.requireFullscreen) recordFullscreenExit(true); void logActivity("window_blur"); } };
    const focus = () => { if (document.visibilityState === "visible") { enforceFullscreen(); void logActivity("window_focus"); } };
    const pageHide = () => { sendPendingBeacon(); if (examMode.requireFullscreen) recordFullscreenExit(true); };
    const fullscreen = () => enforceFullscreen();

    if (examMode.requireFullscreen && !isFullscreenActive()) window.setTimeout(recordFullscreenExit, 0);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("blur", blur);
    window.addEventListener("focus", focus);
    window.addEventListener("pagehide", pageHide);
    const unsubscribeFullscreen = subscribeToFullscreen(fullscreen);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("blur", blur);
      window.removeEventListener("focus", focus);
      window.removeEventListener("pagehide", pageHide);
      unsubscribeFullscreen();
    };
  }, [autoSubmitted, examMode, logActivity, responsesClosed, sendPendingBeacon]);

  useEffect(() => {
    if (!fullscreenBlocked || autoSubmitted) return;
    const previousOverflow = document.body.style.overflow;
    const keepFocusOnWarning = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      event.preventDefault();
      restoreButtonRef.current?.focus();
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", keepFocusOnWarning, true);
    window.setTimeout(() => restoreButtonRef.current?.focus(), 0);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", keepFocusOnWarning, true); };
  }, [autoSubmitted, fullscreenBlocked]);

  const restoreFullscreen = async () => {
    if (autoSubmitKnown.current || verifyingExit || restoringFullscreen.current) return;
    restoringFullscreen.current = true;
    setVerifyingExit(true);
    try {
      if (!canRequestFullscreen()) throw new Error("unsupported");
      const recovery = await restoreFullscreenBeforeVerification(
        () => requestAppFullscreen(),
        () => { fullscreenExitTracker.current.markRestored(); return flushExamActivityQueue(attemptId); },
      );
      if (!recovery.restored) throw new Error("not-entered");
      const queuedResult = recovery.result; applyActivityResult(queuedResult);
      if (queuedResult && "error" in queuedResult) {
        if (examMode?.violationAction === "warn" && isFullscreenActive()) { setFullscreenBlocked(false); setExamWarning("This interruption is safely queued on this device and will synchronize when the connection returns."); }
        return;
      }
      if (autoSubmitKnown.current) return;
      const restoredResult = await sendExamActivity(attemptId, "fullscreen_restored"); applyActivityResult(restoredResult);
      if (restoredResult && !("error" in restoredResult) && !autoSubmitKnown.current && isFullscreenActive()) { setFullscreenBlocked(false); setExamWarning(""); }
    }
    catch { setVerifyingExit(false); await logActivity("fullscreen_unavailable"); setExamWarning("Fullscreen could not be restored. Try again to continue the assessment."); }
    finally { restoringFullscreen.current = false; }
  };

  const checkFeedback = async (questionId: string, answer: string) => {
    if (examMode?.requireFullscreen && (fullscreenBlocked || !isFullscreenActive())) { setFullscreenBlocked(true); return; }
    setCheckingQuestionId(questionId);
    try {
      if (!(await syncPending())) { setNotice("Feedback will be available after this answer synchronizes."); setCheckingQuestionId(null); return; }
      const result = await saveStudentResponseWithFeedback(attemptId, questionId, answer);
      if ("error" in result) setNotice(result.error);
      else setFeedback((current) => ({ ...current, [questionId]: { isCorrect: result.isCorrect, pointsAwarded: result.pointsAwarded } }));
    } catch { setNotice("Feedback is waiting for a connection. Your answer remains saved on this device."); }
    setCheckingQuestionId(null);
  };
  const save = (questionId: string, answer: string, checkImmediately = false) => { if (responsesClosed || fullscreenBlocked || (examMode?.requireFullscreen && !isFullscreenActive()) || autoSubmitted || (deadline !== null && remaining === 0)) { if (examMode?.requireFullscreen && !isFullscreenActive()) setFullscreenBlocked(true); return; } queueAnswer(questionId, answer); if (checkImmediately) void checkFeedback(questionId, answer); };

  const submit = useCallback((timed = false) => {
    if (submitting || autoSubmitted || (!timed && !responsesClosed && (fullscreenBlocked || (examMode?.requireFullscreen && !isFullscreenActive())))) { if (!timed && examMode?.requireFullscreen && !isFullscreenActive()) setFullscreenBlocked(true); return; }
    if (timed) timedSubmissionPending.current = true;
    if (!responsesClosed && !submissionRef.current) submissionRef.current = {
      responses: responseSnapshot(),
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
  }, [attemptId, autoSubmitted, deadline, examMode, fullscreenBlocked, responseSnapshot, responsesClosed, router, submitting]);

  useEffect(() => {
    if (deadline === null || remaining > 0 || responsesClosed || autoSubmitted || timedSubmitStarted.current) return;
    timedSubmitStarted.current = true;
    submit(true);
  }, [autoSubmitted, deadline, remaining, responsesClosed, submit]);
  useEffect(() => {
    if (!timedSubmissionPending.current) return;
    const retry = window.setInterval(() => { if (navigator.onLine && !submitting) submit(true); }, 10_000);
    return () => window.clearInterval(retry);
  }, [submit, submitting]);

  const clock = `${String(Math.floor(remaining / 60_000)).padStart(2, "0")}:${String(Math.floor((remaining % 60_000) / 1000)).padStart(2, "0")}`;
  const timeEnded = deadline !== null && remaining === 0;
  const interactionBlocked = fullscreenBlocked || Boolean(examMode?.requireFullscreen && !fullscreenActive) || autoSubmitted || timeEnded;
  const displayQuestions = questionDisplayMode === "all_at_once" ? questions.map((question, index) => ({ question, index })) : questions[currentQuestion] ? [{ question: questions[currentQuestion], index: currentQuestion }] : [];
  const inputDisabled = responsesClosed || interactionBlocked;
  const syncLabel = syncState === "saved" ? "All answers saved" : syncState === "saving" ? "Saving answers…" : syncState === "offline" ? "Offline · answers safe on this device" : "Answers need attention";

  return <section className={`runner ${interactionBlocked ? styles.runnerBlocked : ""}`}><div className="runner-header"><div><p className="eyebrow">{examMode ? "Secure mode · Exam Mode" : "Active attempt"}</p><h2>{questions.length} questions</h2><div className={styles.runnerStatus}><span className={`${styles.syncStatus} ${styles[syncState]}`}>{syncLabel}</span>{formCode && <span>Form {formCode}</span>}{examMode && <><span>Focus exits: {focusViolations} · allowance {examMode.allowedFocusExits}</span><span>{wakeLockState === "active" ? "Screen sleep blocked" : wakeLockState === "requesting" ? "Blocking screen sleep…" : "Keep laptop awake manually"}</span></>}</div></div><div className={styles.meta}>{deadline && <strong className={timeEnded ? "timer-expired" : ""}>Time remaining: {clock}</strong>}</div></div>{examWarning && !interactionBlocked && <section className={styles.warning} role="status"><strong>Exam Mode activity</strong><p>{examWarning}</p></section>}{responsesClosed && <p className="form-note lifecycle-note">Overdue. Answers can no longer be changed. Submitting now grades only work already synchronized to the server.</p>}
    {questionDisplayMode === "one_at_a_time" && <nav aria-label="Question navigation" className={`${styles.questionNavigator} ${examMode ? styles.secureNavigator : ""}`}>{questions.map((question, index) => { const itemFeedback = feedback[question.id]; const state = itemFeedback ? itemFeedback.isCorrect ? styles.correct : styles.incorrect : answers[question.id]?.trim() ? styles.answered : ""; return <button aria-current={index === currentQuestion ? "step" : undefined} aria-label={`Question ${index + 1}: ${itemFeedback ? itemFeedback.isCorrect ? "correct" : "incorrect" : answers[question.id]?.trim() ? "answered" : "not answered"}`} className={`${styles.questionNavButton} ${index === currentQuestion ? styles.active : ""} ${state}`} disabled={interactionBlocked} key={question.id} onClick={() => setCurrentQuestion(index)} type="button">{index + 1}</button>; })}</nav>}
    {displayQuestions.map(({ question, index }) => { const itemFeedback = feedback[question.id]; return <article className="student-question" key={question.id}><div className="question-number">Question {index + 1} · {question.points} {question.points === 1 ? "point" : "points"}</div><div className="question-prompt"><MathText>{question.prompt}</MathText></div>{question.type === "multiple_choice" ? <div className="answer-options">{question.options?.map((option, optionIndex) => <label key={option.id}><input checked={answers[question.id] === option.id} disabled={inputDisabled} name={question.id} onChange={() => save(question.id, option.id, showFeedbackAfterEachQuestion)} type="radio" /><b>{String.fromCharCode(65 + optionIndex)}</b><MathText>{option.text}</MathText></label>)}</div> : <><label className="answer-text">Your answer<input disabled={inputDisabled} onChange={(event) => save(question.id, event.target.value)} value={answers[question.id] ?? ""} /></label>{showFeedbackAfterEachQuestion && <button className="secondary-inline-button" disabled={inputDisabled || checkingQuestionId === question.id} onClick={() => void checkFeedback(question.id, answers[question.id] ?? "")} type="button">{checkingQuestionId === question.id ? "Checking..." : "Check answer"}</button>}</>}{showFeedbackAfterEachQuestion && itemFeedback && <p className={itemFeedback.isCorrect ? styles.feedbackCorrect : styles.feedbackIncorrect}>{itemFeedback.isCorrect ? `Correct · ${itemFeedback.pointsAwarded} points` : "Try again."}</p>}</article>; })}
    {questionDisplayMode === "one_at_a_time" && <div className={styles.questionControls}><button className="secondary-inline-button" disabled={interactionBlocked || currentQuestion === 0} onClick={() => setCurrentQuestion((current) => current - 1)} type="button">← Previous</button>{currentQuestion === questions.length - 1 ? <button className="teacher-button" disabled={submitting || interactionBlocked} onClick={() => submit(false)} type="button">{submitting ? "Submitting..." : "Submit assessment"} <span aria-hidden="true">→</span></button> : <button className="secondary-inline-button" disabled={interactionBlocked} onClick={() => setCurrentQuestion((current) => current + 1)} type="button">Next question →</button>}</div>}
    {notice && <p className={syncState === "offline" ? styles.connectionNotice : "notice notice-error"} role="status">{notice}{authRequired && <> <a href={`/login?returnTo=${encodeURIComponent(window.location.pathname)}`}>Sign in again and return to this test.</a></>}</p>}{questionDisplayMode === "all_at_once" && <button className="teacher-button" disabled={submitting || interactionBlocked} onClick={() => submit(false)} type="button">{submitting ? "Submitting..." : "Submit assignment"} <span aria-hidden="true">→</span></button>}{interactionBlocked && <section aria-live="assertive" className={`${styles.blockOverlay} ${(fullscreenBlocked || (examMode?.requireFullscreen && !fullscreenActive)) && !timeEnded && !autoSubmitted ? styles.fullscreenAlert : ""}`} role="alert">{autoSubmitted ? <><p className="eyebrow">Assessment submitted</p><h2>Exam Mode submitted your work.</h2><p>The configured focus-exit limit was exceeded. Your latest browser snapshot was saved before submission, and the local recovery copy remains on this device.</p></> : (fullscreenBlocked || (examMode?.requireFullscreen && !fullscreenActive)) && !timeEnded ? <><span aria-hidden="true" className={styles.alertIcon}>!</span><p className="eyebrow">Critical test security warning · Exit recorded</p><h2>NEVER EXIT FULLSCREEN.</h2><p>The entire test is locked while fullscreen is off. This interruption is being recorded and will be visible to your teacher. {examWarning || warningFor(focusViolations)}</p><strong className={styles.alertInstruction}>{verifyingExit ? "Do not leave this page. Your attempt status is being verified." : "Return to fullscreen immediately. Do not switch tabs, windows, or apps at any time during the test."}</strong><button className="teacher-button" disabled={verifyingExit} onClick={restoreFullscreen} ref={restoreButtonRef} type="button">{verifyingExit ? online ? "Checking attempt status…" : "Waiting for connection…" : "Return to fullscreen"} <span aria-hidden="true">→</span></button></> : <><p className="eyebrow">Time is up</p><h2>{submitting ? "Submitting your assessment…" : online ? "Finalizing your assessment…" : "Waiting for Wi-Fi"}</h2><p>{online ? "Your synchronized answers are being submitted." : "Keep this page open. Your answers are safe on this device and submission will retry after reconnection."}</p></>}</section>}</section>;
}
