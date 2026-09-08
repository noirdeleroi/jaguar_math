import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTeacher } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import SeatingChart from "./seating-chart";
import styles from "./sitting-chart.module.css";

type Student = { id: string; full_name: string | null };

export default async function SittingChartPage({ params }: PageProps<"/teacher/classes/[id]/sitting">) {
  const teacher = await requireTeacher();
  const { id } = await params;
  const supabase = await createClient();
  const { data: classroom, error: classroomError } = await supabase.from("classes").select("id, name, grade_level, academic_year").eq("id", id).eq("teacher_id", teacher.id).maybeSingle();
  if (classroomError || !classroom) notFound();

  const [{ data: memberships, error: membershipError }, { data: savedChart }] = await Promise.all([
    supabase.from("class_members").select("student_id").eq("class_id", id),
    supabase.from("class_seating_charts").select("layout, updated_at").eq("class_id", id).maybeSingle(),
  ]);
  if (membershipError) throw new Error("Unable to load the class roster.");

  const memberIds = (memberships ?? []).map(({ student_id }) => student_id);
  let students: Student[] = [];
  if (memberIds.length) {
    const { data, error } = await supabase.from("profiles").select("id, full_name").in("id", memberIds).eq("role", "student").order("full_name");
    if (error) throw new Error("Unable to load the class roster.");
    students = data as Student[];
  }

  return <main className={`teacher-main ${styles.page}`}>
    <Link className="back-link" href={`/teacher/classes/${id}`}>← Back to {classroom.name}</Link>
    <section className={styles.heading}>
      <div>
        <p className="eyebrow">Grade {classroom.grade_level} · {classroom.academic_year}</p>
        <h1>Seating chart</h1>
        <p>Build the room, place your students, and save the arrangement for the next class.</p>
      </div>
      <div className={styles.classStamp}><span>Class</span><strong>{classroom.name}</strong><small>{students.length} {students.length === 1 ? "student" : "students"}</small></div>
    </section>
    <SeatingChart classId={id} className={classroom.name} initialLayout={savedChart?.layout ?? null} initialSavedAt={savedChart?.updated_at ?? null} students={students.map((student) => ({ id: student.id, name: student.full_name || "Unnamed student" }))} />
  </main>;
}
