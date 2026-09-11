import { NextResponse } from "next/server";
import { requireTeacher } from "@/lib/auth";
import { loadTeacherCurrentWeek } from "@/lib/classroom-star-data";
import type { ClassroomHomeworkAssignment } from "@/lib/classroom-stars";
import { createClient } from "@/lib/supabase/server";

type Assignment = { id: string; title: string; status: "published" | "closed"; due_at: string | null };
type Attempt = { id: string; assignment_id: string; student_id: string; status: "in_progress" | "submitted"; score: number | null; max_score: number | null; attempt_number: number; started_at: string };

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const teacher = await requireTeacher();
    const { id } = await context.params;
    const supabase = await createClient();
    const [{ data: classroom }, currentWeekLabel] = await Promise.all([
      supabase.from("classes").select("id").eq("id", id).eq("teacher_id", teacher.id).maybeSingle(),
      loadTeacherCurrentWeek(teacher.id),
    ]);
    if (!classroom) return NextResponse.json({ error: "That class is not available." }, { status: 404 });

    const [{ data: links, error: linkError }, { data: members, error: memberError }] = await Promise.all([
      supabase.from("assignment_classes").select("assignment_id").eq("class_id", id),
      supabase.from("class_members").select("student_id").eq("class_id", id),
    ]);
    if (linkError || memberError) throw linkError ?? memberError;
    const assignmentIds = (links ?? []).map((link) => link.assignment_id);
    const studentIds = (members ?? []).map((member) => member.student_id);
    if (!assignmentIds.length) return NextResponse.json({ assignments: [] }, { headers: { "Cache-Control": "no-store" } });

    const { data: assignmentRows, error: assignmentError } = await supabase.from("assignments").select("id, title, status, due_at").in("id", assignmentIds).eq("created_by", teacher.id).eq("include_in_class_manager", true).eq("kind", "homework").in("status", ["published", "closed"]).order("due_at", { ascending: true, nullsFirst: false });
    if (assignmentError) throw assignmentError;
    const assignments = (assignmentRows ?? []) as Assignment[];
    const visibleAssignmentIds = assignments.map((assignment) => assignment.id);
    const { data: attemptRows, error: attemptError } = visibleAssignmentIds.length && studentIds.length
      ? await supabase.from("attempts").select("id, assignment_id, student_id, status, score, max_score, attempt_number, started_at").in("assignment_id", visibleAssignmentIds).in("student_id", studentIds).in("status", ["in_progress", "submitted"]).order("attempt_number", { ascending: false }).order("started_at", { ascending: false })
      : { data: [] as Attempt[], error: null };
    if (attemptError) throw attemptError;

    const latestActivity = new Map<string, Attempt>();
    const latestSubmitted = new Map<string, Attempt>();
    for (const attempt of (attemptRows ?? []) as Attempt[]) {
      const key = `${attempt.student_id}|${attempt.assignment_id}`;
      if (!latestActivity.has(key)) latestActivity.set(key, attempt);
      if (attempt.status === "submitted" && !latestSubmitted.has(key)) latestSubmitted.set(key, attempt);
    }

    const payload: ClassroomHomeworkAssignment[] = assignments.map((assignment) => ({
      id: assignment.id,
      title: assignment.title,
      status: assignment.status,
      dueAt: assignment.due_at,
      weekLabel: currentWeekLabel,
      results: Object.fromEntries(studentIds.map((studentId) => {
        const key = `${studentId}|${assignment.id}`;
        const activity = latestActivity.get(key);
        const submitted = latestSubmitted.get(key);
        const maxScore = submitted?.max_score === null || submitted?.max_score === undefined ? null : Number(submitted.max_score);
        const score = submitted?.score === null || submitted?.score === undefined ? null : Number(submitted.score);
        return [studentId, { attemptId: submitted?.id ?? activity?.id ?? null, status: activity?.status ?? "not_started", score, maxScore, percentage: score !== null && maxScore !== null && maxScore > 0 ? Math.round(score / maxScore * 100) : null }];
      })),
    }));
    return NextResponse.json({ assignments: payload }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    console.error("[class-manager] live assignment results failed", typeof cause === "object" && cause && "code" in cause ? String(cause.code) : "server_error");
    return NextResponse.json({ error: "Live homework results are not available right now." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
