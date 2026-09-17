import Link from "next/link";
import { requireTeacher } from "@/lib/auth";
import type { ClassNoteRecord } from "@/lib/class-notes";
import { createClient } from "@/lib/supabase/server";
import NotesBoard from "./notes-board";
import styles from "./notes.module.css";

export default async function TeacherNotesPage() {
  const teacher = await requireTeacher();
  const supabase = await createClient();
  const { data: classrooms, error: classesError } = await supabase.from("classes").select("id, name, grade_level, academic_year").eq("teacher_id", teacher.id).order("grade_level").order("name");
  if (classesError) throw new Error("Your classes could not be loaded. Please retry the page.");

  let notes: ClassNoteRecord[] = [];
  if (classrooms?.length) {
    const { data, error } = await supabase.from("class_notes").select("id, class_id, body, created_at").in("class_id", classrooms.map((classroom) => classroom.id)).order("created_at", { ascending: false });
    if (error) throw new Error("Your class notes could not be loaded. Please retry the page.");
    notes = (data ?? []) as ClassNoteRecord[];
  }

  return <main className={`teacher-main ${styles.page}`}>
    <section className={styles.heading}>
      <div>
        <p className="eyebrow">Lesson markers</p>
        <h1>Class notes</h1>
        <p>Keep a quick record of where each class stopped and what should happen next.</p>
      </div>
      {classrooms?.length ? <div className={styles.summary} aria-label={`${classrooms.length} classes and ${notes.length} notes`}><strong>{classrooms.length}</strong><span>classes in view</span></div> : null}
    </section>

    {classrooms?.length
      ? <NotesBoard classrooms={classrooms} initialNotes={notes} />
      : <section className={styles.emptyClasses}><h2>No classes yet</h2><p>Create a class first, then its planning notes will appear here.</p><Link href="/teacher/classes">Create a class</Link></section>}
  </main>;
}
