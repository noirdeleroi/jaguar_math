import Link from "next/link";
import { requireTeacher } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export default async function TeacherStarsPage() {
  const teacher = await requireTeacher();
  const supabase = await createClient();
  const [{ data: classes }, { data: memberships }] = await Promise.all([
    supabase.from("classes").select("id, name, grade_level, academic_year").eq("teacher_id", teacher.id).order("grade_level").order("name"),
    supabase.from("class_members").select("class_id"),
  ]);
  const counts = new Map<string, number>();
  for (const membership of memberships ?? []) counts.set(membership.class_id, (counts.get(membership.class_id) ?? 0) + 1);

  return <main className="teacher-main">
    <section className="page-heading"><div><p className="eyebrow">Classroom rewards</p><h1>Jaguar Stars</h1><p>Weekly stars, homework, and classwork records for the classes you already teach.</p></div></section>
    <section className="teacher-section" style={{ marginTop: 32 }}>
      <div className="section-row"><div><p className="eyebrow">Choose a class</p><h2>Star classrooms</h2></div><a className="secondary-inline-button" href="/api/stars/export">Download Excel backup</a></div>
      {classes?.length ? <div className="class-list">{classes.map((classroom) => <Link href={`/teacher/classes/${classroom.id}/stars`} key={classroom.id}><div><strong>{classroom.name}</strong><span>Grade {classroom.grade_level} · {classroom.academic_year}</span></div><small>{counts.get(classroom.id) ?? 0} students <b>→</b></small></Link>)}</div> : <div className="compact-empty"><h3>No classes yet.</h3><p>Create or sync a class before opening Jaguar Stars.</p></div>}
    </section>
  </main>;
}
