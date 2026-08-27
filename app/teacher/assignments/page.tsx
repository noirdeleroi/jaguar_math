import Link from "next/link";
import { requireTeacher } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export default async function TeacherAssignmentsPage() {
  const teacher = await requireTeacher(); const supabase = await createClient(); const { data: assignments } = await supabase.from("assignments").select("id, title, kind, status, due_at, created_at").eq("created_by", teacher.id).order("created_at", { ascending: false });
  return <main className="teacher-main assessment-page"><section className="page-heading"><div><p className="eyebrow">Assessment workspace</p><h1>Assignments</h1><p>Create, review, publish, and monitor assessment work.</p></div><Link className="teacher-button" href="/teacher/assignments/new">New assignment <span>→</span></Link></section>{assignments?.length ? <section className="teacher-section assignment-list">{assignments.map((assignment) => <Link href={`/teacher/assignments/${assignment.id}`} key={assignment.id}><div><span className={`status-pill status-${assignment.status}`}>{assignment.status}</span><strong>{assignment.title}</strong><small>{assignment.kind} · {assignment.due_at ? `Due ${new Date(assignment.due_at).toLocaleString()}` : "No due date"}</small></div><b>→</b></Link>)}</section> : <section className="empty-state"><span aria-hidden="true">∑</span><h3>No assignments yet.</h3><p>Start with a structured import and save it as a draft.</p><Link className="teacher-button" href="/teacher/assignments/new">Create an assignment <span>→</span></Link></section>}</main>;
}
