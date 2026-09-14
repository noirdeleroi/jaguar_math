import type { ReactNode } from "react";
import { createClient } from "@/lib/supabase/server";
import ResultsOverviewClient, { type AssignmentResultsOverview } from "./results-overview-client";

type ClassOption = { id: string; name: string; grade_level: number };
type TestRosterRow = { student_id: string; attempt_id: string | null; attempt_number: number | null; status: "submitted" | "in_progress" | "not_started"; started_at: string | null; submitted_at: string | null; expires_at: string | null; teacher_extra_minutes: number; answered_count: number; total_questions: number; last_activity_at: string | null; focus_violations: number; form_code: string | null; offline_recovery_used: boolean; offline_recovery_seconds: number };

export default async function AssignmentResultsOverview({ assignmentId, assignmentKind, classes, selectedClassId, examMode = false, allowedFocusExits = 0, live = false, tabbed = false, questionSet }: { assignmentId: string; assignmentKind: string; classes: ClassOption[]; selectedClassId?: string; examMode?: boolean; allowedFocusExits?: number; live?: boolean; tabbed?: boolean; questionSet?: ReactNode }) {
  const supabase = await createClient();
  if (assignmentKind === "homework") {
    const { error: finalizationError } = await supabase.rpc("finalize_overdue_homework_attempts", { p_assignment_id: assignmentId });
    if (finalizationError) console.error(`[assignment-results] overdue homework finalization failed: code=${finalizationError.code}; message=${finalizationError.message}`);
  }
  const { data, error } = await supabase.rpc("get_assignment_results_overview", { p_assignment_id: assignmentId, p_class_id: selectedClassId ?? null });
  if (error || !data) return <section className="teacher-section results-section"><h2>Results overview</h2><p className="form-note">Results are not available right now. Refresh the page and try again.</p></section>;
  const overview = data as AssignmentResultsOverview;
  const { data: rosterData, error: rosterError } = examMode ? await supabase.rpc("get_owned_test_roster", { p_assignment_id: assignmentId, p_class_id: selectedClassId ?? null }) : { data: [] as TestRosterRow[], error: null };
  if (rosterError) console.error(`[teacher-test-manager] roster load failed: code=${rosterError.code}; message=${rosterError.message}`);
  const rosterByStudent = new Map(((rosterData ?? []) as TestRosterRow[]).map((row) => [row.student_id, row]));
  const withExamActivity: AssignmentResultsOverview = { ...overview, students: overview.students.map((student) => { const attempt = rosterByStudent.get(student.student_id); return { ...student, attempt_id: attempt?.attempt_id ?? student.attempt_id, attempt_number: attempt?.attempt_number ?? student.attempt_number, status: attempt?.status ?? student.status, started_at: attempt?.started_at ?? null, expires_at: attempt?.expires_at ?? null, answered_count: Number(attempt?.answered_count ?? 0), total_questions: Number(attempt?.total_questions ?? overview.questions.length), last_activity_at: attempt?.last_activity_at ?? null, extra_time_minutes: Number(attempt?.teacher_extra_minutes ?? 0), focus_violations: Number(attempt?.focus_violations ?? 0), form_code: attempt?.form_code ?? null, offline_recovery_used: attempt?.offline_recovery_used ?? false, offline_recovery_seconds: Number(attempt?.offline_recovery_seconds ?? 0) }; }) };
  const exportHref = `/teacher/assignments/${assignmentId}/results.csv${selectedClassId ? `?classId=${encodeURIComponent(selectedClassId)}` : ""}`;
  return <section className="teacher-section results-section"><div className="section-row"><div><p className="eyebrow">Assignment insights</p><h2>Results overview</h2></div><div className="results-toolbar"><form className="results-class-filter" method="get"><label>Class<select defaultValue={selectedClassId ?? ""} name="classId"><option value="">All assigned classes</option>{classes.map((classroom) => <option key={classroom.id} value={classroom.id}>{classroom.name} · Grade {classroom.grade_level}</option>)}</select></label><button className="secondary-inline-button" type="submit">Filter</button></form><a className="secondary-inline-button" href={exportHref}>Export CSV</a></div></div><ResultsOverviewClient allowedFocusExits={allowedFocusExits} assignmentId={assignmentId} examMode={examMode} live={live} overview={withExamActivity} questionSet={questionSet} tabbed={tabbed} /></section>;
}
