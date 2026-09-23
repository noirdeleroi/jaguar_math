"use client";

import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { closeAssignment, forceSubmitAllAssessmentAttempts, releasePaperAnswers, startPaperSession } from "../assignment-actions";
import styles from "./paper-session-controls.module.css";

const remaining = (endsAt: string | null, now: number) => endsAt ? Math.max(0, new Date(endsAt).getTime() - now) : 0;
const clock = (milliseconds: number) => {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
};

export default function PaperSessionControls({ assignmentId, answerDurationSeconds, answersReleasedAt, durationMinutes, serverNow, writingEndsAt, writingStartedAt }: { assignmentId: string; answerDurationSeconds: number; answersReleasedAt: string | null; durationMinutes: number; serverNow: string; writingEndsAt: string | null; writingStartedAt: string | null }) {
  const [clockState, setClockState] = useState(() => ({ now: new Date(serverNow).getTime(), offset: new Date(serverNow).getTime() - Date.now() }));
  useEffect(() => { const timer = window.setInterval(() => setClockState((current) => ({ ...current, now: Date.now() + current.offset })), 250); return () => window.clearInterval(timer); }, []);
  const now = clockState.now;
  const writingLeft = remaining(writingEndsAt, now);
  const answerEndsAt = answersReleasedAt ? new Date(new Date(answersReleasedAt).getTime() + answerDurationSeconds * 1000).toISOString() : null;
  const answerLeft = remaining(answerEndsAt, now);
  const phase = answersReleasedAt ? "answers" : writingStartedAt ? writingLeft > 0 ? "writing" : "pens-down" : "ready";

  return <section className={styles.panel}>
    <div className={styles.heading}><div><p className="eyebrow">Paper test session</p><h2>{phase === "ready" ? "Students are joining the waiting room" : phase === "writing" ? "Writing timer is live" : phase === "pens-down" ? "Writing time has ended" : answerLeft > 0 ? "Answer entry is open" : "Answer time has ended"}</h2><p>{phase === "ready" ? "When students are ready in fullscreen, start one synchronized writing timer for the class." : phase === "writing" ? "Students see the same countdown and work only on their printed paper." : phase === "pens-down" ? `Tell students to stop writing, then open the ${answerDurationSeconds}-second answer-entry window.` : "Every answer saves as it is entered. Individual deadlines and progress appear in the paper answer manager below."}</p></div><div className={styles.clock}><span>{phase === "answers" ? "Shared answer window" : "Writing time"}</span><strong>{phase === "ready" ? `${durationMinutes}:00` : phase === "answers" ? clock(answerLeft) : clock(writingLeft)}</strong></div></div>
    <ol className={styles.steps}><li className={phase !== "ready" ? styles.done : styles.current}><span>1</span><div><strong>Start writing</strong><small>{writingStartedAt ? "Started" : "Waiting"}</small></div></li><li className={phase === "answers" ? styles.done : phase === "pens-down" ? styles.current : ""}><span>2</span><div><strong>Pens down</strong><small>{phase === "pens-down" || phase === "answers" ? "Writing ended" : "Automatic at zero"}</small></div></li><li className={phase === "answers" ? styles.current : ""}><span>3</span><div><strong>Enter answers</strong><small>{answersReleasedAt ? `${answerDurationSeconds} seconds` : "Teacher release"}</small></div></li></ol>
    <div className={styles.actions}>{phase === "ready" && <form action={startPaperSession} onSubmit={(event) => { if (!window.confirm(`Start the ${durationMinutes}-minute writing timer for every student now?`)) event.preventDefault(); }}><input name="assignment_id" type="hidden" value={assignmentId} /><PendingButton label="Start paper test" pendingLabel="Starting timer…" /></form>}{phase === "writing" && <p className={styles.locked}>Answer entry unlocks when the writing timer reaches 00:00.</p>}{phase === "pens-down" && <form action={releasePaperAnswers} onSubmit={(event) => { if (!window.confirm(`Open answer entry for ${answerDurationSeconds} seconds? Waiting students will switch automatically.`)) event.preventDefault(); }}><input name="assignment_id" type="hidden" value={assignmentId} /><PendingButton label={`Open ${answerDurationSeconds}-second answer entry`} pendingLabel="Opening answers…" /></form>}{phase === "answers" && <><form action={forceSubmitAllAssessmentAttempts} onSubmit={(event) => { if (!window.confirm("Submit every active student's latest saved answers now?")) event.preventDefault(); }}><input name="assignment_id" type="hidden" value={assignmentId} /><PendingButton label="Submit all active now" pendingLabel="Submitting…" quiet /></form><form action={closeAssignment} onSubmit={(event) => { if (!window.confirm("Close this paper test? Active saved answers will be submitted and no student can continue.")) event.preventDefault(); }}><input name="assignment_id" type="hidden" value={assignmentId} /><PendingButton label="Close paper test" pendingLabel="Closing…" /></form></>}</div>
  </section>;
}

function PendingButton({ label, pendingLabel, quiet = false }: { label: string; pendingLabel: string; quiet?: boolean }) {
  const { pending } = useFormStatus();
  return <button className={quiet ? "secondary-inline-button" : "teacher-button"} disabled={pending} type="submit">{pending ? pendingLabel : label}</button>;
}
