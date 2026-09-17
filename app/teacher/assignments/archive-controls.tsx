"use client";

import { useFormStatus } from "react-dom";
import { archiveAssignment, unarchiveAssignment } from "../assignment-actions";

function ArchiveButton({ compact }: { compact?: boolean }) {
  const { pending } = useFormStatus();
  return <button aria-live="polite" className={compact ? "assignment-archive-button" : "secondary-inline-button"} disabled={pending} type="submit">{pending ? "Archiving..." : "Archive"}</button>;
}

function RestoreButton({ compact }: { compact?: boolean }) {
  const { pending } = useFormStatus();
  return <button aria-live="polite" className={compact ? "assignment-restore-button" : "secondary-inline-button"} disabled={pending} type="submit">{pending ? "Restoring..." : "Restore"}</button>;
}

export default function ArchiveControls({ assignmentId, archived, compact = false }: { assignmentId: string; archived: boolean; compact?: boolean }) {
  if (archived) return <form action={unarchiveAssignment} className={compact ? "assignment-archive-form" : undefined}><input name="assignment_id" type="hidden" value={assignmentId} /><RestoreButton compact={compact} /></form>;
  return <form action={archiveAssignment} className={compact ? "assignment-archive-form" : undefined} onSubmit={(event) => { if (!window.confirm("Archive this assignment? It will be closed immediately and students will no longer be able to save or submit active attempts.")) event.preventDefault(); }}><input name="assignment_id" type="hidden" value={assignmentId} /><ArchiveButton compact={compact} /></form>;
}
