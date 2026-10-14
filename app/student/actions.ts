"use server";

import { revalidatePath } from "next/cache";
import { requireStudent } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const notificationUuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

function revalidateAssignmentViews(assignmentId: string) {
  revalidatePath("/student");
  revalidatePath("/student/assessments");
  revalidatePath(`/student/assignments/${assignmentId}`);
  revalidatePath(`/teacher/assignments/${assignmentId}`);
}

export async function markStudentNotificationRead(notificationId: string): Promise<{ ok: true } | { error: string }> {
  const student = await requireStudent();
  if (!notificationUuid.test(notificationId)) return { error: "That notification is not available." };
  const supabase = await createClient();
  const { error } = await supabase.from("student_notifications").update({ read_at: new Date().toISOString() }).eq("id", notificationId).eq("student_id", student.id).is("read_at", null);
  if (error) return { error: "That notification could not be updated." };
  revalidatePath("/student");
  return { ok: true };
}

export async function markAllStudentNotificationsRead(): Promise<{ ok: true } | { error: string }> {
  const student = await requireStudent();
  const supabase = await createClient();
  const { error } = await supabase.from("student_notifications").update({ read_at: new Date().toISOString() }).eq("student_id", student.id).is("read_at", null);
  if (error) return { error: "Notifications could not be updated." };
  revalidatePath("/student");
  return { ok: true };
}

export async function startOrContinueAssignment(assignmentId: string) {
  const student = await requireStudent(); const supabase = await createClient();
  const { data: active } = await supabase.from("attempts").select("id").eq("assignment_id", assignmentId).eq("student_id", student.id).eq("status", "in_progress").maybeSingle();
  if (active) return { attemptId: active.id };
  const { data, error } = await supabase.rpc("start_attempt", { p_assignment_id: assignmentId });
  if (error || !data) return { error: "This assignment is no longer available to start." };
  revalidateAssignmentViews(assignmentId);
  return { attemptId: data.id as string };
}

export async function selectPaperVersionForAnswerEntry(assignmentId: string, paperVersion: number) {
  await requireStudent();
  if (!notificationUuid.test(assignmentId) || !Number.isInteger(paperVersion) || paperVersion < 1 || paperVersion > 4) return { error: "Enter the version number printed on your paper." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("start_my_paper_attempt", { p_assignment_id: assignmentId, p_version: paperVersion });
  if (error || !data) {
    console.error(`start_my_paper_attempt failed: code=${error?.code ?? "unknown"}; message=${error?.message ?? "no data"}`);
    return { error: error?.message.includes("between 1 and") ? error.message : error?.message.includes("answers are saved") ? "Ask your teacher to correct the paper version because answers are already saved." : "That paper version is not available. Check the number printed on your paper." };
  }
  revalidateAssignmentViews(assignmentId);
  return { attemptId: data.id as string, formCode: data.form_code as string };
}

export async function startOrContinueExamAssignment(assignmentId: string) {
  const started = Date.now();
  await requireStudent();
  const supabase = await createClient();
  // The RPC is idempotent per student and enforces assignment/release access.
  const { data: attempt, error } = await supabase.rpc("start_exam_attempt", { p_assignment_id: assignmentId });
  if (error || !attempt) return { error: "This test could not start. Check the connection and try again." };
  const [{ data: form, error: formError }, { data: responses, error: responseError }] = await Promise.all([
    supabase.from("attempt_questions").select("question_id, points, option_order, questions(id, prompt, type, options)").eq("attempt_id", attempt.id).order("position"),
    supabase.from("responses").select("question_id, student_answer, client_revision, is_correct, points_awarded").eq("attempt_id", attempt.id),
  ]);
  if (formError || responseError || !form?.length) {
    console.error(`[exam-launch] questions unavailable; elapsed_ms=${Date.now() - started}; code=${formError?.code ?? responseError?.code ?? "empty"}`);
    return { error: "Your attempt is saved, but the questions could not load. Try again to continue the same attempt." };
  }
  const answers = new Map((responses ?? []).map((row) => [row.question_id, row]));
  const questions = form.flatMap((item) => {
    const question = (Array.isArray(item.questions) ? item.questions[0] : item.questions) as { id: string; prompt: string; type: string; options: { id: string; text: string }[] | null } | null;
    if (!question) return [];
    const options = question.options;
    const ordered = options && item.option_order?.length ? (item.option_order as string[]).flatMap((id) => options.find((option) => option.id === id) ?? []) : options;
    const response = answers.get(item.question_id);
    return [{ ...question, options: ordered?.length === options?.length ? ordered : options, points: Number(item.points), answer: response?.student_answer ?? "", serverRevision: Number(response?.client_revision ?? 0), isCorrect: response?.is_correct ?? null, pointsAwarded: response?.points_awarded ?? null }];
  });
  if (questions.length !== form.length) return { error: "Some questions could not load. Try again to continue the same attempt." };
  console.info(`[exam-launch] ready; elapsed_ms=${Date.now() - started}; questions=${questions.length}`);
  return { attemptId: attempt.id as string, expiresAt: attempt.expires_at as string | null, formCode: attempt.form_code as string | null, focusViolations: Number(attempt.exam_focus_violations ?? 0), questions };
}

export async function saveStudentResponse(attemptId: string, questionId: string, answer: string) {
  await requireStudent(); const supabase = await createClient(); const { error } = await supabase.rpc("save_response", { p_attempt_id: attemptId, p_question_id: questionId, p_student_answer: answer });
  return error ? { error: "Your response could not be saved. The time window may have closed." } : { ok: true };
}

export async function saveStudentResponseWithFeedback(attemptId: string, questionId: string, answer: string): Promise<{ error: string } | { ok: true; isCorrect: boolean; pointsAwarded: number }> {
  await requireStudent(); const supabase = await createClient(); const { data, error } = await supabase.rpc("save_response_with_feedback", { p_attempt_id: attemptId, p_question_id: questionId, p_student_answer: answer });
  const row = Array.isArray(data) ? data[0] : data;
  return error || !row ? { error: "Your response could not be saved. The time window may have closed." } : { ok: true, isCorrect: Boolean(row.is_correct), pointsAwarded: Number(row.points_awarded ?? 0) };
}

export async function checkHomeworkResponse(attemptId: string, questionId: string, answer: string): Promise<{ error: string } | { ok: true; isCorrect: boolean; correctAnswer: string; explanation: string | null }> {
  await requireStudent();
  if (!uuid(attemptId) || !uuid(questionId) || typeof answer !== "string" || answer.length > 20_000) return { error: "That homework response could not be checked." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("check_homework_response", { p_attempt_id: attemptId, p_question_id: questionId, p_student_answer: answer });
  const row = Array.isArray(data) ? data[0] : data;
  return error || !row ? { error: "The solution is not available right now. Your answer is still saved." } : { ok: true, isCorrect: Boolean(row.is_correct), correctAnswer: String(row.correct_answer), explanation: row.explanation === null ? null : String(row.explanation) };
}

export async function submitStudentAttempt(attemptId: string) {
  await requireStudent(); const supabase = await createClient(); const { data, error } = await supabase.rpc("submit_attempt", { p_attempt_id: attemptId });
  if (error || !data) return { error: "Your attempt could not be submitted." };
  revalidateAssignmentViews(data.assignment_id as string);
  return { ok: true };
}

export async function submitExamAttempt(attemptId: string) {
  await requireStudent(); const supabase = await createClient(); const { data, error } = await supabase.rpc("submit_exam_attempt", { p_attempt_id: attemptId });
  if (error || !data) return { error: "Your attempt could not be submitted." };
  revalidateAssignmentViews(data.assignment_id as string);
  return { ok: true };
}

type SubmissionResponse = { questionId: string; answer: string; revision: number };
const uuid = (value: string) => /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);

export async function submitAttemptSnapshot(attemptId: string, responses: SubmissionResponse[], clientSubmittedAt: string, timed: boolean) {
  await requireStudent();
  if (!uuid(attemptId) || !Array.isArray(responses) || responses.length > 200 || responses.some((response) => !response || !uuid(response.questionId) || typeof response.answer !== "string" || response.answer.length > 20_000 || !Number.isSafeInteger(response.revision) || response.revision < 0) || new Set(responses.map((response) => response.questionId)).size !== responses.length || Number.isNaN(new Date(clientSubmittedAt).getTime())) return { error: "The final response snapshot is invalid." };
  const supabase = await createClient();
  const payload = responses.map((response) => ({ question_id: response.questionId, student_answer: response.answer, client_revision: response.revision }));
  const { data, error } = await supabase.rpc("submit_attempt_snapshot", { p_attempt_id: attemptId, p_responses: payload, p_client_submitted_at: clientSubmittedAt, p_timed: timed });
  if (error || !data) return { error: error?.message.includes("recovery window") ? "The offline recovery window has closed. Ask your teacher for help." : "Your assessment could not be submitted. Keep this page open and try again." };
  revalidateAssignmentViews(data.assignment_id as string);
  return { ok: true, recovered: Boolean(data.offline_recovery_used) };
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
