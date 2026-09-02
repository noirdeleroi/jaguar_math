"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { recordExamActivity, startOrContinueExamAssignment } from "../actions";
import styles from "./exam-mode.module.css";

export default function ExamModeStart({ assignmentId, requireFullscreen }: { assignmentId: string; requireFullscreen: boolean }) {
  const router = useRouter(); const [notice, setNotice] = useState(""); const [pending, startTransition] = useTransition();
  const begin = () => {
    if (pending) return;
    startTransition(async () => {
      setNotice(""); let fullscreenIssue = false;
      if (requireFullscreen) {
        try { if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen(); else fullscreenIssue = true; } catch { fullscreenIssue = true; }
      }
      const result = await startOrContinueExamAssignment(assignmentId);
      if (result.error) { setNotice(result.error); return; }
      if (fullscreenIssue) {
        await recordExamActivity(result.attemptId, crypto.randomUUID(), "fullscreen_unavailable");
        setNotice("Fullscreen is unavailable in this browser. You can continue; your teacher may see that it was not entered.");
      }
      router.refresh();
    });
  };
  return <section className={`student-results ${styles.start}`}><p className="eyebrow">Exam Mode</p><h2>Ready to begin?</h2><p>{requireFullscreen ? "This assessment will request fullscreen." : "This assessment uses Exam Mode activity monitoring."} Leaving this tab/window or exiting fullscreen may be recorded. Your teacher may see focus interruptions.</p><p className="form-note">Exam Mode can detect page and fullscreen interruptions, but it cannot fully lock your device.</p><button className="teacher-button" disabled={pending} onClick={begin} type="button">{pending ? "Starting Exam Mode..." : "Enter Exam Mode"} <span aria-hidden="true">→</span></button>{notice && <p className="notice notice-error" role="status">{notice}</p>}</section>;
}
