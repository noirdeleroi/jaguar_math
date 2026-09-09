"use client";

import { useFormStatus } from "react-dom";
import { setAssignmentResultVisibility } from "../assignment-actions";
import styles from "./result-release-controls.module.css";

type Visibility = "private" | "score_only" | "full_review";

const COPY: Record<Visibility, { label: string; description: string }> = {
  private: { label: "Confirmation only", description: "Scores, questions, responses, answer keys, and improvement guidance are hidden." },
  score_only: { label: "Score only", description: "Students see the score, but the test questions and answers stay private." },
  full_review: { label: "Full review released", description: "Students can see every question, their response, the correct answer, score, and improvement guidance." },
};

export default function ResultReleaseControls({ assignmentId, kind, visibility }: { assignmentId: string; kind: string; visibility: Visibility }) {
  return <section className={styles.panel}>
    <div><p className="eyebrow">Student result access</p><h2>{COPY[visibility].label}</h2><p>{COPY[visibility].description}</p>{kind !== "homework" && visibility !== "full_review" && <small>Keep results private while any students are still taking this assessment.</small>}</div>
    <div className={styles.actions}>
      {visibility !== "private" && <VisibilityForm assignmentId={assignmentId} label="Hide all results" visibility="private" />}
      {visibility !== "score_only" && <VisibilityForm assignmentId={assignmentId} label="Release score only" visibility="score_only" />}
      {visibility !== "full_review" && <VisibilityForm assignmentId={assignmentId} label="Reveal all results" primary visibility="full_review" />}
    </div>
  </section>;
}

function VisibilityForm({ assignmentId, label, primary = false, visibility }: { assignmentId: string; label: string; primary?: boolean; visibility: Visibility }) {
  return <form action={setAssignmentResultVisibility} onSubmit={(event) => {
    if (visibility === "full_review" && !window.confirm("Reveal all results now? Students will immediately be able to see the test questions, their answers, correct answers, scores, and improvement guidance.")) event.preventDefault();
  }}>
    <input name="assignment_id" type="hidden" value={assignmentId} />
    <input name="visibility" type="hidden" value={visibility} />
    <SubmitButton label={label} primary={primary} />
  </form>;
}

function SubmitButton({ label, primary }: { label: string; primary: boolean }) {
  const { pending } = useFormStatus();
  return <button className={primary ? "teacher-button" : "secondary-inline-button"} disabled={pending} type="submit">{pending ? "Updating…" : label}</button>;
}
