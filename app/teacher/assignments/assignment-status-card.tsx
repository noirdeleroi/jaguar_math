import { publishAssignment } from "../assignment-actions";
import LifecycleControls from "./lifecycle-controls";

const COPY: Record<string, { label: string; description: string }> = {
  draft: { label: "Draft", description: "Private to you. Students cannot see or start it yet." },
  published: { label: "Published", description: "Live for assigned students. Use the controls below to manage access." },
  closed: { label: "Closed", description: "Student work is locked. Reopen it whenever you need to continue." },
  archived: { label: "Archived", description: "Hidden from the active workspace and no longer available to students." },
};

export default function AssignmentStatusCard({ archived = false, assignmentId, status }: { archived?: boolean; assignmentId: string; status: string }) {
  const resolvedStatus = archived ? "archived" : status;
  const copy = COPY[resolvedStatus] ?? COPY.draft;
  return <aside aria-label={`Assignment status: ${copy.label}`} className={`assignment-status-card assignment-status-${resolvedStatus}`}>
    <span>Assignment status</span>
    <strong><i aria-hidden="true" />{copy.label}</strong>
    <p>{copy.description}</p>
    {!archived && status === "draft" && <form action={publishAssignment}><input name="assignment_id" type="hidden" value={assignmentId} /><button className="teacher-button" type="submit">Publish now <span aria-hidden="true">→</span></button></form>}
    {!archived && status !== "draft" && <LifecycleControls assignmentId={assignmentId} status={status} />}
  </aside>;
}
