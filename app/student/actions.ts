"use server";

import { requireStudent } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function startOrContinueAssignment(assignmentId: string) {
  const student = await requireStudent(); const supabase = await createClient();
  const { data: active } = await supabase.from("attempts").select("id").eq("assignment_id", assignmentId).eq("student_id", student.id).eq("status", "in_progress").maybeSingle();
  if (active) return { attemptId: active.id };
  const { data, error } = await supabase.rpc("start_attempt", { p_assignment_id: assignmentId });
  return error || !data ? { error: "This assignment is no longer available to start." } : { attemptId: data.id as string };
}

export async function startOrContinueExamAssignment(assignmentId: string) {
  const student = await requireStudent(); const supabase = await createClient();
  const { data: active } = await supabase.from("attempts").select("id").eq("assignment_id", assignmentId).eq("student_id", student.id).eq("status", "in_progress").maybeSingle();
  if (active) return { attemptId: active.id };
  const { data, error } = await supabase.rpc("start_exam_attempt", { p_assignment_id: assignmentId });
  return error || !data ? { error: "This Exam Mode assignment is no longer available to start." } : { attemptId: data.id as string };
}

export async function saveStudentResponse(attemptId: string, questionId: string, answer: string) {
  await requireStudent(); const supabase = await createClient(); const { error } = await supabase.rpc("save_response", { p_attempt_id: attemptId, p_question_id: questionId, p_student_answer: answer });
  return error ? { error: "Your response could not be saved. The time window may have closed." } : { ok: true };
}

export async function submitStudentAttempt(attemptId: string) {
  await requireStudent(); const supabase = await createClient(); const { error } = await supabase.rpc("submit_attempt", { p_attempt_id: attemptId });
  return error ? { error: "Your attempt could not be submitted." } : { ok: true };
}

export async function submitExamAttempt(attemptId: string) {
  await requireStudent(); const supabase = await createClient(); const { error } = await supabase.rpc("submit_exam_attempt", { p_attempt_id: attemptId });
  return error ? { error: "Your attempt could not be submitted." } : { ok: true };
}

export type ExamActivityEvent = "page_hidden" | "page_visible" | "window_blur" | "window_focus" | "fullscreen_exited" | "fullscreen_restored" | "fullscreen_unavailable";

export async function recordExamActivity(attemptId: string, clientEventId: string, eventType: ExamActivityEvent, awayDurationSeconds?: number) {
  await requireStudent(); const supabase = await createClient();
  const { data, error } = await supabase.rpc("record_exam_activity", { p_attempt_id: attemptId, p_client_event_id: clientEventId, p_event_type: eventType, p_away_duration_seconds: awayDurationSeconds ?? null });
  if (error) {
    console.error(`record_exam_activity failed: code=${error.code}; message=${error.message}; details=${error.details ?? "none"}; hint=${error.hint ?? "none"}`);
    return { error: "Exam activity could not be recorded. Your saved answers are unaffected." };
  }
  const row = Array.isArray(data) ? data[0] : data;
  return { focusViolations: Number(row?.focus_violations ?? 0), autoSubmitted: Boolean(row?.auto_submitted) };
}
