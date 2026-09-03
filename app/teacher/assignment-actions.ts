"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { validateAssignmentImport } from "@/lib/assignment-import";
import { requireTeacher } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const message = (path: string, key: "error" | "success", value: string) => `${path}?${key}=${encodeURIComponent(value)}`;
const text = (value: FormDataEntryValue | null) => typeof value === "string" ? value.trim() : "";
const checked = (value: FormDataEntryValue | null) => value === "on";
const integer = (value: FormDataEntryValue | null, fallback: number | null) => {
  const raw = text(value); if (!raw) return fallback;
  const parsed = Number(raw); return Number.isInteger(parsed) ? parsed : fallback;
};
const classIds = (formData: FormData) => formData.getAll("class_ids").filter((value): value is string => typeof value === "string" && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value));
const dueAt = (value: FormDataEntryValue | null, timezoneOffset: FormDataEntryValue | null) => {
  const raw = text(value); if (!raw) return null;
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/); const offset = Number(text(timezoneOffset));
  if (!match || !Number.isInteger(offset) || Math.abs(offset) > 840) return undefined;
  const [, year, month, day, hour, minute] = match; const localTimestamp = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute)); const localDate = new Date(localTimestamp);
  if (localDate.getUTCFullYear() !== Number(year) || localDate.getUTCMonth() !== Number(month) - 1 || localDate.getUTCDate() !== Number(day) || localDate.getUTCHours() !== Number(hour) || localDate.getUTCMinutes() !== Number(minute)) return undefined;
  const timestamp = localTimestamp + offset * 60_000;
  return Number.isNaN(timestamp) ? undefined : new Date(timestamp).toISOString();
};
const safeDraftError = (error: { code: string; message: string } | null) => {
  if (!error) return "The draft save did not return an assignment ID. Please try again.";
  if (error.code === "PGRST202" || error.code === "42883") return "The assessment database function is unavailable. Please contact an administrator.";
  if (error.code === "42501") return "You are not authorized to save an assignment for the selected class.";
  if (error.code === "23503") return "One of the selected classes or skills is no longer available.";
  const knownValidationMessages = new Set(["Title is required", "At least one class is required", "Classes must be unique", "A selected class is not managed by this teacher", "At least one question is required", "Duration must be positive", "Maximum attempts must be at least one", "Exam Mode settings are invalid"]);
  if (error.code === "P0001" && knownValidationMessages.has(error.message)) return error.message;
  return "The draft could not be saved. Review the selected class and validated questions, then try again.";
};
export type DraftActionState = { error: string } | null;
export type QuestionBankActionState = { error: string } | null;
export type DraftQuestionActionState = { error?: string; success?: boolean } | null;

function settings(formData: FormData) {
  const title = text(formData.get("title")); const description = text(formData.get("description")); const kind = text(formData.get("kind")); const duration = text(formData.get("duration_minutes")) ? integer(formData.get("duration_minutes"), null) : null; const maxAttempts = integer(formData.get("max_attempts"), 0); const due = dueAt(formData.get("due_at"), formData.get("due_at_timezone_offset"));
  if (!title || !["homework", "quiz", "test"].includes(kind) || duration === undefined || (duration !== null && duration <= 0) || !maxAttempts || maxAttempts < 1 || due === undefined) return null;
  const exam_mode = checked(formData.get("exam_mode")); const exam_allowed_focus_exits = exam_mode ? integer(formData.get("exam_allowed_focus_exits"), 2) : 2; const exam_violation_action = "auto_submit";
  if (exam_allowed_focus_exits === null || exam_allowed_focus_exits < 0) return null;
  return { title, description, kind, due_at: due, duration_minutes: duration, max_attempts: maxAttempts, show_score_after_submit: checked(formData.get("show_score_after_submit")), show_answers_after_submit: checked(formData.get("show_answers_after_submit")), shuffle_questions: checked(formData.get("shuffle_questions")), class_ids: classIds(formData), exam_mode, exam_require_fullscreen: exam_mode ? checked(formData.get("exam_require_fullscreen")) : true, exam_track_focus_exits: exam_mode ? checked(formData.get("exam_track_focus_exits")) : true, exam_allowed_focus_exits, exam_violation_action };
}

export async function createAssignment(_: DraftActionState, formData: FormData): Promise<DraftActionState> {
  const teacher = await requireTeacher(); const values = settings(formData); const rawQuestions = text(formData.get("questions_json"));
  console.info("createAssignment invoked", { teacherId: teacher.id, hasSettings: Boolean(values), classCount: values?.class_ids.length ?? 0, questionPayloadLength: rawQuestions.length });
  if (!values || values.class_ids.length === 0) return { error: "Complete the assignment settings and select at least one class." };
  let parsed: unknown; try { parsed = JSON.parse(rawQuestions); } catch { return { error: "Validate the question import before saving." }; }
  const validated = validateAssignmentImport({ questions: parsed });
  if (!validated.data) return { error: validated.errors[0] ?? "The questions are invalid." };
  // PostgreSQL distinguishes an absent JSON property from a JSON `null`. The RPC
  // accepts omitted options for non-multiple-choice questions, so preserve that
  // distinction when serializing the normalized import for Supabase.
  const rpcQuestions = validated.data.questions.map(({ options, ...question }) => options === null ? question : { ...question, options });
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_assignment_draft_with_exam", { p_title: values.title, p_description: values.description, p_kind: values.kind, p_due_at: values.due_at, p_duration_minutes: values.duration_minutes, p_max_attempts: values.max_attempts, p_show_score_after_submit: values.show_score_after_submit, p_show_answers_after_submit: values.show_answers_after_submit, p_shuffle_questions: values.shuffle_questions, p_class_ids: values.class_ids, p_questions: rpcQuestions, p_exam_mode: values.exam_mode, p_exam_require_fullscreen: values.exam_require_fullscreen, p_exam_track_focus_exits: values.exam_track_focus_exits, p_exam_allowed_focus_exits: values.exam_allowed_focus_exits, p_exam_violation_action: values.exam_violation_action });
  if (error || !data) { if (error) console.error(`create_assignment_draft_with_exam failed: code=${error.code}; message=${error.message}; details=${error.details ?? "none"}; hint=${error.hint ?? "none"}`); return { error: safeDraftError(error) }; }
  revalidatePath("/teacher"); revalidatePath("/teacher/assignments"); redirect(`/teacher/assignments/${data}`);
}

export async function updateAssignment(formData: FormData) {
  const teacher = await requireTeacher(); const id = text(formData.get("assignment_id")); const values = settings(formData); const path = `/teacher/assignments/${id}`;
  if (!id || !values || values.class_ids.length === 0) redirect(message(path, "error", "Complete the assignment settings and select at least one class."));
  const supabase = await createClient(); const { error } = await supabase.rpc("update_owned_assignment_with_exam", { p_assignment_id: id, p_title: values.title, p_description: values.description, p_kind: values.kind, p_due_at: values.due_at, p_duration_minutes: values.duration_minutes, p_max_attempts: values.max_attempts, p_show_score_after_submit: values.show_score_after_submit, p_show_answers_after_submit: values.show_answers_after_submit, p_shuffle_questions: values.shuffle_questions, p_class_ids: values.class_ids, p_exam_mode: values.exam_mode, p_exam_require_fullscreen: values.exam_require_fullscreen, p_exam_track_focus_exits: values.exam_track_focus_exits, p_exam_allowed_focus_exits: values.exam_allowed_focus_exits, p_exam_violation_action: values.exam_violation_action });
  if (error) redirect(message(path, "error", "The assignment could not be updated."));
  revalidatePath("/teacher"); revalidatePath("/teacher/assignments"); revalidatePath(path); redirect(message(path, "success", `Assignment saved by ${teacher.full_name || "teacher"}.`));
}

export async function publishAssignment(formData: FormData) {
  await requireTeacher(); const id = text(formData.get("assignment_id")); const path = `/teacher/assignments/${id}`;
  if (!id) redirect("/teacher/assignments");
  const supabase = await createClient(); const { error } = await supabase.rpc("publish_owned_assignment", { p_assignment_id: id });
  if (error) redirect(message(path, "error", "This assignment needs at least one class and one valid question before publishing."));
  revalidatePath("/teacher"); revalidatePath("/teacher/assignments"); revalidatePath(path); revalidatePath("/student"); redirect(message(path, "success", "Assignment published."));
}

const safeLifecycleError = (error: { code: string; message: string } | null, action: "close" | "reopen") => {
  if (error?.code === "42501") return "You are not authorized to change this assignment.";
  if (error?.code === "P0001" && ["Assignment is not managed by this teacher", "Only published assignments can be closed", "Only closed assignments can be reopened"].includes(error.message)) return "This assignment is no longer available for that change.";
  return `The assignment could not be ${action === "close" ? "closed" : "reopened"}. Please try again.`;
};

export async function closeAssignment(formData: FormData) {
  await requireTeacher(); const id = text(formData.get("assignment_id")); const path = `/teacher/assignments/${id}`;
  if (!uuid(id)) redirect("/teacher/assignments");
  const supabase = await createClient(); const { error } = await supabase.rpc("close_owned_assignment", { p_assignment_id: id });
  if (error) { console.error(`close_owned_assignment failed: code=${error.code}; message=${error.message}; details=${error.details ?? "none"}; hint=${error.hint ?? "none"}`); redirect(message(path, "error", safeLifecycleError(error, "close"))); }
  revalidatePath("/teacher"); revalidatePath("/teacher/assignments"); revalidatePath(path); revalidatePath("/student"); redirect(message(path, "success", "Assignment closed. Students can no longer change or submit attempts."));
}

export async function reopenAssignment(formData: FormData) {
  await requireTeacher(); const id = text(formData.get("assignment_id")); const path = `/teacher/assignments/${id}`;
  if (!uuid(id)) redirect("/teacher/assignments");
  const supabase = await createClient(); const { error } = await supabase.rpc("reopen_owned_assignment", { p_assignment_id: id });
  if (error) { console.error(`reopen_owned_assignment failed: code=${error.code}; message=${error.message}; details=${error.details ?? "none"}; hint=${error.hint ?? "none"}`); redirect(message(path, "error", safeLifecycleError(error, "reopen"))); }
  revalidatePath("/teacher"); revalidatePath("/teacher/assignments"); revalidatePath(path); revalidatePath("/student"); redirect(message(path, "success", "Assignment reopened."));
}

const safeDuplicateError = (error: { code: string; message: string } | null) => {
  if (error?.code === "42501") return "You are not authorized to duplicate this assignment.";
  if (error?.code === "P0001" && error.message === "Assignment is not managed by this teacher") return "This assignment is not available to duplicate.";
  return "The assignment could not be duplicated. Please try again.";
};

export async function duplicateAssignment(formData: FormData) {
  await requireTeacher();
  const id = text(formData.get("assignment_id"));
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)) redirect("/teacher/assignments");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("duplicate_owned_assignment_with_exam", { p_assignment_id: id });
  if (error || !data) {
    if (error) console.error(`duplicate_owned_assignment failed: code=${error.code}; message=${error.message}; details=${error.details ?? "none"}; hint=${error.hint ?? "none"}`);
    redirect(message(`/teacher/assignments/${id}`, "error", safeDuplicateError(error)));
  }
  revalidatePath("/teacher"); revalidatePath("/teacher/assignments"); revalidatePath(`/teacher/assignments/${data}`);
  redirect(message(`/teacher/assignments/${data}`, "success", "Assignment duplicated as a private draft."));
}

const safeQuestionBankError = (error: { code: string; message: string } | null) => {
  if (error?.code === "42501") return "You are not authorized to add questions to this draft.";
  if (error?.code === "P0001" && error.message === "Select at least one question") return "Select at least one question to add.";
  if (error?.code === "P0001" && error.message === "Only drafts managed by this teacher can receive questions") return "Choose one of your private drafts.";
  return "The selected questions could not be added. Please try again.";
};

export async function addQuestionsToDraft(_: QuestionBankActionState, formData: FormData): Promise<QuestionBankActionState> {
  await requireTeacher();
  const assignmentId = text(formData.get("assignment_id"));
  const questionIds = formData.getAll("question_ids").filter((value): value is string => typeof value === "string" && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value));
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(assignmentId)) return { error: "Choose a private draft before adding questions." };
  if (!questionIds.length) return { error: "Select at least one question to add." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("copy_owned_questions_to_draft", { p_assignment_id: assignmentId, p_question_ids: questionIds });
  if (error || !data) {
    if (error) console.error(`copy_owned_questions_to_draft failed: code=${error.code}; message=${error.message}; details=${error.details ?? "none"}; hint=${error.hint ?? "none"}`);
    return { error: safeQuestionBankError(error) };
  }
  revalidatePath("/teacher/questions"); revalidatePath(`/teacher/assignments/${assignmentId}`); revalidatePath("/teacher/assignments");
  redirect(message(`/teacher/assignments/${assignmentId}`, "success", `${data} question${data === 1 ? "" : "s"} added as independent copies.`));
}

const uuid = (value: string) => /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);
const safeDraftQuestionError = (error: { code: string; message: string } | null) => {
  if (error?.code === "42501") return "You are not authorized to change this draft question.";
  const known = new Set(["Only draft questions managed by this teacher can be edited", "Only draft questions managed by this teacher can be removed", "Only drafts managed by this teacher can be reordered", "Question is not part of this draft", "Question cannot be moved further"]);
  if (error?.code === "P0001" && known.has(error.message)) return "This question is no longer available to change in this draft.";
  return "The draft question could not be updated. Please review the fields and try again.";
};

function draftQuestionPayload(formData: FormData) {
  const questionId = text(formData.get("question_id")); const assignmentId = text(formData.get("assignment_id")); const type = text(formData.get("type"));
  if (!uuid(questionId) || !uuid(assignmentId)) return { error: "This draft question is not available." };
  const numericTolerance = Number(text(formData.get("numeric_tolerance"))); const difficulty = Number(text(formData.get("difficulty"))); const points = Number(text(formData.get("points")));
  if (![numericTolerance, difficulty, points].every(Number.isFinite)) return { error: "Tolerance, difficulty, and points must be valid numbers." };
  let options: unknown; let skills: unknown;
  try { options = type === "multiple_choice" ? JSON.parse(text(formData.get("options_json"))) : null; skills = JSON.parse(text(formData.get("skills_json"))); } catch { return { error: "Question options or skills are not valid." }; }
  const validation = validateAssignmentImport({ questions: [{ prompt: text(formData.get("prompt")), type, options, correct_answer: text(formData.get("correct_answer")), numeric_tolerance: numericTolerance, explanation: text(formData.get("explanation")) || null, difficulty, points, skills, icfes_competency: text(formData.get("icfes_competency")) || null }] });
  if (!validation.data) return { error: validation.errors[0] ?? "This question is invalid." };
  return { assignmentId, questionId, question: validation.data.questions[0] };
}

export async function updateDraftQuestion(_: DraftQuestionActionState, formData: FormData): Promise<DraftQuestionActionState> {
  await requireTeacher();
  const payload = draftQuestionPayload(formData);
  if ("error" in payload) return { error: payload.error };
  const supabase = await createClient(); const question = payload.question;
  const { error } = await supabase.rpc("update_owned_draft_question", { p_assignment_id: payload.assignmentId, p_question_id: payload.questionId, p_prompt: question.prompt, p_type: question.type, p_options: question.options, p_correct_answer: question.correct_answer, p_numeric_tolerance: question.numeric_tolerance, p_difficulty: question.difficulty, p_points: question.points, p_explanation: question.explanation, p_icfes_competency: question.icfes_competency, p_skills: question.skills });
  if (error) { console.error(`update_owned_draft_question failed: code=${error.code}; message=${error.message}; details=${error.details ?? "none"}; hint=${error.hint ?? "none"}`); return { error: safeDraftQuestionError(error) }; }
  revalidatePath(`/teacher/assignments/${payload.assignmentId}`); revalidatePath("/teacher/questions");
  return { success: true };
}

export async function removeDraftQuestion(_: DraftQuestionActionState, formData: FormData): Promise<DraftQuestionActionState> {
  await requireTeacher(); const assignmentId = text(formData.get("assignment_id")); const questionId = text(formData.get("question_id"));
  if (!uuid(assignmentId) || !uuid(questionId)) return { error: "This draft question is not available." };
  const supabase = await createClient(); const { error } = await supabase.rpc("remove_owned_draft_question", { p_assignment_id: assignmentId, p_question_id: questionId });
  if (error) { console.error(`remove_owned_draft_question failed: code=${error.code}; message=${error.message}; details=${error.details ?? "none"}; hint=${error.hint ?? "none"}`); return { error: safeDraftQuestionError(error) }; }
  revalidatePath(`/teacher/assignments/${assignmentId}`); revalidatePath("/teacher/questions");
  return { success: true };
}

export async function moveDraftQuestion(_: DraftQuestionActionState, formData: FormData): Promise<DraftQuestionActionState> {
  await requireTeacher(); const assignmentId = text(formData.get("assignment_id")); const questionId = text(formData.get("question_id")); const direction = Number(text(formData.get("direction")));
  if (!uuid(assignmentId) || !uuid(questionId) || ![-1, 1].includes(direction)) return { error: "This question cannot be moved." };
  const supabase = await createClient(); const { error } = await supabase.rpc("move_owned_draft_question", { p_assignment_id: assignmentId, p_question_id: questionId, p_direction: direction });
  if (error) { console.error(`move_owned_draft_question failed: code=${error.code}; message=${error.message}; details=${error.details ?? "none"}; hint=${error.hint ?? "none"}`); return { error: safeDraftQuestionError(error) }; }
  revalidatePath(`/teacher/assignments/${assignmentId}`);
  return { success: true };
}
