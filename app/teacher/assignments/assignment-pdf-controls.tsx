"use client";

import { useFormStatus } from "react-dom";
import { setHomeworkPdfRelease } from "../assignment-actions";
import styles from "./result-release-controls.module.css";

type Props = {
  assignmentId: string;
  dueAt: string | null;
  kind: string;
  releasedAt: string | null;
  status: string;
};

export default function AssignmentPdfControls({ assignmentId, dueAt, kind, releasedAt, status }: Props) {
  const isHomework = kind === "homework";
  const released = Boolean(releasedAt);
  const canRelease = isHomework && status !== "draft" && Boolean(dueAt);
  const heading = !isHomework ? "Teacher PDF copy" : released ? "Released after the deadline" : "Teacher PDF copy";
  const description = !isHomework
    ? "Download the complete question paper and answer key. Student PDF release is available for homework."
    : released
      ? "Students can download the question paper and answer key from Assessments after the deadline, even while this homework remains open."
      : "Download your copy now, or release it so students can download it after the homework deadline.";

  return <section className={styles.panel}>
    <div><p className="eyebrow">Printable questions &amp; answers</p><h2>{heading}</h2><p>{description}</p>{isHomework && status === "draft" && <small>Publish the homework before releasing the PDF.</small>}{isHomework && status !== "draft" && !dueAt && <small>Add a due date before releasing the PDF.</small>}</div>
    <div className={styles.actions}>
      <a className="secondary-inline-button" download href={`/api/assignments/${assignmentId}/answer-key.pdf`}>Download PDF</a>
      {canRelease && <form action={setHomeworkPdfRelease} onSubmit={(event) => {
        if (!released && !window.confirm("Release the questions and answer key for student download after the deadline?")) event.preventDefault();
      }}>
        <input name="assignment_id" type="hidden" value={assignmentId} />
        <input name="released" type="hidden" value={released ? "false" : "true"} />
        <ReleaseButton released={released} />
      </form>}
    </div>
  </section>;
}

function ReleaseButton({ released }: { released: boolean }) {
  const { pending } = useFormStatus();
  return <button className={released ? "secondary-inline-button" : "teacher-button"} disabled={pending} type="submit">{pending ? "Updating…" : released ? "Hide from students" : "Release to students"}</button>;
}
