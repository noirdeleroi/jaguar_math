import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTeacher } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import StudentRandomizer from "./student-randomizer";
import styles from "./student-randomizer.module.css";

export default async function StudentRandomizerPage({ params }: PageProps<"/teacher/classes/[id]/randomizer">) {
  const teacher = await requireTeacher();
  const { id } = await params;
  const supabase = await createClient();
  const { data: classroom, error: classroomError } = await supabase.from("classes").select("id, name, grade_level, academic_year").eq("id", id).eq("teacher_id", teacher.id).maybeSingle();
  if (classroomError || !classroom) notFound();

  const { data: memberships, error: membershipError } = await supabase.from("class_members").select("student_id, nickname").eq("class_id", id).order("nickname");
  if (membershipError) throw new Error("Unable to load the class roster.");

  return <main className={`teacher-main ${styles.page}`}>
    <Link className="back-link" href={`/teacher/classes/${id}`}>← Back to {classroom.name}</Link>
    <section className={styles.heading}>
      <div>
        <p className="eyebrow">Classroom tool</p>
        <h1>Student randomizer</h1>
        <p>Give the wheel a spin and let it choose the next student—fairly, visibly, and with just enough suspense.</p>
      </div>
      <div className={styles.classStamp}><span>Class</span><strong>{classroom.name}</strong><small>Grade {classroom.grade_level} · {classroom.academic_year}</small></div>
    </section>
    <StudentRandomizer students={(memberships ?? []).map((membership) => ({ id: membership.student_id, name: membership.nickname }))} />
  </main>;
}
