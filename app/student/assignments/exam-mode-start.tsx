"use client";

import { useState, useTransition } from "react";
import { startOrContinueExamAssignment } from "../actions";
import { sendExamActivity } from "./exam-activity-client";
import styles from "./exam-mode.module.css";

export type ExamAttempt = { id: string; startedAt: string; focusViolations: number };

export default function ExamModeGate({ assignmentId, attempt, requireFullscreen, allowedFocusExits, violationAction, onActive }: { assignmentId: string; attempt?: ExamAttempt; requireFullscreen: boolean; allowedFocusExits: number; violationAction: "warn" | "auto_submit"; onActive: (attempt: ExamAttempt) => void }) {
  const [notice, setNotice] = useState(""); const [entering, setEntering] = useState(false); const [pending, startTransition] = useTransition(); const resume = Boolean(attempt);
  const enter = async () => {
    if (pending || entering) return;
    setEntering(true); setNotice("");
    if (requireFullscreen) {
      if (!document.documentElement.requestFullscreen) { setNotice("Fullscreen is not supported by this browser. Ask your teacher how to continue."); setEntering(false); return; }
      try { await document.documentElement.requestFullscreen(); } catch { setNotice("Chrome could not enter fullscreen. Close any browser permission prompt and try fullscreen again."); setEntering(false); return; }
      if (!document.fullscreenElement) { setNotice("Fullscreen was not entered. Try fullscreen again before continuing."); setEntering(false); return; }
    }
    if (attempt) {
      if (requireFullscreen) await sendExamActivity(attempt.id, "fullscreen_restored");
      setEntering(false); onActive(attempt); return;
    }
    startTransition(async () => {
      try {
        const result = await startOrContinueExamAssignment(assignmentId);
        if (result.error) { setNotice(result.error); setEntering(false); return; }
        if (requireFullscreen) await sendExamActivity(result.attemptId, "fullscreen_restored");
        setEntering(false);
        onActive({ id: result.attemptId, startedAt: result.startedAt, focusViolations: 0 });
      } catch { setNotice("Exam Mode could not start. Please try again."); setEntering(false); }
    });
  };
  return <section className={`student-results ${styles.start}`}><p className="eyebrow">Exam Mode</p><h2>{resume ? "Resume Exam Mode" : "Ready to begin?"}</h2><p>{requireFullscreen ? "This assessment must run in fullscreen." : "This assessment uses Exam Mode activity monitoring."} Leaving this tab or exiting fullscreen will be recorded.</p><p className={styles.gateDetail}>Focus exit limit: {allowedFocusExits} · Action: {violationAction === "auto_submit" ? "Auto-submit" : "Warn"}</p><p className="form-note">Exam Mode can detect page and fullscreen interruptions, but it cannot fully lock your device.</p><button className="teacher-button" disabled={pending || entering} onClick={enter} type="button">{pending || entering ? "Entering Exam Mode..." : resume ? requireFullscreen ? "Return to fullscreen and continue" : "Continue Exam Mode" : "Enter Exam Mode"} <span aria-hidden="true">→</span></button>{notice && <section className={styles.warning} role="alert"><strong>Fullscreen is required</strong><p>{notice}</p><button className="secondary-inline-button" disabled={pending || entering} onClick={enter} type="button">Try fullscreen again</button></section>}</section>;
}
