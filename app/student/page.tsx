import { requireStudent } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import StudentDashboard, { type DashboardAssignment } from "./student-dashboard";

type Assignment = { id: string; title: string; description: string | null; kind: string; status: "published" | "closed"; due_at: string | null; max_attempts: number; show_score_after_submit: boolean };
type Attempt = { id: string; assignment_id: string; status: "in_progress" | "submitted"; started_at: string; submitted_at: string | null; score: number | null; max_score: number | null; attempt_number: number };
type Response = { attempt_id: string; question_id: string; student_answer: string | null };

function assignmentPriority(assignment: DashboardAssignment) {
  if (assignment.status === "Overdue" && assignment.action === "continue") return 0;
  if (assignment.action === "continue" && assignment.dueAt) return 1;
  if (assignment.action === "start" && assignment.dueAt) return 2;
  if (assignment.action === "continue") return 3;
  if (assignment.action === "start") return 4;
  return 5;
}

function currentTime() {
  return Date.now();
}

export default async function StudentPage() {
  const student = await requireStudent(); const supabase = await createClient();
  const [{ data: classes }, { data: assignments }, { data: attempts }] = await Promise.all([
    supabase.from("classes").select("id, name, grade_level, academic_year").order("grade_level").order("name"),
    supabase.from("assignments").select("id, title, description, kind, status, due_at, max_attempts, show_score_after_submit").in("status", ["published", "closed"]),
    supabase.from("attempts").select("id, assignment_id, status, started_at, submitted_at, score, max_score, attempt_number").eq("student_id", student.id).order("attempt_number", { ascending: false }),
  ]);
  const assignmentRows = (assignments ?? []) as Assignment[]; const assignmentIds = assignmentRows.map((assignment) => assignment.id); const attemptRows = (attempts ?? []) as Attempt[]; const attemptIds = attemptRows.map((attempt) => attempt.id);
  const [{ data: links }, { data: composition }, { data: responses }] = await Promise.all([
    assignmentIds.length ? supabase.from("assignment_classes").select("assignment_id, class_id").in("assignment_id", assignmentIds) : Promise.resolve({ data: [] as { assignment_id: string; class_id: string }[] }),
    assignmentIds.length ? supabase.from("assignment_questions").select("assignment_id, question_id").in("assignment_id", assignmentIds) : Promise.resolve({ data: [] as { assignment_id: string; question_id: string }[] }),
    attemptIds.length ? supabase.from("responses").select("attempt_id, question_id, student_answer").in("attempt_id", attemptIds) : Promise.resolve({ data: [] as Response[] }),
  ]);
  const classNameById = new Map((classes ?? []).map((classroom) => [classroom.id, classroom.name])); const classNames = [...classNameById.values()]; const classesByAssignment = new Map<string, Set<string>>(); const questionCountByAssignment = new Map<string, number>(); const attemptsByAssignment = new Map<string, Attempt[]>(); const answeredByAttempt = new Map<string, number>();
  for (const link of links ?? []) classesByAssignment.set(link.assignment_id, new Set([...(classesByAssignment.get(link.assignment_id) ?? []), classNameById.get(link.class_id) ?? ""]));
  for (const question of composition ?? []) questionCountByAssignment.set(question.assignment_id, (questionCountByAssignment.get(question.assignment_id) ?? 0) + 1);
  for (const attempt of attemptRows) attemptsByAssignment.set(attempt.assignment_id, [...(attemptsByAssignment.get(attempt.assignment_id) ?? []), attempt]);
  for (const response of (responses ?? []) as Response[]) if (response.student_answer?.trim()) answeredByAttempt.set(response.attempt_id, (answeredByAttempt.get(response.attempt_id) ?? 0) + 1);

  const now = currentTime(); const dashboardAssignments: DashboardAssignment[] = assignmentRows.map((assignment) => {
    const assignmentAttempts = attemptsByAssignment.get(assignment.id) ?? []; const active = assignmentAttempts.find((attempt) => attempt.status === "in_progress"); const submitted = assignmentAttempts.filter((attempt) => attempt.status === "submitted").sort((left, right) => new Date(right.submitted_at ?? 0).getTime() - new Date(left.submitted_at ?? 0).getTime())[0]; const overdue = assignment.status === "published" && Boolean(assignment.due_at && new Date(assignment.due_at).getTime() < now);
    const questionCount = questionCountByAssignment.get(assignment.id) ?? 0; let status: DashboardAssignment["status"]; let action: DashboardAssignment["action"] = null; let actionable = false;
    if (assignment.status === "closed" && submitted) { status = "Completed"; action = "review"; }
    else if (assignment.status === "closed") { status = "Closed"; action = "view"; }
    else if (active) { status = overdue ? "Overdue" : "In progress"; action = "continue"; actionable = true; }
    else if (submitted) { status = "Completed"; action = "review"; }
    else if (overdue) { status = "Overdue"; action = "view"; }
    else { status = "Not started"; action = "start"; actionable = true; }
    return { id: assignment.id, title: assignment.title, description: assignment.description, kind: assignment.kind, dueAt: assignment.due_at, classNames: [...(classesByAssignment.get(assignment.id) ?? [])].filter(Boolean), status, questionCount, answeredCount: active ? answeredByAttempt.get(active.id) ?? 0 : 0, score: submitted?.score ?? null, maxScore: submitted?.max_score ?? null, showScore: assignment.show_score_after_submit, submittedAt: submitted?.submitted_at ?? null, action, actionable, completed: Boolean(submitted), overdue };
  });
  dashboardAssignments.sort((left, right) => {
    const leftUnfinished = left.actionable; const rightUnfinished = right.actionable;
    if (leftUnfinished !== rightUnfinished) return leftUnfinished ? -1 : 1;
    if (leftUnfinished) { const priority = assignmentPriority(left) - assignmentPriority(right); if (priority) return priority; const leftDue = left.dueAt ? new Date(left.dueAt).getTime() : Number.POSITIVE_INFINITY; const rightDue = right.dueAt ? new Date(right.dueAt).getTime() : Number.POSITIVE_INFINITY; return leftDue - rightDue; }
    if (left.completed !== right.completed) return left.completed ? -1 : 1;
    return new Date(right.submittedAt ?? 0).getTime() - new Date(left.submittedAt ?? 0).getTime();
  });
  return <StudentDashboard assignments={dashboardAssignments} classes={classNames} email={student.email} firstName={student.full_name?.trim().split(/\s+/)[0] || "student"} />;
}
