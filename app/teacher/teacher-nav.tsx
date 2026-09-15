import Link from "next/link";
import { Suspense } from "react";
import LogoutButton from "@/app/student/logout-button";
import { requireTeacher } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const links = [{ href: "/teacher", label: "Dashboard" }, { href: "/teacher/classes", label: "Classes" }, { href: "/teacher/stars", label: "Stars" }, { href: "/teacher/students", label: "Students" }, { href: "/teacher/assignments", label: "Assignments" }, { href: "/teacher/questions", label: "Question Bank" }, { href: "/teacher/google-classroom", label: "Google Classroom" }];
const classManagerLabels = ["11A", "11B", "11C", "12A", "12B", "12C"] as const;

async function TeacherName() {
  const teacher = await requireTeacher();
  return <span>{teacher.full_name || "Teacher"}</span>;
}

async function ClassManagerShortcuts() {
  const teacher = await requireTeacher();
  const supabase = await createClient();
  const { data: classes, error } = await supabase.from("classes").select("id, name").eq("teacher_id", teacher.id);
  if (error) {
    console.error(`[teacher-nav] class shortcuts failed: code=${error.code}; message=${error.message}`);
    return null;
  }

  const classesByLabel = new Map((classes ?? []).map((classroom) => [classroom.name.replace(/\s+/g, "").toUpperCase(), classroom.id]));
  return <nav aria-label="Class manager shortcuts" className="teacher-class-shortcuts"><span>Class managers</span>{classManagerLabels.map((label) => {
    const classId = classesByLabel.get(label);
    return classId ? <Link href={`/teacher/classes/${classId}`} key={label}>{label}</Link> : <span aria-disabled="true" className="unavailable" key={label} title={`${label} has not been created`}>{label}</span>;
  })}</nav>;
}

export default function TeacherNav() {
  return <header className="teacher-nav"><Link className="auth-brand" href="/teacher"><span className="brand-mark" aria-hidden="true">∑</span>Jaguar Math</Link><nav aria-label="Teacher navigation">{links.map((link) => <Link href={link.href} key={link.href}>{link.label}</Link>)}</nav><div className="teacher-account"><Suspense fallback={<span aria-label="Loading teacher name">Teacher</span>}><TeacherName /></Suspense><LogoutButton /></div><Suspense fallback={null}><ClassManagerShortcuts /></Suspense></header>;
}
