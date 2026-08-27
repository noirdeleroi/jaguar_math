import type { ReactNode } from "react";
import { requireTeacher } from "@/lib/auth";
import TeacherNav from "./teacher-nav";

export default async function TeacherLayout({ children }: { children: ReactNode }) {
  const teacher = await requireTeacher();
  return <div className="teacher-shell"><TeacherNav teacherName={teacher.full_name} />{children}</div>;
}
