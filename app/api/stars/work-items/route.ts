import { NextResponse } from "next/server";
import { requireTeacher } from "@/lib/auth";
import { isCurriculumWeek } from "@/lib/curriculum-weeks";
import { createClient } from "@/lib/supabase/server";

type WorkRequest = { scope?: unknown; weekLabel?: unknown; kind?: unknown; title?: unknown; activityDate?: unknown };

export async function POST(request: Request) {
  try {
    const teacher = await requireTeacher();
    const body = await request.json() as WorkRequest;
    const weekLabel = typeof body.weekLabel === "string" ? body.weekLabel.trim().toUpperCase() : "";
    const kind = body.kind === "homework" || body.kind === "classwork" ? body.kind : "";
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const activityDate = typeof body.activityDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.activityDate) ? body.activityDate : null;
    if (!isCurriculumWeek(weekLabel) || !kind || !title || title.length > 120) return NextResponse.json({ error: "Check the week, type, and title." }, { status: 400 });

    const supabase = await createClient();
    const { data: classes, error: classError } = await supabase.from("classes").select("id").eq("teacher_id", teacher.id);
    if (classError) throw classError;
    const ownedClassIds = (classes ?? []).map((classroom) => classroom.id);
    const classIds = body.scope === "all" ? ownedClassIds : typeof body.scope === "string" && ownedClassIds.includes(body.scope) ? [body.scope] : [];
    if (!classIds.length) return NextResponse.json({ error: "Choose one of your classes or all classes." }, { status: 400 });

    const { data, error } = await supabase.rpc("create_classroom_work_items", {
      p_class_ids: classIds,
      p_week_label: weekLabel,
      p_kind: kind,
      p_title: title,
      p_activity_date: activityDate,
    });
    if (error) throw error;
    return NextResponse.json({ ok: true, created: data }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    console.error("[classroom-stars] bulk work creation failed", cause instanceof Error ? cause.name : "server_error");
    return NextResponse.json({ error: "Jaguar could not create that work record. Nothing was changed." }, { status: 400 });
  }
}
