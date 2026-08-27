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
  const parsed = Number(text(value)); return Number.isInteger(parsed) ? parsed : fallback;
};
const classIds = (formData: FormData) => formData.getAll("class_ids").filter((value): value is string => typeof value === "string" && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value));
const dueAt = (value: FormDataEntryValue | null) => {
  const raw = text(value); if (!raw) return null; const parsed = new Date(raw); return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
};

function settings(formData: FormData) {
  const title = text(formData.get("title")); const description = text(formData.get("description")); const kind = text(formData.get("kind")); const duration = text(formData.get("duration_minutes")) ? integer(formData.get("duration_minutes"), null) : null; const maxAttempts = integer(formData.get("max_attempts"), 0); const due = dueAt(formData.get("due_at"));
  if (!title || !["homework", "quiz", "test"].includes(kind) || duration === undefined || (duration !== null && duration <= 0) || !maxAttempts || maxAttempts < 1 || due === undefined) return null;
  return { title, description, kind, due_at: due, duration_minutes: duration, max_attempts: maxAttempts, show_score_after_submit: checked(formData.get("show_score_after_submit")), show_answers_after_submit: checked(formData.get("show_answers_after_submit")), shuffle_questions: checked(formData.get("shuffle_questions")), class_ids: classIds(formData) };
}

export async function createAssignment(formData: FormData) {
  await requireTeacher(); const values = settings(formData); const rawQuestions = text(formData.get("questions_json"));
  if (!values || values.class_ids.length === 0) redirect(message("/teacher/assignments/new", "error", "Complete the assignment settings and select at least one class."));
  let parsed: unknown; try { parsed = JSON.parse(rawQuestions); } catch { redirect(message("/teacher/assignments/new", "error", "Validate the question import before saving.")); }
  const validated = validateAssignmentImport({ questions: parsed });
  if (!validated.data) redirect(message("/teacher/assignments/new", "error", validated.errors[0] ?? "The questions are invalid."));
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_assignment_draft", { p_title: values.title, p_description: values.description, p_kind: values.kind, p_due_at: values.due_at, p_duration_minutes: values.duration_minutes, p_max_attempts: values.max_attempts, p_show_score_after_submit: values.show_score_after_submit, p_show_answers_after_submit: values.show_answers_after_submit, p_shuffle_questions: values.shuffle_questions, p_class_ids: values.class_ids, p_questions: validated.data.questions });
  if (error || !data) redirect(message("/teacher/assignments/new", "error", "The draft could not be saved. Check the selected classes and questions."));
  revalidatePath("/teacher"); revalidatePath("/teacher/assignments"); redirect(`/teacher/assignments/${data}`);
}

export async function updateAssignment(formData: FormData) {
  const teacher = await requireTeacher(); const id = text(formData.get("assignment_id")); const values = settings(formData); const path = `/teacher/assignments/${id}`;
  if (!id || !values || values.class_ids.length === 0) redirect(message(path, "error", "Complete the assignment settings and select at least one class."));
  const supabase = await createClient(); const { error } = await supabase.rpc("update_owned_assignment", { p_assignment_id: id, p_title: values.title, p_description: values.description, p_kind: values.kind, p_due_at: values.due_at, p_duration_minutes: values.duration_minutes, p_max_attempts: values.max_attempts, p_show_score_after_submit: values.show_score_after_submit, p_show_answers_after_submit: values.show_answers_after_submit, p_shuffle_questions: values.shuffle_questions, p_class_ids: values.class_ids });
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
