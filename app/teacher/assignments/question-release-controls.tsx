"use client";

import { useFormStatus } from "react-dom";
import { releaseTestQuestions } from "../assignment-actions";
import styles from "./result-release-controls.module.css";

export default function QuestionReleaseControls({ assignmentId, controlled, releasedAt }: { assignmentId: string; controlled: boolean; releasedAt: string | null }) {
  const released = !controlled || Boolean(releasedAt);
  return <section className={styles.panel}>
    <div><p className="eyebrow">Test question access</p><h2>{released ? controlled ? "Questions released" : "Available immediately" : "Waiting for teacher release"}</h2><p>{released ? controlled ? "Students on the waiting screen can now start their timed attempt and see the questions." : "Students can start their timed attempt as soon as they enter Exam Mode." : "Students can enter fullscreen and read the instructions. Questions and timers remain locked until you release them."}</p>{releasedAt && <small>The release is permanent for this published test.</small>}</div>
    {!released && <div className={styles.actions}><form action={releaseTestQuestions} onSubmit={(event) => { if (!window.confirm("Release the test questions now? Waiting students will immediately begin their timed attempts.")) event.preventDefault(); }}><input name="assignment_id" type="hidden" value={assignmentId} /><ReleaseButton /></form></div>}
  </section>;
}

function ReleaseButton() {
  const { pending } = useFormStatus();
  return <button className="teacher-button" disabled={pending} type="submit">{pending ? "Releasing…" : "Release test questions"}</button>;
}
