import Link from "next/link";
import CurrentWeekSelector from "@/app/teacher/current-week-selector";
import { requireTeacher } from "@/lib/auth";
import { curriculumTopic, curriculumWeekOptions } from "@/lib/curriculum-weeks";
import { loadTeacherCurrentWeek } from "@/lib/classroom-star-data";
import { createClient } from "@/lib/supabase/server";

export default async function TeacherDashboard() {
  const teacher = await requireTeacher();
  const supabase = await createClient();
  const [currentWeek, { data: classes }, { data: memberships }, { count: studentCount }, { count: assignmentCount }] = await Promise.all([
    loadTeacherCurrentWeek(teacher.id),
    supabase.from("classes").select("id, name, grade_level, academic_year").eq("teacher_id", teacher.id).order("grade_level").order("name"),
    supabase.from("class_members").select("class_id"),
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "student"),
    supabase.from("assignments").select("id", { count: "exact", head: true }).eq("created_by", teacher.id),
  ]);
  const counts = new Map<string, number>();
  for (const membership of memberships ?? []) counts.set(membership.class_id, (counts.get(membership.class_id) ?? 0) + 1);
  const greeting = teacher.full_name?.split(" ")[0] || "Teacher";
  const grade11 = curriculumTopic(11, currentWeek);
  const grade12 = curriculumTopic(12, currentWeek);

  return <main className="teacher-main">
    <section className="teacher-heading"><p className="eyebrow">Teacher dashboard</p><h1>Good day, {greeting}.</h1><p>Choose the current teaching week once; every Jaguar Stars class will open on that week.</p></section>

    <section className="dashboard-week-panel">
      <CurrentWeekSelector currentWeek={currentWeek} options={curriculumWeekOptions} />
      <article><span>Grade 11 · {currentWeek}</span><strong>{grade11?.topic ?? "Topic not set"}</strong><small>{grade11?.unit}</small></article>
      <article><span>Grade 12 · {currentWeek}</span><strong>{grade12?.topic ?? "Topic not set"}</strong><small>{grade12?.unit}</small></article>
    </section>

    <section className="teacher-stats"><article><span>Students</span><strong>{studentCount ?? 0}</strong></article><article><span>Classes</span><strong>{classes?.length ?? 0}</strong></article><article><span>Assignments</span><strong>{assignmentCount ?? 0}</strong></article></section>

    <section className="teacher-section"><div className="section-row"><div><p className="eyebrow">Your classes</p><h2>Classrooms</h2></div><Link className="teacher-button" href="/teacher/classes">Manage classes</Link></div>
      {classes?.length ? <div className="class-overview">{classes.map((classroom) => { const topic = curriculumTopic(classroom.grade_level, currentWeek); return <Link href={`/teacher/classes/${classroom.id}`} key={classroom.id}><span>Grade {classroom.grade_level} · {counts.get(classroom.id) ?? 0} students</span><strong>{classroom.name}</strong><small>{currentWeek}: {topic?.topic ?? "Topic not set"}</small><b>→</b></Link>; })}</div> : <div className="compact-empty"><h3>No classes yet.</h3><p>Create or sync a class to begin.</p></div>}
    </section>
  </main>;
}
