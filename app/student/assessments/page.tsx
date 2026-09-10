import Link from "next/link";
import LogoutButton from "../logout-button";
import StudentAssessments from "./student-assessments";
import { requireStudent } from "@/lib/auth";
import { getStudentAssignments } from "@/lib/student-assignments";

type AssessmentFilter = "todo" | "in-progress" | "completed" | "all";

function assessmentFilter(value: string | string[] | undefined): AssessmentFilter {
  const filter = Array.isArray(value) ? value[0] : value;
  return filter === "todo" || filter === "in-progress" || filter === "completed" || filter === "all" ? filter : "todo";
}

export default async function AssessmentsPage({ searchParams }: { searchParams: Promise<{ filter?: string | string[] }> }) {
  await requireStudent();
  const { filter } = await searchParams;
  const { assignments } = await getStudentAssignments();
  return <main className="student-page"><div className="student-container student-dashboard-container"><header className="student-header"><Link className="auth-brand" href="/student"><span className="brand-mark" aria-hidden="true">∑</span>Jaguar Math</Link><nav aria-label="Student navigation" className="student-header-actions"><Link aria-current="page" href="/student/assessments">Assessments</Link><Link href="/student/progress">Progress</Link><Link href="/student/sat-math">SAT Math info</Link><LogoutButton /></nav></header><section className="dashboard-welcome"><p className="eyebrow">Student space</p><h1>Your assessments.</h1><p>Start, continue, and review work assigned by your teachers.</p></section><StudentAssessments assignments={assignments} initialFilter={assessmentFilter(filter)} /></div></main>;
}
