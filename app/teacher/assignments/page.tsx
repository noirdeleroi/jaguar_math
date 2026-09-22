import Link from "next/link";
import AssignmentDue from "@/app/components/assignment-due";
import { requireTeacher } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import ArchiveControls from "./archive-controls";

type AssignmentRow = { id: string; title: string; kind: string; status: string; due_at: string | null; created_at: string; archived_at: string | null };

function AssignmentList({ assignments, classNamesByAssignment, archived = false }: { assignments: AssignmentRow[]; classNamesByAssignment: Map<string, string[]>; archived?: boolean }) {
  return <section className={`teacher-section assignment-list${archived ? " assignment-list-archived" : ""}`}>{assignments.map((assignment) => { const classNames = (classNamesByAssignment.get(assignment.id) ?? []).sort((left, right) => left.localeCompare(right)); return <article className="assignment-list-row" key={assignment.id}><Link href={`/teacher/assignments/${assignment.id}`}><div><div className="assignment-list-labels"><span className={`assignment-kind-badge kind-${assignment.kind}`}>{assignment.kind === "homework" ? "Learning · Homework" : assignment.kind === "quiz" ? "Check · Quiz" : assignment.kind === "paper" ? "Answer sheet · Paper" : "Secure · Test"}</span><span className={`status-pill ${archived ? "status-archived" : `status-${assignment.status}`}`}>{archived ? "archived" : assignment.status}</span></div><strong>{assignment.title}</strong><div className="assignment-list-meta"><AssignmentDue dueAt={assignment.due_at} status={assignment.status} /><small>Classes: {classNames.join(", ") || "None"}</small></div></div><b aria-hidden="true">→</b></Link><ArchiveControls archived={archived} assignmentId={assignment.id} compact /></article>; })}</section>;
}

export default async function TeacherAssignmentsPage() {
  const teacher = await requireTeacher();
  const supabase = await createClient();
  const { data } = await supabase.from("assignments").select("id, title, kind, status, due_at, created_at, archived_at").eq("created_by", teacher.id).order("created_at", { ascending: false });
  const assignments = (data ?? []) as AssignmentRow[]; const assignmentIds = assignments.map((assignment) => assignment.id);
  const { data: classLinks } = assignmentIds.length ? await supabase.from("assignment_classes").select("assignment_id, classes(name)").in("assignment_id", assignmentIds) : { data: [] };
  const classNamesByAssignment = new Map<string, string[]>();
  for (const link of classLinks ?? []) { const classroom = Array.isArray(link.classes) ? link.classes[0] : link.classes; if (classroom) classNamesByAssignment.set(link.assignment_id, [...(classNamesByAssignment.get(link.assignment_id) ?? []), classroom.name]); }
  const activeAssignments = assignments.filter((assignment) => !assignment.archived_at); const archivedAssignments = assignments.filter((assignment) => assignment.archived_at);

  return <main className="teacher-main assessment-page"><section className="page-heading"><div><p className="eyebrow">Assessment workspace</p><h1>Assignments</h1><p>Create learning-mode homework, secure online tests, and paper answer sheets.</p></div><Link className="teacher-button" href="/teacher/assignments/new">New assignment <span>→</span></Link></section>{activeAssignments.length ? <AssignmentList assignments={activeAssignments} classNamesByAssignment={classNamesByAssignment} /> : <section className="empty-state"><span aria-hidden="true">∑</span><h3>No active assignments.</h3><p>Create a new assignment or restore one from the archive.</p><Link className="teacher-button" href="/teacher/assignments/new">Create an assignment <span>→</span></Link></section>}{archivedAssignments.length > 0 && <details className="archived-assignments"><summary><span><strong>Archived assignments</strong><small>Closed and hidden from your active workspace</small></span><b>{archivedAssignments.length}</b></summary><AssignmentList archived assignments={archivedAssignments} classNamesByAssignment={classNamesByAssignment} /></details>}</main>;
}
