import Link from "next/link";
import { Suspense } from "react";
import LogoutButton from "@/app/student/logout-button";
import { requireTeacher } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const links = [{ href: "/teacher", label: "Dashboard" }, { href: "/teacher/classes", label: "Classes" }, { href: "/teacher/notes", label: "Notes" }, { href: "/teacher/stars", label: "Stars" }, { href: "/teacher/students", label: "Students" }, { href: "/teacher/assignments", label: "Assignments" }, { href: "/teacher/questions", label: "Question Bank" }, { href: "/teacher/google-classroom", label: "Google Classroom" }];
const classManagerLabels = ["11A", "11B", "11C", "12A", "12B", "12C"] as const;

async function TeacherName() {
  const teacher = await requireTeacher();
  return <span>{teacher.full_name || "Teacher"}</span>;
}

async function ClassManagerShortcuts() {
  const teacher = await requireTeacher();
  const supabase = await createClient();
  const { data: classes, error } = await supabase.from("classes").select("id, name, grade_level").eq("teacher_id", teacher.id).order("grade_level").order("name");
  if (error) {
    console.error(`[teacher-nav] class shortcuts failed: code=${error.code}; message=${error.message}`);
    return null;
  }

  const availableClasses = [...(classes ?? [])];
  const classesByLabel = new Map<string, (typeof availableClasses)[number]>();
  for (const label of classManagerLabels) {
    const grade = Number(label.slice(0, 2));
    const section = label.slice(-1);
    const matchIndex = availableClasses.findIndex((classroom) => {
      if (classroom.grade_level !== grade) return false;
      const normalizedName = classroom.name.toUpperCase().replace(/[^A-Z0-9]/g, "");
      return normalizedName.includes(label) || normalizedName.endsWith(section);
    });
    if (matchIndex >= 0) classesByLabel.set(label, availableClasses.splice(matchIndex, 1)[0]);
  }

  for (const label of classManagerLabels) {
    if (classesByLabel.has(label)) continue;
    const grade = Number(label.slice(0, 2));
    const fallbackIndex = availableClasses.findIndex((classroom) => classroom.grade_level === grade);
    if (fallbackIndex >= 0) classesByLabel.set(label, availableClasses.splice(fallbackIndex, 1)[0]);
  }

  return <nav aria-label="Class manager shortcuts" className="teacher-class-shortcuts"><span>Class managers</span>{classManagerLabels.map((label) => {
    const classroom = classesByLabel.get(label);
    return classroom ? <Link href={`/teacher/classes/${classroom.id}`} key={label} title={`Open ${classroom.name} class manager`}>{label}</Link> : <span aria-disabled="true" className="unavailable" key={label} title={`${label} has not been created`}>{label}</span>;
  })}</nav>;
}

export default function TeacherNav() {
  return <header className="teacher-nav"><Link className="auth-brand" href="/teacher"><span className="brand-mark" aria-hidden="true">∑</span>Jaguar Math</Link><nav aria-label="Teacher navigation">{links.map((link) => <Link href={link.href} key={link.href}>{link.label}</Link>)}</nav><div className="teacher-account"><Suspense fallback={<span aria-label="Loading teacher name">Teacher</span>}><TeacherName /></Suspense><LogoutButton /></div><Suspense fallback={null}><ClassManagerShortcuts /></Suspense></header>;
}
