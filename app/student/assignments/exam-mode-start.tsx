"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { startOrContinueExamAssignment } from "../actions";
import { flushExamActivityQueue, sendExamActivity } from "./exam-activity-client";
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
  onActive?: (attempt: ExamAttempt) => void;
};

export default function ExamModeGate({ assignmentId, attempt, requireFullscreen, questionsReleased = true, instructions, onActive }: ExamModeGateProps) {
  const router = useRouter();
  const [notice, setNotice] = useState("");
  const [entering, setEntering] = useState(false);
  const [waitingRoomOpen, setWaitingRoomOpen] = useState(false);
  const startingRef = useRef(false);
  const restoreButtonRef = useRef<HTMLButtonElement>(null);
  const fullscreenActive = useSyncExternalStore(subscribeToFullscreen, () => isFullscreenActive(), () => false);
  const resume = Boolean(attempt);
  const fullscreenBlocked = waitingRoomOpen && requireFullscreen && !fullscreenActive;

  const stopIfFullscreenWasLost = useCallback((attemptId: string) => {
    if (!requireFullscreen || isFullscreenActive()) return false;
    setNotice("You left fullscreen before the assessment was ready. The exit was recorded. Return to fullscreen to continue.");
    void sendExamActivity(attemptId, "fullscreen_exited", undefined, true);
    return true;
  }, [requireFullscreen]);

  const activateAttempt = useCallback(async () => {
    if (startingRef.current || !questionsReleased || (requireFullscreen && !isFullscreenActive())) return;
    startingRef.current = true;
    setEntering(true);
    setNotice("");
    try {
      if (attempt) {
        let verifiedAttempt = attempt;
        if (requireFullscreen) {
          const queued = await flushExamActivityQueue(attempt.id);
          if (queued && "error" in queued) { setNotice("Your previous fullscreen exit is saved on this device, but it could not be verified yet. Check the connection and try again."); return; }
          if (queued?.autoSubmitted) { router.refresh(); return; }
          if (queued) verifiedAttempt = { ...verifiedAttempt, focusViolations: Math.max(verifiedAttempt.focusViolations, queued.focusViolations) };
          if (stopIfFullscreenWasLost(attempt.id)) return;
          const result = await sendExamActivity(attempt.id, "fullscreen_restored");
          if (result && !("error" in result) && result.autoSubmitted) { router.refresh(); return; }
          if (result && !("error" in result)) verifiedAttempt = { ...verifiedAttempt, focusViolations: Math.max(verifiedAttempt.focusViolations, result.focusViolations) };
          if (stopIfFullscreenWasLost(attempt.id)) return;
        }
        if (onActive) onActive(verifiedAttempt); else router.refresh();
        return;
      }

      const result = await startOrContinueExamAssignment(assignmentId);
      if (result.error) { setNotice(result.error); return; }
      let focusViolations = 0;
      if (requireFullscreen) {
        if (stopIfFullscreenWasLost(result.attemptId)) return;
        const activity = await sendExamActivity(result.attemptId, "fullscreen_restored");
        if (activity && !("error" in activity) && activity.autoSubmitted) { router.refresh(); return; }
        if (activity && !("error" in activity)) focusViolations = activity.focusViolations;
        if (stopIfFullscreenWasLost(result.attemptId)) return;
      }
      const startedAttempt = { id: result.attemptId, expiresAt: result.expiresAt, formCode: result.formCode, focusViolations };
      if (onActive) onActive(startedAttempt); else router.refresh();
    } catch {
      setNotice("Exam Mode could not start. Please try again.");
    } finally {
      startingRef.current = false;
      setEntering(false);
    }
  }, [assignmentId, attempt, onActive, questionsReleased, requireFullscreen, router, stopIfFullscreenWasLost]);

  const enterWaitingRoom = async () => {
    if (entering || startingRef.current) return;
    setEntering(true);
    setNotice("");
    if (requireFullscreen && !isFullscreenActive()) {
      if (!canRequestFullscreen()) { setNotice("Fullscreen is not supported by this browser. Ask your teacher how to continue."); setEntering(false); return; }
      try { if (!(await requestAppFullscreen())) throw new Error("not-entered"); } catch { setNotice("The browser could not enter fullscreen. Close any permission prompt and try again."); setEntering(false); return; }
    }
    setWaitingRoomOpen(true);
    setEntering(false);
  };

  const restoreFullscreen = async () => {
    if (entering) return;
    setEntering(true);
    setNotice("");
    try {
      if (!canRequestFullscreen() || !(await requestAppFullscreen())) throw new Error("not-entered");
    } catch {
      setNotice("Fullscreen could not be restored. You cannot start or continue the test until you return to fullscreen.");
    } finally {
      setEntering(false);
    }
  };

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

  if (waitingRoomOpen) return <section aria-busy={entering} className={`student-results ${styles.start} ${styles.waiting}`}><p className="eyebrow">Secure mode · Test waiting room</p><h2>{questionsReleased ? resume ? "Your test is ready to continue" : "Your test is ready" : "Waiting for your teacher to start the test"}</h2><p className={styles.instructionsLead}>Read these rules before you begin:</p><ul className={styles.instructions}><li><strong>Never exit fullscreen</strong> or switch to another tab, window, or app during the test.</li><li><strong>Answer every question.</strong> Your grade is based on the answers you submit.</li><li>If a question is difficult, move to another one and return to it before submitting.</li><li>Review your answers before you submit the test.</li></ul>{instructions && <div className={styles.teacherInstructions}><strong>Teacher instructions</strong><p>{instructions}</p></div>}<div aria-live="polite" className={`${styles.waitingStatus} ${questionsReleased ? styles.readyStatus : ""}`}><span aria-hidden="true" /><strong>{questionsReleased ? "Ready — start when you are prepared" : "Questions and timer are locked"}</strong></div>{entering && <div aria-label="Loading assessment" className={styles.loadingTrack} role="progressbar"><span /></div>}<button className="teacher-button" disabled={entering || !questionsReleased || fullscreenBlocked} onClick={() => void activateAttempt()} type="button">{entering ? resume ? "Opening test…" : "Starting test…" : resume ? "CONTINUE TEST" : "START TEST"} <span aria-hidden="true">→</span></button>{!questionsReleased && <p className="form-note">The START TEST button will unlock when your teacher begins the test. Keep this page open in fullscreen.</p>}{notice && !fullscreenBlocked && <section className={styles.warning} role="alert"><strong>Exam Mode could not continue</strong><p>{notice}</p></section>}{fullscreenBlocked && <section aria-live="assertive" className={`${styles.blockOverlay} ${styles.fullscreenAlert}`} role="alert"><span aria-hidden="true" className={styles.alertIcon}>!</span><p className="eyebrow">Critical test security warning</p><h2>NEVER EXIT FULLSCREEN.</h2><p>The test is completely locked while fullscreen is off. You cannot start, continue, view questions, or enter answers until fullscreen is restored.</p><strong className={styles.alertInstruction}>Return to fullscreen immediately. Do not switch tabs, windows, or apps at any time during the test.</strong><button className="teacher-button" disabled={entering} onClick={() => void restoreFullscreen()} ref={restoreButtonRef} type="button">{entering ? "Restoring fullscreen…" : "Return to fullscreen"} <span aria-hidden="true">→</span></button>{notice && <p className={styles.blockError}>{notice}</p>}</section>}</section>;

  return <section aria-busy={entering} className={`student-results ${styles.start}`}><p className="eyebrow">Secure mode · Exam Mode</p><h2>{resume ? "Return to your secure test" : "Enter fullscreen to begin"}</h2><p>First, enter fullscreen. You will then see the test rules and the {resume ? "CONTINUE TEST" : "START TEST"} button.</p><p className={styles.gateDetail}>Once you enter the secure waiting room, leaving fullscreen locks the entire test.</p>{entering && <div aria-label="Entering fullscreen" className={styles.loadingTrack} role="progressbar"><span /></div>}<button className="teacher-button" disabled={entering} onClick={() => void enterWaitingRoom()} type="button">{entering ? "Entering fullscreen…" : "Enter fullscreen"} <span aria-hidden="true">→</span></button>{notice && <section className={styles.warning} role="alert"><strong>Exam Mode could not open</strong><p>{notice}</p><button className="secondary-inline-button" disabled={entering} onClick={() => void enterWaitingRoom()} type="button">Try again</button></section>}</section>;
}
