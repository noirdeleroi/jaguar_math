"use client";

import { useFormStatus } from "react-dom";
import { releaseTestQuestions } from "../assignment-actions";
import styles from "./result-release-controls.module.css";

export default function QuestionReleaseControls({ assignmentId, controlled, kind = "test", releasedAt }: { assignmentId: string; controlled: boolean; kind?: string; releasedAt: string | null }) {
  const paper = kind === "paper";
  const released = !controlled || Boolean(releasedAt);
  return <section className={styles.panel}>
    <div><p className="eyebrow">Step 2 · Start assessment</p><h2>{released ? controlled ? paper ? "Answer page is open" : "Test is in progress" : "Starts automatically" : paper ? "Ready to open answer page" : "Ready to start test"}</h2><p>{paper ? released ? "Students can now start their assigned paper version and enter answers. Printed questions remain hidden in Jaguar." : "Students remain on a waiting page until you open the answer sheet." : released ? controlled ? "Questions and timers are live for students on the waiting screen." : "Each student starts their timed attempt when they enter Exam Mode." : "Students can enter fullscreen and read the instructions. Questions and timers stay locked until you start the test."}</p>{releasedAt && <small>Started {new Date(releasedAt).toLocaleString()} · This cannot be reversed.</small>}</div>
    {!released && <div className={styles.actions}><form action={releaseTestQuestions} onSubmit={(event) => { if (!window.confirm(paper ? "Open the paper answer page now? Waiting students will be able to start and receive a paper version." : "Release the test questions now? Waiting students will immediately begin their timed attempts.")) event.preventDefault(); }}><input name="assignment_id" type="hidden" value={assignmentId} /><ReleaseButton paper={paper} /></form></div>}
  </section>;
}

function ReleaseButton({ paper }: { paper: boolean }) {
  const { pending } = useFormStatus();
  return <button className="teacher-button" disabled={pending} type="submit">{pending ? "Starting…" : paper ? "Open answer page" : "Start test & release questions"}</button>;
}
