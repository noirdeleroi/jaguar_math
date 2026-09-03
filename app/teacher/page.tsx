import Link from "next/link";
import { requireTeacher } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export default async function TeacherDashboard() {
  const teacher = await requireTeacher(); const supabase = await createClient();
  const [{ data: classes }, { data: memberships }, { count: students }, { count: assignments }] = await Promise.all([
    supabase.from("classes").select("id, name, grade_level, academic_year").eq("teacher_id", teacher.id).order("grade_level").order("name"),
    supabase.from("class_members").select("class_id"),
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "student"),
    supabase.from("assignments").select("id", { count: "exact", head: true }).eq("created_by", teacher.id),
  ]);
  const memberCounts = new Map<string, number>(); memberships?.forEach(({ class_id }) => memberCounts.set(class_id, (memberCounts.get(class_id) ?? 0) + 1));
  const greeting = teacher.full_name?.split(" ")[0] || "Teacher";
  return <main className="teacher-main"><section className="teacher-heading"><p className="eyebrow">Teacher workspace</p><h1>Good morning, {greeting}.</h1><p>Keep your classes and students ready for the work ahead.</p></section><section className="teacher-stats" aria-label="Overview"><article><span>Classes</span><strong>{classes?.length ?? 0}</strong></article><article><span>Students</span><strong>{students ?? 0}</strong></article><article><span>Assignments</span><strong>{assignments ?? 0}</strong></article></section><section className="teacher-section"><div className="section-row"><div><p className="eyebrow">Your classes</p><h2>Classroom overview</h2></div><Link className="teacher-button" href="/teacher/classes">Manage Classes <span>→</span></Link></div>{classes?.length ? <div className="class-overview">{classes.map((classroom) => <Link href={`/teacher/classes/${classroom.id}`} key={classroom.id}><span className="class-grade">Grade {classroom.grade_level}</span><strong>{classroom.name}</strong><small>{memberCounts.get(classroom.id) ?? 0} {(memberCounts.get(classroom.id) ?? 0) === 1 ? "student" : "students"} · {classroom.academic_year}</small><b aria-hidden="true">↗</b></Link>)}</div> : <div className="empty-state"><span aria-hidden="true">∑</span><h3>No classes yet.</h3><p>Create your first class to start organizing students.</p><Link className="teacher-button" href="/teacher/classes">Create a class <span>→</span></Link></div>}</section></main>;
}
