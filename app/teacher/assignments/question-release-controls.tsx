"use client";

import { useFormStatus } from "react-dom";
import { releaseTestQuestions } from "../assignment-actions";
import styles from "./result-release-controls.module.css";

export default function QuestionReleaseControls({ assignmentId, controlled, kind = "test", releasedAt }: { assignmentId: string; controlled: boolean; kind?: string; releasedAt: string | null }) {
  const paper = kind === "paper";
  const released = !controlled || Boolean(releasedAt);
  return <section className={styles.panel}>
    <div><p className="eyebrow">{paper ? "Paper answer-page access" : "Test question access"}</p><h2>{released ? controlled ? paper ? "Answer page opened" : "Questions released" : "Available immediately" : "Waiting for teacher release"}</h2><p>{paper ? released ? "Students can now start their assigned paper version and enter answers. Printed questions remain hidden in Jaguar." : "Students remain on a waiting page until you open the answer sheet." : released ? controlled ? "Students on the waiting screen can now start their timed attempt and see the questions." : "Students can start their timed attempt as soon as they enter Exam Mode." : "Students can enter fullscreen and read the instructions. Questions and timers remain locked until you release them."}</p>{releasedAt && <small>The release is permanent for this published {paper ? "paper test" : "test"}.</small>}</div>
    {!released && <div className={styles.actions}><form action={releaseTestQuestions} onSubmit={(event) => { if (!window.confirm(paper ? "Open the paper answer page now? Waiting students will be able to start and receive a paper version." : "Release the test questions now? Waiting students will immediately begin their timed attempts.")) event.preventDefault(); }}><input name="assignment_id" type="hidden" value={assignmentId} /><ReleaseButton paper={paper} /></form></div>}
  </section>;
}

function ReleaseButton({ paper }: { paper: boolean }) {
  const { pending } = useFormStatus();
  return <button className="teacher-button" disabled={pending} type="submit">{pending ? "Releasing…" : paper ? "Open answer page" : "Release test questions"}</button>;
}
