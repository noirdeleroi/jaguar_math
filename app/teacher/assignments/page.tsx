import Link from "next/link";
import AssignmentDue from "@/app/components/assignment-due";
import { requireTeacher } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export default async function TeacherAssignmentsPage() {
  const teacher = await requireTeacher();
  const supabase = await createClient();
  const { data: assignments } = await supabase.from("assignments").select("id, title, kind, status, due_at, created_at").eq("created_by", teacher.id).order("created_at", { ascending: false });
  const assignmentIds = assignments?.map((assignment) => assignment.id) ?? [];
  const { data: classLinks } = assignmentIds.length
    ? await supabase.from("assignment_classes").select("assignment_id, classes(name)").in("assignment_id", assignmentIds)
    : { data: [] };
  const classNamesByAssignment = new Map<string, string[]>();

  for (const link of classLinks ?? []) {
    const classroom = Array.isArray(link.classes) ? link.classes[0] : link.classes;
    if (classroom) classNamesByAssignment.set(link.assignment_id, [...(classNamesByAssignment.get(link.assignment_id) ?? []), classroom.name]);
  }

  return <main className="teacher-main assessment-page"><section className="page-heading"><div><p className="eyebrow">Assessment workspace</p><h1>Assignments</h1><p>Create learning-mode homework and secure tests.</p></div><Link className="teacher-button" href="/teacher/assignments/new">New assignment <span>→</span></Link></section>{assignments?.length ? <section className="teacher-section assignment-list">{assignments.map((assignment) => { const classNames = (classNamesByAssignment.get(assignment.id) ?? []).sort((left, right) => left.localeCompare(right)); return <Link href={`/teacher/assignments/${assignment.id}`} key={assignment.id}><div><div className="assignment-list-labels"><span className={`assignment-kind-badge kind-${assignment.kind}`}>{assignment.kind === "homework" ? "Learning · Homework" : assignment.kind === "quiz" ? "Check · Quiz" : "Secure · Test"}</span><span className={`status-pill status-${assignment.status}`}>{assignment.status}</span></div><strong>{assignment.title}</strong><div className="assignment-list-meta"><AssignmentDue dueAt={assignment.due_at} status={assignment.status} /><small>Classes: {classNames.join(", ") || "None"}</small></div></div><b>→</b></Link>; })}</section> : <section className="empty-state"><span aria-hidden="true">∑</span><h3>No assignments yet.</h3><p>Start with a structured import and save it as a draft.</p><Link className="teacher-button" href="/teacher/assignments/new">Create an assignment <span>→</span></Link></section>}</main>;
}
