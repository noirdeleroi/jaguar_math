"use server";

import { revalidatePath } from "next/cache";
import { requireTeacher } from "@/lib/auth";
import { normalizeClassNote, type ClassNoteActionState, type ClassNoteRecord } from "@/lib/class-notes";
import { createClient } from "@/lib/supabase/server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function createClassNote(_previous: ClassNoteActionState, formData: FormData): Promise<ClassNoteActionState> {
  const teacher = await requireTeacher();
  const classId = formData.get("class_id");
  const normalized = normalizeClassNote(formData.get("body"));
  if (typeof classId !== "string" || !UUID_PATTERN.test(classId)) return { status: "error", message: "That class is not available." };
  if ("error" in normalized) return { status: "error", message: normalized.error };

  const supabase = await createClient();
  const { data: classroom, error: classError } = await supabase.from("classes").select("id").eq("id", classId).eq("teacher_id", teacher.id).maybeSingle();
  if (classError || !classroom) return { status: "error", message: "That class is not available." };

  const { data, error } = await supabase.from("class_notes").insert({ class_id: classId, body: normalized.body }).select("id, class_id, body, created_at").single();
  if (error || !data) {
    console.error(`[class-notes] create failed: code=${error?.code ?? "no_data"}`);
    return { status: "error", message: "We couldn’t save this note. Please try again." };
  }

  revalidatePath("/teacher/notes");
  return { status: "success", note: data as ClassNoteRecord };
}

export async function deleteClassNote(noteId: string): Promise<{ error?: string }> {
  await requireTeacher();
  if (!UUID_PATTERN.test(noteId)) return { error: "That note is not available." };

  const supabase = await createClient();
  const { data, error } = await supabase.from("class_notes").delete().eq("id", noteId).select("id").maybeSingle();
  if (error || !data) {
    console.error(`[class-notes] delete failed: code=${error?.code ?? "not_found"}`);
    return { error: "We couldn’t delete this note. Please try again." };
  }

  revalidatePath("/teacher/notes");
  return {};
}
