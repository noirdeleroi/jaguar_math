"use server";

import { revalidatePath } from "next/cache";
import { requireTeacher } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type SeatingChartSaveState = {
  status: "idle" | "success" | "error";
  message: string;
  savedLayout: string;
  savedAt?: string;
};

type Position = { id: string; x: number; y: number };
type SeatingLayout = { version: 1; tables: Position[]; students: Position[] };

const textFrom = (value: FormDataEntryValue | null) => typeof value === "string" ? value.trim() : "";
const validCoordinate = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
const validId = (value: unknown) => typeof value === "string" && value.length > 0 && value.length <= 80;

function parseLayout(value: string): SeatingLayout | null {
  if (!value || value.length > 100_000) return null;
  try {
    const layout = JSON.parse(value) as Partial<SeatingLayout>;
    if (layout.version !== 1 || !Array.isArray(layout.tables) || !Array.isArray(layout.students)) return null;
    if (layout.tables.length > 100 || layout.students.length > 500) return null;
    const positionsAreValid = (items: Position[]) => items.every((item) => validId(item?.id) && validCoordinate(item?.x) && validCoordinate(item?.y));
    if (!positionsAreValid(layout.tables) || !positionsAreValid(layout.students)) return null;
    if (new Set(layout.tables.map(({ id }) => id)).size !== layout.tables.length || new Set(layout.students.map(({ id }) => id)).size !== layout.students.length) return null;
    return { version: 1, tables: layout.tables, students: layout.students };
  } catch {
    return null;
  }
}

export async function saveSeatingChart(previous: SeatingChartSaveState, formData: FormData): Promise<SeatingChartSaveState> {
  const teacher = await requireTeacher();
  const classId = textFrom(formData.get("class_id"));
  const serializedLayout = textFrom(formData.get("layout"));
  const layout = parseLayout(serializedLayout);
  if (!classId || !layout) return { ...previous, status: "error", message: "This seating chart could not be saved. Refresh and try again." };

  const supabase = await createClient();
  const [{ data: classroom, error: classError }, { data: memberships, error: membershipError }] = await Promise.all([
    supabase.from("classes").select("id").eq("id", classId).eq("teacher_id", teacher.id).maybeSingle(),
    supabase.from("class_members").select("student_id").eq("class_id", classId),
  ]);
  if (classError || !classroom || membershipError) return { ...previous, status: "error", message: "That class is not available." };

  const memberIds = new Set((memberships ?? []).map(({ student_id }) => student_id));
  if (layout.students.length !== memberIds.size || layout.students.some(({ id }) => !memberIds.has(id))) {
    return { ...previous, status: "error", message: "The class roster changed. Refresh the page before saving." };
  }

  const normalized = JSON.stringify(layout);
  const { error } = await supabase.from("class_seating_charts").upsert({ class_id: classId, teacher_id: teacher.id, layout }, { onConflict: "class_id" });
  if (error) {
    console.error("[teacher] seating chart save failed", error.code);
    return { ...previous, status: "error", message: "We couldn’t save this seating chart. Please try again." };
  }

  revalidatePath(`/teacher/classes/${classId}/sitting`);
  return { status: "success", message: "Seating chart saved.", savedLayout: normalized, savedAt: new Date().toISOString() };
}
