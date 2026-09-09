import type { ReactNode } from "react";
import { createClient } from "@/lib/supabase/server";
import ResultsOverviewClient, { type AssignmentResultsOverview } from "./results-overview-client";

type ClassOption = { id: string; name: string; grade_level: number };

export default async function AssignmentResultsOverview({ assignmentId, classes, selectedClassId, examMode = false, allowedFocusExits = 0, tabbed = false, questionSet }: { assignmentId: string; classes: ClassOption[]; selectedClassId?: string; examMode?: boolean; allowedFocusExits?: number; tabbed?: boolean; questionSet?: ReactNode }) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_assignment_results_overview", { p_assignment_id: assignmentId, p_class_id: selectedClassId ?? null });
  if (error || !data) return <section className="teacher-section results-section"><h2>Results overview</h2><p className="form-note">Results are not available right now. Refresh the page and try again.</p></section>;
  const overview = data as AssignmentResultsOverview;
  const { data: attempts } = examMode ? await supabase.from("attempts").select("id, student_id, status, attempt_number, form_code, exam_focus_violations, offline_recovery_used, offline_recovery_seconds").eq("assignment_id", assignmentId).order("attempt_number", { ascending: false }) : { data: [] as { id: string; student_id: string; status: string; attempt_number: number; form_code: string | null; exam_focus_violations: number; offline_recovery_used: boolean; offline_recovery_seconds: number }[] };
  const attemptById = new Map((attempts ?? []).map((attempt) => [attempt.id, attempt])); const latestByStudent = new Map<string, (typeof attempts extends (infer T)[] | null ? T : never)>();
  for (const attempt of attempts ?? []) if (!latestByStudent.has(attempt.student_id)) latestByStudent.set(attempt.student_id, attempt);
  const withExamActivity: AssignmentResultsOverview = { ...overview, students: overview.students.map((student) => { const attempt = student.attempt_id ? attemptById.get(student.attempt_id) : latestByStudent.get(student.student_id); return { ...student, focus_violations: attempt?.exam_focus_violations ?? 0, form_code: attempt?.form_code ?? null, offline_recovery_used: attempt?.offline_recovery_used ?? false, offline_recovery_seconds: attempt?.offline_recovery_seconds ?? 0 }; }) };
  const exportHref = `/teacher/assignments/${assignmentId}/results.csv${selectedClassId ? `?classId=${encodeURIComponent(selectedClassId)}` : ""}`;
  return <section className="teacher-section results-section"><div className="section-row"><div><p className="eyebrow">Assignment insights</p><h2>Results overview</h2></div><div className="results-toolbar"><form className="results-class-filter" method="get"><label>Class<select defaultValue={selectedClassId ?? ""} name="classId"><option value="">All assigned classes</option>{classes.map((classroom) => <option key={classroom.id} value={classroom.id}>{classroom.name} · Grade {classroom.grade_level}</option>)}</select></label><button className="secondary-inline-button" type="submit">Filter</button></form><a className="secondary-inline-button" href={exportHref}>Export CSV</a></div></div><ResultsOverviewClient allowedFocusExits={allowedFocusExits} assignmentId={assignmentId} examMode={examMode} overview={withExamActivity} questionSet={questionSet} tabbed={tabbed} /></section>;
}
