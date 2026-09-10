import Link from "next/link";
import { Suspense } from "react";
import LogoutButton from "@/app/student/logout-button";
import { requireTeacher } from "@/lib/auth";

const links = [{ href: "/teacher", label: "Dashboard" }, { href: "/teacher/classes", label: "Classes" }, { href: "/teacher/stars", label: "Stars" }, { href: "/teacher/students", label: "Students" }, { href: "/teacher/assignments", label: "Assignments" }, { href: "/teacher/questions", label: "Question Bank" }, { href: "/teacher/google-classroom", label: "Google Classroom" }];

async function TeacherName() {
  const teacher = await requireTeacher();
  return <span>{teacher.full_name || "Teacher"}</span>;
}

export default function TeacherNav() {
  return <header className="teacher-nav"><Link className="auth-brand" href="/teacher"><span className="brand-mark" aria-hidden="true">∑</span>Jaguar Math</Link><nav aria-label="Teacher navigation">{links.map((link) => <Link href={link.href} key={link.href}>{link.label}</Link>)}</nav><div className="teacher-account"><Suspense fallback={<span aria-label="Loading teacher name">Teacher</span>}><TeacherName /></Suspense><LogoutButton /></div></header>;
}
