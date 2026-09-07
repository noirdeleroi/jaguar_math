import Link from "next/link";
import LogoutButton from "../logout-button";
import StudentAssessments from "./student-assessments";
import { requireStudent } from "@/lib/auth";
import { getStudentAssignments } from "@/lib/student-assignments";

export default async function AssessmentsPage() {
  const student = await requireStudent();
  const { assignments } = await getStudentAssignments(student.id);
  return <main className="student-page"><div className="student-container student-dashboard-container"><header className="student-header"><Link className="auth-brand" href="/student"><span className="brand-mark" aria-hidden="true">∑</span>Jaguar Math</Link><nav aria-label="Student navigation" className="student-header-actions"><Link aria-current="page" href="/student/assessments">Assessments</Link><Link href="/student/progress">Progress</Link><Link href="/student/sat-math">SAT Math info</Link><LogoutButton /></nav></header><section className="dashboard-welcome"><p className="eyebrow">Student space</p><h1>Your assessments.</h1><p>Start, continue, and review work assigned by your teachers.</p></section><StudentAssessments assignments={assignments} /></div></main>;
}
