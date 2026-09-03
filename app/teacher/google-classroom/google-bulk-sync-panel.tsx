"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { applyAllLinkedGoogleClassrooms, previewAllLinkedGoogleClassrooms, type BulkSyncActionState } from "./actions";
import CredentialActions from "./credential-actions";

const initial: BulkSyncActionState = {};

function PreviewButton() {
  const { pending } = useFormStatus();
  return <button className="teacher-button" disabled={pending} type="submit">{pending ? "Preparing all classes..." : "Sync all linked classes"}</button>;
}

function ApplyButton() {
  const { pending } = useFormStatus();
  return <button className="teacher-button" disabled={pending} type="submit">{pending ? "Syncing all classes..." : "Confirm all updates"}</button>;
}

export default function GoogleBulkSyncPanel({ linkedClassCount }: { linkedClassCount: number }) {
  const [previewState, previewAction] = useActionState(previewAllLinkedGoogleClassrooms, initial);
  const [applyState, applyAction] = useActionState(applyAllLinkedGoogleClassrooms, initial);
  const preview = previewState.preview;
  return <section className="teacher-section google-sync-panel"><div className="section-row"><div><p className="eyebrow">Linked classes only</p><h2>Sync linked Google Classrooms</h2><p className="form-note">This currently includes {linkedClassCount} linked class{linkedClassCount === 1 ? "" : "es"}. Link any other Google courses below first. Nothing changes until you confirm.</p></div><span className="sync-status">{linkedClassCount} linked</span></div><form action={previewAction} className="google-sync-form"><PreviewButton /></form>{previewState.error && <p className="notice notice-error" role="alert">{previewState.error}</p>}{preview && <section className="google-sync-preview"><div className="section-row"><div><p className="eyebrow">Confirmation required</p><h3>Linked classes to sync</h3></div><span className="muted-count">{preview.courses.length} classes</span></div><div className="google-sync-summary"><span><strong>{preview.existingCount}</strong> existing enrollments</span><span><strong>{preview.newCount}</strong> new accounts to create</span><span><strong>{preview.removedCount}</strong> no longer in Google Classroom</span></div>{preview.issue && <p className="notice notice-error">{preview.issue}</p>}<div className="google-preview-list">{preview.courses.map((course) => <article key={course.course.id}><div><strong>{course.course.name || "Untitled course"} → {course.className}</strong><span>{course.students.length} in Google Classroom · {course.existingCount} existing · {course.newCount} new · {course.removed.length} no longer in Classroom</span></div><b className={course.canApply ? "" : "warning"}>{course.canApply ? "Ready" : "Needs review"}</b></article>)}</div>{preview.courses.some((course) => course.removed.length > 0) && <details><summary>Review students no longer in Google Classroom</summary>{preview.courses.flatMap((course) => course.removed.map((student) => <p key={`${course.classId}-${student.studentId}`}><strong>{course.className}:</strong> {student.fullName} · {student.emailAddress}</p>))}</details>}{!preview.canApply ? <p className="notice notice-error">Resolve the roster entries marked Needs review before confirming.</p> : <form action={applyAction} className="google-confirm-form"><input name="confirmation" type="hidden" value={preview.confirmationToken ?? ""} />{preview.removedCount > 0 && <label><input name="remove_missing" type="checkbox" /> Remove students who are no longer in Google Classroom from their corresponding Jaguar Math class only. Their accounts and assessment history will be preserved.</label>}<ApplyButton /></form>}</section>}{applyState.error && <p className="notice notice-error" role="alert">{applyState.error}</p>}{applyState.completed && <section className="notice notice-success google-credentials"><h3>All linked classes are synced.</h3><p>{applyState.removedCount ? `${applyState.removedCount} class membership${applyState.removedCount === 1 ? " was" : "s were"} removed; student accounts and results were kept.` : "Existing accounts were linked or updated without duplication."}</p>{applyState.credentials?.length ? <><p><strong>Copy these temporary credentials now.</strong> They are shown once and are not saved by Jaguar Math.</p><CredentialActions credentials={applyState.credentials} /><div className="google-roster-table"><table><thead><tr><th>Student</th><th>Email</th><th>Temporary password</th></tr></thead><tbody>{applyState.credentials.map((credential) => <tr key={credential.emailAddress}><td>{credential.fullName}</td><td>{credential.emailAddress}</td><td><code>{credential.temporaryPassword}</code></td></tr>)}</tbody></table></div></> : <p>No new Jaguar Math accounts were needed.</p>}</section>}</section>;
}
