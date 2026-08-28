import Link from "next/link";
import LogoutButton from "@/app/student/logout-button";

const links = [{ href: "/teacher", label: "Dashboard" }, { href: "/teacher/classes", label: "Classes" }, { href: "/teacher/students", label: "Students" }, { href: "/teacher/assignments", label: "Assignments" }, { href: "/teacher/questions", label: "Question Bank" }];

export default function TeacherNav({ teacherName }: { teacherName: string | null }) {
  return <header className="teacher-nav"><Link className="auth-brand" href="/teacher"><span className="brand-mark" aria-hidden="true">∑</span>Jaguar Math</Link><nav aria-label="Teacher navigation">{links.map((link) => <Link href={link.href} key={link.href}>{link.label}</Link>)}</nav><div className="teacher-account"><span>{teacherName || "Teacher"}</span><LogoutButton /></div></header>;
}
