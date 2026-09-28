"use client";

import { useFormStatus } from "react-dom";
import { setAssignmentPdfRelease } from "../assignment-actions";
import styles from "./result-release-controls.module.css";

type Props = {
  assignmentId: string;
  dueAt: string | null;
  kind: string;
  releasedAt: string | null;
  serverNow: string;
  status: string;
};

export default function AssignmentPdfControls({ assignmentId, dueAt, kind, releasedAt, serverNow, status }: Props) {
  const isHomework = kind === "homework";
  const deadlinePassed = Boolean(dueAt && new Date(dueAt).getTime() <= new Date(serverNow).getTime());
  const automaticRelease = isHomework && deadlinePassed;
  const manuallyReleased = Boolean(releasedAt);
  const available = automaticRelease || manuallyReleased;
  const canChangeRelease = status !== "draft" && !automaticRelease;
  const heading = automaticRelease ? "Released automatically" : manuallyReleased ? "Released to students" : "Teacher PDF copy";
  const description = automaticRelease
    ? "The homework deadline has passed. Students can no longer take it and can download the questions and answers as a PDF."
    : manuallyReleased
      ? "Students can download the complete questions and answers now."
      : isHomework && dueAt
        ? "Students will automatically get the PDF at the homework deadline. You can also release it immediately."
        : isHomework
          ? "Add a due date for automatic release, or publish the homework and release the PDF manually."
          : "Download your copy, or release the complete questions and answers to students at any time.";

  return <section className={styles.panel}>
    <div><p className="eyebrow">Printable questions &amp; answers</p><h2>{heading}</h2><p>{description}</p>{status === "draft" && <small>Publish the assessment before releasing the PDF to students.</small>}</div>
    <div className={styles.actions}>
      <a className="secondary-inline-button" download href={`/api/assignments/${assignmentId}/answer-key.pdf`}>Download PDF</a>
      {canChangeRelease && <form action={setAssignmentPdfRelease} onSubmit={(event) => {
        if (!manuallyReleased && !window.confirm("Release the complete questions and answers for students to download now?")) event.preventDefault();
      }}>
        <input name="assignment_id" type="hidden" value={assignmentId} />
        <input name="released" type="hidden" value={manuallyReleased ? "false" : "true"} />
        <ReleaseButton released={available} />
      </form>}
    </div>
  </section>;
}

function ReleaseButton({ released }: { released: boolean }) {
  const { pending } = useFormStatus();
  return <button className={released ? "secondary-inline-button" : "teacher-button"} disabled={pending} type="submit">{pending ? "Updating…" : released ? "Hide from students" : "Release to students"}</button>;
}
