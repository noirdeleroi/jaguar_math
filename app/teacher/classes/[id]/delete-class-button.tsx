"use client";

import { useFormStatus } from "react-dom";
import { deleteClass } from "../../actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return <button className="delete-class-button" disabled={pending} type="submit">{pending ? "Deleting..." : "Delete class"}</button>;
}

export default function DeleteClassButton({ classId, className }: { classId: string; className: string }) {
  const confirmDeletion = (event: React.FormEvent<HTMLFormElement>) => {
    if (!window.confirm(`Delete ${className}? This permanently removes the class, its enrollments, and its assignment links. Student accounts and submitted attempts will remain.`)) event.preventDefault();
  };

  return <form action={deleteClass} className="delete-class-form" onSubmit={confirmDeletion}>
    <input name="class_id" type="hidden" value={classId} />
    <p>Deleting this class removes its enrollments and assignment links. Student accounts and submitted attempts are kept.</p>
    <SubmitButton />
  </form>;
}
