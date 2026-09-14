"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { startOrContinueExamAssignment } from "../actions";
import { flushExamActivityQueue, sendExamActivity } from "./exam-activity-client";
import { canStartExamFromWaitingRoom } from "./exam-mode-attempt";
import { canRequestFullscreen, isFullscreenActive, requestAppFullscreen, subscribeToFullscreen } from "./fullscreen-api";
import styles from "./exam-mode.module.css";

export type ExamAttempt = { id: string; expiresAt: string | null; formCode: string | null; focusViolations: number };

type ExamModeGateProps = {
  assignmentId: string;
  attempt?: ExamAttempt;
  requireFullscreen: boolean;
  allowedFocusExits: number;
  violationAction: "warn" | "auto_submit";
  questionsReleased?: boolean;
  instructions?: string | null;
  durationMinutes?: number | null;
  onActive?: (attempt: ExamAttempt) => void;
};

export default function ExamModeGate({ assignmentId, attempt, requireFullscreen, questionsReleased = true, instructions, durationMinutes, onActive }: ExamModeGateProps) {
  const router = useRouter();
  const [notice, setNotice] = useState("");
  const [entering, setEntering] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [waitingRoomOpen, setWaitingRoomOpen] = useState(false);
  const [waitingRoomViolation, setWaitingRoomViolation] = useState(false);
  const startingRef = useRef(false);
  const restoreButtonRef = useRef<HTMLButtonElement>(null);
  const fullscreenActive = useSyncExternalStore(subscribeToFullscreen, () => isFullscreenActive(), () => false);
  const resume = Boolean(attempt);
  const waitingRoomStorageKey = `jaguar-test-waiting-room:${assignmentId}`;
  const fullscreenBlocked = waitingRoomOpen && requireFullscreen && (!fullscreenActive || waitingRoomViolation);
  const canStartTest = canStartExamFromWaitingRoom({ questionsReleased, requireFullscreen, fullscreenActive, waitingRoomViolation, starting: entering });

  const forgetWaitingRoom = useCallback(() => {
    try { sessionStorage.removeItem(waitingRoomStorageKey); } catch { /* Storage can be unavailable in privacy mode. */ }
  }, [waitingRoomStorageKey]);

  const stopIfFullscreenWasLost = useCallback((attemptId: string) => {
    if (!requireFullscreen || isFullscreenActive()) return false;
    setNotice("You left fullscreen before the assessment was ready. The exit was recorded. Return to fullscreen to continue.");
    void sendExamActivity(attemptId, "fullscreen_exited", undefined, true);
    return true;
  }, [requireFullscreen]);

  const activateAttempt = useCallback(async () => {
    if (startingRef.current || !questionsReleased || waitingRoomViolation || (requireFullscreen && !isFullscreenActive())) return;
    startingRef.current = true;
    setEntering(true);
    setLaunching(true);
    setNotice("");
    let keepLoading = false;
    try {
      if (attempt) {
        let verifiedAttempt = attempt;
        if (requireFullscreen) {
          const queued = await flushExamActivityQueue(attempt.id);
          if (queued && "error" in queued) { setNotice("Your previous fullscreen exit is saved on this device, but it could not be verified yet. Check the connection and try again."); return; }
          if (queued?.autoSubmitted) { keepLoading = true; forgetWaitingRoom(); router.refresh(); return; }
          if (queued) verifiedAttempt = { ...verifiedAttempt, focusViolations: Math.max(verifiedAttempt.focusViolations, queued.focusViolations) };
          if (stopIfFullscreenWasLost(attempt.id)) return;
          const result = await sendExamActivity(attempt.id, "fullscreen_restored");
          if (result && !("error" in result) && result.autoSubmitted) { keepLoading = true; forgetWaitingRoom(); router.refresh(); return; }
          if (result && !("error" in result)) verifiedAttempt = { ...verifiedAttempt, focusViolations: Math.max(verifiedAttempt.focusViolations, result.focusViolations) };
          if (stopIfFullscreenWasLost(attempt.id)) return;
        }
        keepLoading = true;
        forgetWaitingRoom();
        if (onActive) onActive(verifiedAttempt); else router.refresh();
        return;
      }

      const result = await startOrContinueExamAssignment(assignmentId);
      if (result.error) { setNotice(result.error); return; }
      let focusViolations = 0;
      if (requireFullscreen) {
        if (stopIfFullscreenWasLost(result.attemptId)) return;
        const activity = await sendExamActivity(result.attemptId, "fullscreen_restored");
        if (activity && !("error" in activity) && activity.autoSubmitted) { keepLoading = true; forgetWaitingRoom(); router.refresh(); return; }
        if (activity && !("error" in activity)) focusViolations = activity.focusViolations;
        if (stopIfFullscreenWasLost(result.attemptId)) return;
      }
      const startedAttempt = { id: result.attemptId, expiresAt: result.expiresAt, formCode: result.formCode, focusViolations };
      keepLoading = true;
      forgetWaitingRoom();
      if (onActive) onActive(startedAttempt); else router.refresh();
    } catch {
      setNotice("Exam Mode could not start. Please try again.");
    } finally {
      startingRef.current = false;
      if (!keepLoading) { setEntering(false); setLaunching(false); }
    }
  }, [assignmentId, attempt, forgetWaitingRoom, onActive, questionsReleased, requireFullscreen, router, stopIfFullscreenWasLost, waitingRoomViolation]);

  const enterWaitingRoom = async () => {
    if (entering || startingRef.current) return;
    setEntering(true);
    setNotice("");
    if (requireFullscreen && !isFullscreenActive()) {
      if (!canRequestFullscreen()) { setNotice("Fullscreen is not supported by this browser. Ask your teacher how to continue."); setEntering(false); return; }
      try { if (!(await requestAppFullscreen())) throw new Error("not-entered"); } catch { setNotice("The browser could not enter fullscreen. Close any permission prompt and try again."); setEntering(false); return; }
    }
    setWaitingRoomViolation(false);
    try { sessionStorage.setItem(waitingRoomStorageKey, "armed"); } catch { /* The in-memory lock remains active. */ }
    setWaitingRoomOpen(true);
    setEntering(false);
  };

  const restoreFullscreen = async () => {
    if (entering) return;
    setEntering(true);
    setNotice("");
    try {
      if (!canRequestFullscreen() || !(await requestAppFullscreen())) throw new Error("not-entered");
      setWaitingRoomViolation(false);
    } catch {
      setNotice("Fullscreen could not be restored. You cannot start or continue the test until you return to fullscreen.");
    } finally {
      setEntering(false);
    }
  };

  useEffect(() => {
    try {
      if (sessionStorage.getItem(waitingRoomStorageKey) !== "armed") return;
      const timeout = window.setTimeout(() => setWaitingRoomOpen(true), 0);
      return () => window.clearTimeout(timeout);
    } catch { /* The current component state still protects this visit. */ }
  }, [waitingRoomStorageKey]);

  useEffect(() => {
    if (!waitingRoomOpen || !requireFullscreen) return;
    const blockWaitingRoom = () => setWaitingRoomViolation(true);
    const fullscreen = () => { if (!isFullscreenActive()) blockWaitingRoom(); };
    const visibility = () => { if (document.visibilityState === "hidden") blockWaitingRoom(); };

    // Waiting-room incidents lock the UI locally but are intentionally not
    // sent to exam activity because the timed attempt has not started.
    const initialCheck = !isFullscreenActive() ? window.setTimeout(blockWaitingRoom, 0) : undefined;
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("blur", blockWaitingRoom);
    window.addEventListener("pagehide", blockWaitingRoom);
    const unsubscribeFullscreen = subscribeToFullscreen(fullscreen);
    return () => {
      if (initialCheck !== undefined) window.clearTimeout(initialCheck);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("blur", blockWaitingRoom);
      window.removeEventListener("pagehide", blockWaitingRoom);
      unsubscribeFullscreen();
    };
  }, [requireFullscreen, waitingRoomOpen]);

  useEffect(() => {
    if (!waitingRoomOpen || questionsReleased) return;
    const interval = window.setInterval(() => router.refresh(), 2_000);
    return () => window.clearInterval(interval);
  }, [questionsReleased, router, waitingRoomOpen]);

  useEffect(() => {
    if (!fullscreenBlocked) return;
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
  }, [fullscreenBlocked]);

  if (waitingRoomOpen) return <section aria-busy={entering} className={`student-results ${styles.start} ${styles.waiting}`}><p className="eyebrow">Secure mode · Test waiting room</p><h2>{questionsReleased ? resume ? "Your test is ready to continue" : "Your test is ready" : "Wait for your teacher to release the test"}</h2><div className={styles.examDetails}><div className={styles.timeCard}><span>Exam time</span><strong>{durationMinutes ? `${durationMinutes} minutes` : "No time limit"}</strong></div><table className={styles.gradingTable}><caption>Grading</caption><tbody><tr><th scope="row">95–100%</th><td>A*</td></tr><tr><th scope="row">85–94%</th><td>A</td></tr><tr><th scope="row">75–84%</th><td>B</td></tr><tr><th scope="row">65–74%</th><td>C</td></tr><tr><th scope="row">64% and below</th><td>Fail</td></tr></tbody></table></div><p className={styles.instructionsLead}>Read these rules before you begin:</p><ul className={styles.instructions}><li><strong>Never exit fullscreen</strong> or switch to another tab, window, or app during the test.</li><li><strong>Answer every question.</strong> Your grade is based on the answers you submit.</li><li>If a question is difficult, move to another one and return to it before submitting.</li><li>Review your answers before you submit the test.</li></ul>{instructions && <div className={styles.teacherInstructions}><strong>Teacher instructions</strong><p>{instructions}</p></div>}<div aria-live="polite" className={`${styles.waitingStatus} ${questionsReleased ? styles.readyStatus : ""}`}><span aria-hidden="true" /><strong>{questionsReleased ? "Ready — start when you are prepared" : "Your teacher has not released the test"}</strong></div>{entering && !launching && <div aria-label="Loading assessment" className={styles.loadingTrack} role="progressbar"><span /></div>}<button aria-describedby={!questionsReleased ? "teacher-start-instruction" : undefined} className={`teacher-button ${!questionsReleased ? styles.lockedStartButton : ""}`} disabled={!canStartTest} onClick={() => void activateAttempt()} type="button">{launching ? "Starting test…" : resume ? "CONTINUE TEST" : "START TEST"} <span aria-hidden="true">→</span></button>{!questionsReleased && <p className="form-note" id="teacher-start-instruction"><strong>Your teacher will release the test when it is time to begin.</strong> The START TEST button is locked. Keep this page open in fullscreen.</p>}{notice && !fullscreenBlocked && <section className={styles.warning} role="alert"><strong>Exam Mode could not continue</strong><p>{notice}</p></section>}{launching && !fullscreenBlocked && <section aria-live="polite" aria-busy="true" className={`${styles.blockOverlay} ${styles.launchOverlay}`} role="status"><span aria-hidden="true" className={styles.loadingSpinner} /><p className="eyebrow">Secure test</p><h2>Starting your test…</h2><p>Loading your questions and starting the timer. Keep this window open.</p></section>}{fullscreenBlocked && <section aria-live="assertive" className={`${styles.blockOverlay} ${styles.fullscreenAlert}`} role="alert"><span aria-hidden="true" className={styles.alertIcon}>!</span><p className="eyebrow">Critical waiting-room security warning</p><h2>DO NOT EXIT FULLSCREEN.</h2><p>The waiting room is completely locked because you left fullscreen. This is not counted as an exam exit because your test has not started.</p><strong className={styles.alertInstruction}>Return to fullscreen immediately. Do not switch tabs, windows, or apps while you wait for the test.</strong><button className="teacher-button" disabled={entering} onClick={() => void restoreFullscreen()} ref={restoreButtonRef} type="button">{entering ? "Restoring fullscreen…" : "Return to fullscreen"} <span aria-hidden="true">→</span></button>{notice && <p className={styles.blockError}>{notice}</p>}</section>}</section>;

  return <section aria-busy={entering} className={`student-results ${styles.start}`}><p className="eyebrow">Secure mode · Exam Mode</p><h2>{resume ? "Return to your secure test" : "Enter fullscreen to begin"}</h2><p>First, enter fullscreen. You will then see the test rules and the {resume ? "CONTINUE TEST" : "START TEST"} button.</p><p className={styles.gateDetail}>Once you enter the secure waiting room, leaving fullscreen locks the entire test.</p>{entering && <div aria-label="Entering fullscreen" className={styles.loadingTrack} role="progressbar"><span /></div>}<button className="teacher-button" disabled={entering} onClick={() => void enterWaitingRoom()} type="button">{entering ? "Entering fullscreen…" : "Enter fullscreen"} <span aria-hidden="true">→</span></button>{notice && <section className={styles.warning} role="alert"><strong>Exam Mode could not open</strong><p>{notice}</p><button className="secondary-inline-button" disabled={entering} onClick={() => void enterWaitingRoom()} type="button">Try again</button></section>}</section>;
}
