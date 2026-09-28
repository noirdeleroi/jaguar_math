"use client";

import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  closeAssignment,
  finishPaperWritingAndReleaseAnswers,
  forceSubmitAllAssessmentAttempts,
  pausePaperSession,
  resumePaperSession,
  setPaperWritingTime,
  startPaperSession,
} from "../assignment-actions";
import styles from "./paper-session-controls.module.css";

const remaining = (endsAt: string | null, now: number) => endsAt ? Math.max(0, new Date(endsAt).getTime() - now) : 0;
const clock = (milliseconds: number) => {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
};

type Props = {
  assignmentId: string;
  answerDurationSeconds: number;
  answersReleasedAt: string | null;
  durationMinutes: number;
  serverNow: string;
  writingEndsAt: string | null;
  writingPausedAt: string | null;
  writingStartedAt: string | null;
};

export default function PaperSessionControls({ assignmentId, answerDurationSeconds, answersReleasedAt, durationMinutes, serverNow, writingEndsAt, writingPausedAt, writingStartedAt }: Props) {
  const [clockState, setClockState] = useState(() => ({ now: new Date(serverNow).getTime(), offset: new Date(serverNow).getTime() - Date.now() }));
  useEffect(() => { const timer = window.setInterval(() => setClockState((current) => ({ ...current, now: Date.now() + current.offset })), 250); return () => window.clearInterval(timer); }, []);
  const now = clockState.now;
  const writingClockNow = writingPausedAt ? new Date(writingPausedAt).getTime() : now;
  const writingLeft = remaining(writingEndsAt, writingClockNow);
  const writingSeconds = Math.max(1, Math.ceil(writingLeft / 1000));
  const answerEndsAt = answersReleasedAt ? new Date(new Date(answersReleasedAt).getTime() + answerDurationSeconds * 1000).toISOString() : null;
  const answerLeft = remaining(answerEndsAt, now);
  const phase = answersReleasedAt ? "answers" : writingPausedAt ? "paused" : writingStartedAt ? writingLeft > 0 ? "writing" : "pens-down" : "ready";
  const heading = phase === "ready" ? "Students are joining the waiting room" : phase === "writing" ? "Writing timer is live" : phase === "paused" ? "Writing timer is paused" : phase === "pens-down" ? "Writing time has ended" : answerLeft > 0 ? "Answer entry is open" : "Answer time has ended";
  const description = phase === "ready" ? "When students are ready in fullscreen, start one synchronized writing timer for the class." : phase === "writing" ? "Students see the same countdown and work only on their printed paper." : phase === "paused" ? "The countdown is frozen on every connected student screen. Resume it when the class is ready." : phase === "pens-down" ? `Tell students to stop writing, then open the ${answerDurationSeconds}-second answer-entry window.` : "Every answer saves as it is entered. Individual deadlines and progress appear in the paper answer manager below.";
  const beforeAnswers = phase === "writing" || phase === "paused" || phase === "pens-down";

  return <section className={styles.panel}>
    <div className={styles.heading}><div><p className="eyebrow">Paper test session</p><h2>{heading}</h2><p>{description}</p></div><div className={`${styles.clock} ${phase === "paused" ? styles.pausedClock : ""}`}><span>{phase === "answers" ? "Shared answer window" : phase === "paused" ? "Writing time · paused" : "Writing time"}</span><strong>{phase === "ready" ? `${durationMinutes}:00` : phase === "answers" ? clock(answerLeft) : clock(writingLeft)}</strong></div></div>
    <ol className={styles.steps}><li className={phase !== "ready" ? styles.done : styles.current}><span>1</span><div><strong>Start writing</strong><small>{writingStartedAt ? phase === "paused" ? "Paused" : "Started" : "Waiting"}</small></div></li><li className={phase === "answers" ? styles.done : phase === "pens-down" ? styles.current : ""}><span>2</span><div><strong>Pens down</strong><small>{phase === "pens-down" || phase === "answers" ? "Writing ended" : "Automatic at zero"}</small></div></li><li className={phase === "answers" ? styles.current : ""}><span>3</span><div><strong>Enter answers</strong><small>{answersReleasedAt ? `${answerDurationSeconds} seconds` : "Teacher release"}</small></div></li></ol>
    {phase === "ready" && <div className={styles.actions}><form action={startPaperSession} onSubmit={(event) => { if (!window.confirm(`Start the ${durationMinutes}-minute writing timer for every student now?`)) event.preventDefault(); }}><input name="assignment_id" type="hidden" value={assignmentId} /><PendingButton label="Start paper test" pendingLabel="Starting timer…" /></form></div>}
    {beforeAnswers && <div className={styles.controlDeck}>
      <section className={styles.controlGroup}><div><strong>Timer control</strong><small>{phase === "paused" ? "The class countdown is stopped." : phase === "pens-down" ? "The writing countdown has reached zero." : "Pause the same timer for every student."}</small></div>{phase === "paused" ? <form action={resumePaperSession}><input name="assignment_id" type="hidden" value={assignmentId} /><PendingButton label="Resume timer" pendingLabel="Resuming…" /></form> : phase === "writing" ? <form action={pausePaperSession}><input name="assignment_id" type="hidden" value={assignmentId} /><PendingButton label="Pause timer" pendingLabel="Pausing…" quiet /></form> : null}</section>
      <section className={styles.controlGroup}><div><strong>Set time left</strong><small>Replace the class timer with an exact value.</small></div><form action={setPaperWritingTime} className={styles.timeForm} key={`${writingEndsAt}:${writingPausedAt}`} onSubmit={(event) => { if (!window.confirm("Change the remaining writing time for every student?")) event.preventDefault(); }}><input name="assignment_id" type="hidden" value={assignmentId} /><label><span>Minutes</span><input aria-label="Remaining minutes" defaultValue={Math.floor(writingSeconds / 60)} inputMode="numeric" max={1440} min={0} name="remaining_minutes" required type="number" /></label><b aria-hidden="true">:</b><label><span>Seconds</span><input aria-label="Remaining seconds" defaultValue={writingSeconds % 60} inputMode="numeric" max={59} min={0} name="remaining_seconds" required type="number" /></label><PendingButton label="Set time" pendingLabel="Updating…" quiet /></form></section>
      <section className={`${styles.controlGroup} ${styles.releaseGroup}`}><div><strong>Move to answer entry</strong><small>End writing now and open the {answerDurationSeconds}-second answer window for all students.</small></div><form action={finishPaperWritingAndReleaseAnswers} onSubmit={(event) => { if (!window.confirm("End writing for everyone and open answer entry now? This cannot be undone.")) event.preventDefault(); }}><input name="assignment_id" type="hidden" value={assignmentId} /><PendingButton danger label={phase === "pens-down" ? "Open answer entry now" : "End writing & open answers"} pendingLabel="Opening answers…" /></form></section>
    </div>}
    {phase === "answers" && <div className={styles.answerActions}><form action={forceSubmitAllAssessmentAttempts} onSubmit={(event) => { if (!window.confirm("Submit every active student's latest saved answers now? Students with submitted work stay unchanged.")) event.preventDefault(); }}><input name="assignment_id" type="hidden" value={assignmentId} /><PendingButton label="Submit all active students" pendingLabel="Submitting…" quiet /></form><form action={closeAssignment} onSubmit={(event) => { if (!window.confirm("Submit every active student's saved answers and finish this test? No student will be able to continue.")) event.preventDefault(); }}><input name="assignment_id" type="hidden" value={assignmentId} /><PendingButton danger label="Submit all & finish test" pendingLabel="Finishing test…" /></form></div>}
  </section>;
}

function PendingButton({ label, pendingLabel, quiet = false, danger = false }: { label: string; pendingLabel: string; quiet?: boolean; danger?: boolean }) {
  const { pending } = useFormStatus();
  return <button className={danger ? styles.dangerButton : quiet ? "secondary-inline-button" : "teacher-button"} disabled={pending} type="submit">{pending ? pendingLabel : label}</button>;
}
