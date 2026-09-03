"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { applyAllLinkedGoogleClassrooms, previewAllLinkedGoogleClassrooms, type BulkSyncActionState } from "./actions";
import CredentialActions from "./credential-actions";

const initial: BulkSyncActionState = {};

function PreviewButton() {
  const { pending } = useFormStatus();
  return <button className="teacher-button" disabled={pending} type="submit">{pending ? "Preparing all courses..." : "Import and sync all Google courses"}</button>;
}

function ApplyButton() {
  const { pending } = useFormStatus();
  return <button className="teacher-button" disabled={pending} type="submit">{pending ? "Syncing all classes..." : "Confirm all updates"}</button>;
}

function BulkPreview({ preview, previewAction, previewError, applyAction, applyError, applyState, googleCourseCount, linkedClassCount }: { preview: BulkSyncActionState["preview"]; previewAction: (formData: FormData) => void; previewError?: string; applyAction: (formData: FormData) => void; applyError?: string; applyState: BulkSyncActionState; googleCourseCount: number; linkedClassCount: number }) {
  return <section className="teacher-section google-sync-panel">
    <div className="section-row"><div><p className="eyebrow">All Google courses</p><h2>Import and sync every Google Classroom</h2><p className="form-note">This reviews all {googleCourseCount} Google courses: {linkedClassCount} already linked and {googleCourseCount - linkedClassCount} new Jaguar Math class{googleCourseCount - linkedClassCount === 1 ? "" : "es"} to create after confirmation.</p></div><span className="sync-status">{googleCourseCount} courses</span></div>
    <form action={previewAction} className="google-sync-form"><PreviewButton /></form>
    {previewError && <p className="notice notice-error" role="alert">{previewError}</p>}
    {preview && <section className="google-sync-preview"><div className="section-row"><div><p className="eyebrow">Confirmation required</p><h3>All Google courses</h3></div><span className="muted-count">{preview.courses.length} courses</span></div><div className="google-sync-summary"><span><strong>{preview.existingCount}</strong> existing enrollments</span><span><strong>{preview.newCount}</strong> new accounts to create</span><span><strong>{preview.createCount}</strong> Jaguar classes to create</span><span><strong>{preview.removedCount}</strong> no longer in Google Classroom</span></div>{preview.issue && <p className="notice notice-error">{preview.issue}</p>}<div className="google-preview-list">{preview.courses.map((course) => <article key={course.course.id}><div><strong>{course.course.name || "Untitled course"} → {course.mode === "existing" ? course.className : `New Jaguar class: ${course.className}`}</strong><span>{course.students.length} in Google Classroom · {course.existingCount} existing · {course.newCount} new · {course.mode === "create" ? `Grade ${course.gradeLevel}` : "Already linked"}</span></div><b className={course.canApply ? "" : "warning"}>{course.canApply ? course.mode === "create" ? "Will create" : "Ready" : "Needs review"}</b></article>)}</div>{preview.courses.some((course) => course.removed.length > 0) && <details><summary>Review students no longer in Google Classroom</summary>{preview.courses.flatMap((course) => course.removed.map((student) => <p key={`${course.classId ?? course.course.id}-${student.studentId}`}><strong>{course.className}:</strong> {student.fullName} · {student.emailAddress}</p>))}</details>}{!preview.canApply ? <p className="notice notice-error">Resolve the roster entries marked Needs review before confirming.</p> : <form action={applyAction} className="google-confirm-form"><input name="confirmation" type="hidden" value={preview.confirmationToken ?? ""} />{preview.courses.filter((course) => course.mode === "create").map((course) => <label key={course.course.id}>Grade for new class: {course.className}<select defaultValue={course.gradeLevel} name={`grade_${course.course.id}`} required><option value="11">Grade 11</option><option value="12">Grade 12</option></select></label>)}{preview.removedCount > 0 && <label><input name="remove_missing" type="checkbox" /> Remove students who are no longer in Google Classroom from their corresponding Jaguar Math class only. Their accounts and assessment history will be preserved.</label>}<ApplyButton /></form>}</section>}
    {applyError && <p className="notice notice-error" role="alert">{applyError}</p>}
    {applyState.completed && <section className="notice notice-success google-credentials"><h3>Google Classroom import and sync complete.</h3><p>{applyState.createdClassCount ? `${applyState.createdClassCount} Jaguar class${applyState.createdClassCount === 1 ? " was" : "es were"} created. ` : ""}{applyState.removedCount ? `${applyState.removedCount} class membership${applyState.removedCount === 1 ? " was" : "s were"} removed; student accounts and results were kept.` : "Existing accounts were linked or updated without duplication."}</p>{applyState.credentials?.length ? <><p><strong>Copy these temporary credentials now.</strong> They are shown once and are not saved by Jaguar Math.</p><CredentialActions credentials={applyState.credentials} /><div className="google-roster-table"><table><thead><tr><th>Student</th><th>Email</th><th>Temporary password</th></tr></thead><tbody>{applyState.credentials.map((credential) => <tr key={credential.emailAddress}><td>{credential.fullName}</td><td>{credential.emailAddress}</td><td><code>{credential.temporaryPassword}</code></td></tr>)}</tbody></table></div></> : <p>No new Jaguar Math accounts were needed.</p>}</section>}
  </section>;
}

export default function GoogleBulkSyncPanel({ googleCourseCount, linkedClassCount }: { googleCourseCount: number; linkedClassCount: number }) {
  const [previewState, previewAction] = useActionState(previewAllLinkedGoogleClassrooms, initial);
  const [applyState, applyAction] = useActionState(applyAllLinkedGoogleClassrooms, initial);
  const preview = previewState.preview;
  return <BulkPreview applyAction={applyAction} applyError={applyState.error} applyState={applyState} googleCourseCount={googleCourseCount} linkedClassCount={linkedClassCount} preview={preview} previewAction={previewAction} previewError={previewState.error} />;
}
