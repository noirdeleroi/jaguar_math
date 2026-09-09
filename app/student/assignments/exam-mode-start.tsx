"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { startOrContinueExamAssignment } from "../actions";
import { sendExamActivity } from "./exam-activity-client";
import styles from "./exam-mode.module.css";

export type ExamAttempt = { id: string; expiresAt: string | null; formCode: string | null; focusViolations: number };

export default function ExamModeGate({ assignmentId, attempt, requireFullscreen, allowedFocusExits, violationAction, onActive }: { assignmentId: string; attempt?: ExamAttempt; requireFullscreen: boolean; allowedFocusExits: number; violationAction: "warn" | "auto_submit"; onActive?: (attempt: ExamAttempt) => void }) {
  const router = useRouter();
  const [notice, setNotice] = useState(""); const [entering, setEntering] = useState(false); const [pending, startTransition] = useTransition(); const resume = Boolean(attempt); const loading = pending || entering;
  const enter = async () => {
    if (pending || entering) return;
    setEntering(true); setNotice("");
    if (requireFullscreen && !document.fullscreenElement) {
      if (!document.documentElement.requestFullscreen) { setNotice("Fullscreen is not supported by this browser. Ask your teacher how to continue."); setEntering(false); return; }
      try { await document.documentElement.requestFullscreen(); } catch { setNotice("Chrome could not enter fullscreen. Close any browser permission prompt and try fullscreen again."); setEntering(false); return; }
      if (!document.fullscreenElement) { setNotice("Fullscreen was not entered. Try fullscreen again before continuing."); setEntering(false); return; }
    }
    if (attempt) {
      if (requireFullscreen) await sendExamActivity(attempt.id, "fullscreen_restored");
      setEntering(false); if (onActive) onActive(attempt); else router.refresh(); return;
    }
    startTransition(async () => {
      try {
        const result = await startOrContinueExamAssignment(assignmentId);
        if (result.error) { setNotice(result.error); setEntering(false); return; }
        if (requireFullscreen) await sendExamActivity(result.attemptId, "fullscreen_restored");
        setEntering(false);
        const startedAttempt = { id: result.attemptId, expiresAt: result.expiresAt, formCode: result.formCode, focusViolations: 0 };
        if (onActive) onActive(startedAttempt); else router.refresh();
      } catch { setNotice("Exam Mode could not start. Please try again."); setEntering(false); }
    });
  };
  return <section aria-busy={loading} className={`student-results ${styles.start}`}><p className="eyebrow">Secure mode · Exam Mode</p><h2>{resume ? "Resume your assessment" : "Ready to begin?"}</h2><p>{requireFullscreen ? "This assessment must run in fullscreen." : "This assessment uses activity monitoring."} Questions stay protected until the server starts your timed attempt.</p><p className={styles.gateDetail}>Focus exit allowance: {allowedFocusExits} · {violationAction === "auto_submit" ? "The next counted interruption after the allowance submits the assessment." : "Extra interruptions are flagged for teacher review."}</p><p className="form-note">Your answers are saved on this device during brief Wi-Fi interruptions. Exam Mode cannot fully lock a personal device.</p>{loading && <div aria-label="Loading assessment" className={styles.loadingTrack} role="progressbar"><span /></div>}<button className="teacher-button" disabled={loading} onClick={enter} type="button">{loading ? resume ? "Verifying secure session…" : "Loading your assessment…" : resume ? requireFullscreen ? "Return to fullscreen and continue" : "Continue assessment" : "Start timed assessment"} <span aria-hidden="true">→</span></button>{notice && <section className={styles.warning} role="alert"><strong>Exam Mode could not start</strong><p>{notice}</p><button className="secondary-inline-button" disabled={loading} onClick={enter} type="button">Try again</button></section>}</section>;
}
