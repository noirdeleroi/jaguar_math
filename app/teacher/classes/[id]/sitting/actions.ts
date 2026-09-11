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
type ChartStudent = Position & { guest?: true; name?: string };
type TableShape = "rectangle" | "oval";
type ChartTable = Position & { shape: TableShape; width: number; height: number };
type SeatingLayout = { version: 1; tables: ChartTable[]; students: ChartStudent[] };

const DEFAULT_TABLE_WIDTH = 13;
const DEFAULT_TABLE_HEIGHT = DEFAULT_TABLE_WIDTH * 16 / 9;
const MINIMUM_TABLE_SIZE = 4;
const textFrom = (value: FormDataEntryValue | null) => typeof value === "string" ? value.trim() : "";
const validCoordinate = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
const validId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 80;
const validGuestName = (value: unknown) => typeof value === "string" && value.trim().length > 0 && value.trim().length <= 80 && !/[\u0000-\u001f\u007f]/.test(value);
const validTableSize = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= MINIMUM_TABLE_SIZE && value <= 90;

function parseTable(value: unknown): ChartTable | null {
  if (!value || typeof value !== "object") return null;
  const table = value as Partial<ChartTable>;
  if (!validId(table.id) || !validCoordinate(table.x) || !validCoordinate(table.y)) return null;
  const width = table.width ?? DEFAULT_TABLE_WIDTH;
  const height = table.height ?? DEFAULT_TABLE_HEIGHT;
  const shape = table.shape ?? "oval";
  if (!validTableSize(width) || !validTableSize(height) || (shape !== "rectangle" && shape !== "oval")) return null;
  if (table.x < width / 2 || table.x > 100 - width / 2 || table.y < height / 2 || table.y > 100 - height / 2) return null;
  return { id: table.id, x: table.x, y: table.y, width, height, shape };
}

function parseLayout(value: string): SeatingLayout | null {
  if (!value || value.length > 100_000) return null;
  try {
    const layout = JSON.parse(value) as Partial<SeatingLayout>;
    if (layout.version !== 1 || !Array.isArray(layout.tables) || !Array.isArray(layout.students)) return null;
    if (layout.tables.length > 100 || layout.students.length > 500) return null;
    const positionsAreValid = (items: Position[]) => items.every((item) => validId(item?.id) && validCoordinate(item?.x) && validCoordinate(item?.y));
    const tables = layout.tables.map(parseTable);
    if (tables.some((table) => !table) || !positionsAreValid(layout.students)) return null;
    if (layout.students.some((student) => student.guest === true ? !student.id.startsWith("guest-") || !validGuestName(student.name) : student.guest !== undefined)) return null;
    if (new Set(layout.tables.map(({ id }) => id)).size !== layout.tables.length || new Set(layout.students.map(({ id }) => id)).size !== layout.students.length) return null;
    return {
      version: 1,
      tables: tables as ChartTable[],
      students: layout.students.map(({ id, x, y, guest, name }) => guest === true ? { id, x, y, guest: true, name: name!.trim() } : { id, x, y }),
    };
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
  const enrolledStudents = layout.students.filter(({ guest }) => guest !== true);
  if (enrolledStudents.length !== memberIds.size || enrolledStudents.some(({ id }) => !memberIds.has(id))) {
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
