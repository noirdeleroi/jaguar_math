import { NextResponse } from "next/server";
import { requireTeacher } from "@/lib/auth";
import { isCurriculumWeek } from "@/lib/curriculum-weeks";
import { createClient } from "@/lib/supabase/server";

export async function PATCH(request: Request) {
  try {
    const teacher = await requireTeacher();
    const body = await request.json() as { weekLabel?: unknown };
    const weekLabel = typeof body.weekLabel === "string" ? body.weekLabel.trim().toUpperCase() : "";
    if (!isCurriculumWeek(weekLabel)) return NextResponse.json({ error: "Choose a week from the curriculum." }, { status: 400 });
    const supabase = await createClient();
    const { error } = await supabase.from("teacher_star_settings").upsert({ teacher_id: teacher.id, current_week_label: weekLabel }, { onConflict: "teacher_id" });
    if (error) throw error;
    return NextResponse.json({ ok: true, weekLabel }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    console.error("[classroom-stars] current week update failed", cause instanceof Error ? cause.name : "server_error");
    return NextResponse.json({ error: "Jaguar could not update the current week." }, { status: 400 });
  }
}
