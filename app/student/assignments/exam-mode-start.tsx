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

export default function ExamModeGate({ assignmentId, attempt, requireFullscreen, allowedFocusExits, violationAction, questionsReleased = true, instructions, onActive }: ExamModeGateProps) {
  const router = useRouter();
  const [notice, setNotice] = useState("");
  const [entering, setEntering] = useState(false);
  const [waitingForRelease, setWaitingForRelease] = useState(false);
  const startingRef = useRef(false);
  const fullscreenActive = useSyncExternalStore(subscribeToFullscreen, () => isFullscreenActive(), () => false);
  const resume = Boolean(attempt);

  const stopIfFullscreenWasLost = useCallback((attemptId: string) => {
    if (!requireFullscreen || isFullscreenActive()) return false;
    setNotice("You left fullscreen before the assessment was ready. The exit was recorded. Return to fullscreen to continue.");
    void sendExamActivity(attemptId, "fullscreen_exited", undefined, true);
    return true;
  }, [requireFullscreen]);

  const activateAttempt = useCallback(async () => {
    if (startingRef.current) return;
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
        setWaitingForRelease(false);
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
      setWaitingForRelease(false);
      const startedAttempt = { id: result.attemptId, expiresAt: result.expiresAt, formCode: result.formCode, focusViolations };
      if (onActive) onActive(startedAttempt); else router.refresh();
    } catch {
      setNotice("Exam Mode could not start. Please try again.");
    } finally {
      startingRef.current = false;
      setEntering(false);
    }
  }, [assignmentId, attempt, onActive, requireFullscreen, router, stopIfFullscreenWasLost]);

  const enter = async () => {
    if (entering || startingRef.current) return;
    setEntering(true);
    setNotice("");
    if (requireFullscreen && !isFullscreenActive()) {
      if (!canRequestFullscreen()) { setNotice("Fullscreen is not supported by this browser. Ask your teacher how to continue."); setEntering(false); return; }
      try { if (!(await requestAppFullscreen())) throw new Error("not-entered"); } catch { setNotice("The browser could not enter fullscreen. Close any permission prompt and try again."); setEntering(false); return; }
    }
    if (!attempt && !questionsReleased) {
      setWaitingForRelease(true);
      setEntering(false);
      return;
    }
    setEntering(false);
    await activateAttempt();
  };

  useEffect(() => {
    if (!waitingForRelease || questionsReleased) return;
    const interval = window.setInterval(() => router.refresh(), 2_000);
    return () => window.clearInterval(interval);
  }, [questionsReleased, router, waitingForRelease]);

  useEffect(() => {
    if (!waitingForRelease || !questionsReleased || (requireFullscreen && !fullscreenActive)) return;
    const timeout = window.setTimeout(() => void activateAttempt(), 0);
    return () => window.clearTimeout(timeout);
  }, [activateAttempt, fullscreenActive, questionsReleased, requireFullscreen, waitingForRelease]);

  if (waitingForRelease) return <section aria-busy={entering} className={`student-results ${styles.start} ${styles.waiting}`}><p className="eyebrow">Secure mode · Ready</p><h2>{questionsReleased ? "Your teacher released the test" : "Waiting for your teacher"}</h2><p>{instructions || "Read the assessment instructions carefully and wait here."}</p><div aria-live="polite" className={styles.waitingStatus}><span aria-hidden="true" /><strong>{questionsReleased ? "Starting your timed attempt…" : "Questions and timer are locked"}</strong></div><p className="form-note">Keep this page open. Your test will begin automatically after the teacher releases the questions.</p>{entering && <div aria-label="Loading assessment" className={styles.loadingTrack} role="progressbar"><span /></div>}{requireFullscreen && !fullscreenActive && <button className="teacher-button" disabled={entering} onClick={enter} type="button">Return to fullscreen <span aria-hidden="true">→</span></button>}{notice && <section className={styles.warning} role="alert"><strong>Exam Mode could not continue</strong><p>{notice}</p><button className="secondary-inline-button" disabled={entering} onClick={enter} type="button">Try again</button></section>}</section>;

  return <section aria-busy={entering} className={`student-results ${styles.start}`}><p className="eyebrow">Secure mode · Exam Mode</p><h2>{resume ? "Resume your assessment" : "Ready to begin?"}</h2><p>{requireFullscreen ? "This assessment must run in fullscreen." : "This assessment uses activity monitoring."} {questionsReleased ? "Questions stay protected until the server starts your timed attempt." : "You can read the instructions in fullscreen while the questions and timer wait for your teacher."}</p><p className={styles.gateDetail}>Focus exit allowance: {allowedFocusExits} · {violationAction === "auto_submit" ? "The next counted interruption after the allowance submits the assessment." : "Extra interruptions are flagged for teacher review."}</p><p className="form-note">Your answers are saved on this device during brief Wi-Fi interruptions. Exam Mode cannot fully lock a personal device.</p>{entering && <div aria-label="Loading assessment" className={styles.loadingTrack} role="progressbar"><span /></div>}<button className="teacher-button" disabled={entering} onClick={enter} type="button">{entering ? resume ? "Verifying secure session…" : "Preparing secure session…" : resume ? requireFullscreen ? "Return to fullscreen and continue" : "Continue assessment" : questionsReleased ? "Start timed assessment" : "Enter fullscreen and wait"} <span aria-hidden="true">→</span></button>{notice && <section className={styles.warning} role="alert"><strong>Exam Mode could not start</strong><p>{notice}</p><button className="secondary-inline-button" disabled={entering} onClick={enter} type="button">Try again</button></section>}</section>;
}
