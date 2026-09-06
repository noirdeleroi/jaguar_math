import type { ReactNode } from "react";
import TeacherNav from "./teacher-nav";

export default function TeacherLayout({ children }: { children: ReactNode }) {
  return <div className="teacher-shell"><TeacherNav />{children}</div>;
}
