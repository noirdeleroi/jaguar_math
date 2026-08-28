"use client";

import { useFormStatus } from "react-dom";
import { closeAssignment, reopenAssignment } from "../assignment-actions";

function CloseButton() {
  const { pending } = useFormStatus();
  return <button aria-live="polite" className="teacher-button" disabled={pending} type="submit">{pending ? "Closing..." : "Close assignment"}</button>;
}

function ReopenButton() {
  const { pending } = useFormStatus();
  return <button aria-live="polite" className="teacher-button" disabled={pending} type="submit">{pending ? "Reopening..." : "Reopen assignment"}</button>;
}

export default function LifecycleControls({ assignmentId, status }: { assignmentId: string; status: string }) {
  if (status === "published") return <form action={closeAssignment} onSubmit={(event) => { if (!window.confirm("Close this assignment? Students will immediately be unable to save or submit active attempts.")) event.preventDefault(); }}><input name="assignment_id" type="hidden" value={assignmentId} /><CloseButton /></form>;
  if (status === "closed") return <form action={reopenAssignment}><input name="assignment_id" type="hidden" value={assignmentId} /><ReopenButton /></form>;
  return null;
}
