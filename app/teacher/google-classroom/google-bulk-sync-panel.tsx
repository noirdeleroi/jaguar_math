"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { previewAllLinkedGoogleClassrooms, type BulkSyncActionState, type BulkSyncCoursePreview } from "./actions";

const initial: BulkSyncActionState = {};

function PreviewButton() {
  const { pending } = useFormStatus();
  return <button className="teacher-button" disabled={pending} type="submit">{pending ? "Checking Google courses..." : "Check every Google course for changes"}</button>;
}

function CourseStatus({ course }: { course: BulkSyncCoursePreview }) {
  if (!course.canApply) return <b className="warning">Needs review</b>;
  if (course.mode === "create") return <b>New class ready</b>;
  return <b>{course.hasChanges ? "Changes ready" : "No roster changes"}</b>;
}

function CourseDetails({ course }: { course: BulkSyncCoursePreview }) {
  const changes = [course.newCount ? `${course.newCount} new student${course.newCount === 1 ? "" : "s"}` : null, course.removed.length ? `${course.removed.length} no longer enrolled` : null].filter(Boolean);
  return <article><div><strong>{course.course.name || "Untitled course"} → {course.mode === "existing" ? course.className : `New Jaguar class: ${course.className}`}</strong><span>{course.students.length} in Google Classroom · {course.existingCount} already linked{changes.length ? ` · ${changes.join(" · ")}` : " · roster matches Jaguar Math"}</span>{course.removed.length > 0 && <small>{course.removed.map((student) => student.fullName).join(", ")} can be removed from this class after review.</small>}</div><div className="google-course-preview-actions"><CourseStatus course={course} /><Link className="secondary-inline-button" href={`/teacher/google-classroom?course=${encodeURIComponent(course.course.id)}`}>Review & apply <span>→</span></Link></div></article>;
}

export default function GoogleBulkSyncPanel({ autoPreview = false, googleCourseCount, linkedClassCount }: { autoPreview?: boolean; googleCourseCount: number; linkedClassCount: number }) {
  const [previewState, previewAction] = useActionState(previewAllLinkedGoogleClassrooms, initial);
  const started = useRef(false);
  useEffect(() => { if (autoPreview && !started.current) { started.current = true; previewAction(); } }, [autoPreview, previewAction]);
  const preview = previewState.preview;
  return <section className="teacher-section google-sync-panel google-course-check"><div className="section-row"><div><p className="eyebrow">All Google courses</p><h2>Check changes, then apply one class at a time</h2><p className="form-note">This checks all {googleCourseCount} Google courses. Nothing is changed until you open a course and confirm its individual sync.</p></div><span className="sync-status">{linkedClassCount} linked · {googleCourseCount} total</span></div>{!autoPreview && <form action={previewAction} className="google-sync-form"><PreviewButton /></form>}{autoPreview && !preview && !previewState.error && <p className="form-note" role="status">Checking Google Classroom rosters…</p>}{previewState.error && <p className="notice notice-error" role="alert">{previewState.error}</p>}{preview && <section className="google-sync-preview"><div className="section-row"><div><p className="eyebrow">Course-by-course review</p><h3>{preview.courses.filter((course) => course.hasChanges || !course.canApply).length} course{preview.courses.filter((course) => course.hasChanges || !course.canApply).length === 1 ? "" : "s"} need attention</h3></div><span className="muted-count">{preview.courses.length} checked</span></div><div className="google-sync-summary"><span><strong>{preview.existingCount}</strong> existing enrollments</span><span><strong>{preview.newCount}</strong> new accounts to review</span><span><strong>{preview.createCount}</strong> new Jaguar classes</span><span><strong>{preview.removedCount}</strong> roster removals to review</span></div>{preview.issue && <p className="notice notice-error">{preview.issue}</p>}<div className="google-preview-list google-course-preview-list">{preview.courses.map((course) => <CourseDetails course={course} key={course.course.id} />)}</div><p className="form-note">Select <strong>Review & apply</strong> beside a course to inspect its roster and confirm that course only.</p></section>}</section>;
}
