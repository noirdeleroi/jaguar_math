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

export async function saveStudentResponse(attemptId: string, questionId: string, answer: string) {
  await requireStudent(); const supabase = await createClient(); const { error } = await supabase.rpc("save_response", { p_attempt_id: attemptId, p_question_id: questionId, p_student_answer: answer });
  return error ? { error: "Your response could not be saved. The time window may have closed." } : { ok: true };
}

export async function submitStudentAttempt(attemptId: string) {
  await requireStudent(); const supabase = await createClient(); const { error } = await supabase.rpc("submit_attempt", { p_attempt_id: attemptId });
  return error ? { error: "Your attempt could not be submitted." } : { ok: true };
}
