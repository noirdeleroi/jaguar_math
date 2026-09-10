import { NextResponse } from "next/server";
import { requireTeacher } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { ClassroomSyncPayload, WorkKind, WorkStatus } from "@/lib/classroom-stars";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const weekLabelPattern = /^.{1,30}$/u;
const workKinds = new Set<WorkKind>(["homework", "classwork"]);
const statuses = new Set<WorkStatus | "">(["done", "late", "missing", "ok", "not_ok", ""]);

function validPayload(value: unknown): value is ClassroomSyncPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as ClassroomSyncPayload;
  if (![payload.weeks, payload.starEvents, payload.workItems, payload.workStatuses].every(Array.isArray)) return false;
  if (payload.weeks.length + payload.starEvents.length + payload.workItems.length + payload.workStatuses.length > 2500) return false;
  return payload.weeks.every((week) => uuidPattern.test(week.id) && weekLabelPattern.test(week.label) && Number.isInteger(week.sort_order) && week.sort_order > 0)
    && payload.starEvents.every((event) => uuidPattern.test(event.id) && uuidPattern.test(event.student_id) && weekLabelPattern.test(event.week_label) && Number.isInteger(event.delta) && event.delta !== 0 && Math.abs(event.delta) <= 100000 && !Number.isNaN(Date.parse(event.occurred_at)))
    && payload.workItems.every((item) => uuidPattern.test(item.id) && weekLabelPattern.test(item.week_label) && workKinds.has(item.kind) && Number.isInteger(item.position) && item.position > 0 && item.title.trim().length > 0 && item.title.trim().length <= 120)
    && payload.workStatuses.every((status) => uuidPattern.test(status.student_id) && weekLabelPattern.test(status.week_label) && workKinds.has(status.kind) && Number.isInteger(status.position) && status.position > 0 && statuses.has(status.status));
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const teacher = await requireTeacher();
    const { id } = await context.params;
    const payload: unknown = await request.json();
    if (!validPayload(payload)) return NextResponse.json({ error: "The pending classroom changes were not valid. Nothing was saved." }, { status: 400 });

    const supabase = await createClient();
    const { data: classroom } = await supabase.from("classes").select("id").eq("id", id).eq("teacher_id", teacher.id).maybeSingle();
    if (!classroom) return NextResponse.json({ error: "That class is not available." }, { status: 404 });
    const { data, error } = await supabase.rpc("apply_classroom_star_sync", {
      p_class_id: id,
      p_weeks: payload.weeks,
      p_star_events: payload.starEvents,
      p_work_items: payload.workItems,
      p_work_statuses: payload.workStatuses,
    });
    if (error) throw error;
    return NextResponse.json({ ok: true, savedAt: new Date().toISOString(), result: data }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    console.error("[classroom-stars] sync failed", typeof cause === "object" && cause && "code" in cause ? String(cause.code) : "server_error");
    return NextResponse.json({ error: "Jaguar could not save these changes yet. They remain safely queued in this browser." }, { status: 503 });
  }
}
