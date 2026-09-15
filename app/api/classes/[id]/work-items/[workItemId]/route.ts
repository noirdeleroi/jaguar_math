import { NextResponse } from "next/server";
import { requireTeacher } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function PATCH(request: Request, context: { params: Promise<{ id: string; workItemId: string }> }) {
  try {
    const teacher = await requireTeacher();
    const { id, workItemId } = await context.params;
    const body = await request.json() as { title?: unknown; activityDate?: unknown };
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const activityDate = body.activityDate === null || body.activityDate === "" ? null : body.activityDate;
    if (!title || title.length > 120 || (activityDate !== null && (typeof activityDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(activityDate) || Number.isNaN(Date.parse(`${activityDate}T12:00:00Z`))))) {
      return NextResponse.json({ error: "Enter a valid name and date." }, { status: 400 });
    }
    const supabase = await createClient();
    const { data: classroom } = await supabase.from("classes").select("id").eq("id", id).eq("teacher_id", teacher.id).maybeSingle();
    if (!classroom) return NextResponse.json({ error: "That class is not available." }, { status: 404 });
    const { data, error } = await supabase.from("classroom_work_items").update({ title, activity_date: activityDate }).eq("id", workItemId).eq("class_id", id).select("id, title, activity_date").maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "That homework or classwork column was not found." }, { status: 404 });
    return NextResponse.json({ item: { id: data.id, title: data.title, activityDate: data.activity_date } }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    console.error("[class-manager] work item update failed", typeof cause === "object" && cause && "code" in cause ? String(cause.code) : "server_error");
    return NextResponse.json({ error: "Jaguar could not update that homework or classwork column." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string; workItemId: string }> }) {
  try {
    const teacher = await requireTeacher();
    const { id, workItemId } = await context.params;
    const supabase = await createClient();
    const { data: classroom } = await supabase.from("classes").select("id").eq("id", id).eq("teacher_id", teacher.id).maybeSingle();
    if (!classroom) return NextResponse.json({ error: "That class is not available." }, { status: 404 });
    const { data, error } = await supabase.from("classroom_work_items").delete().eq("id", workItemId).eq("class_id", id).select("id").maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "That homework or classwork column was not found." }, { status: 404 });
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    console.error("[class-manager] work item delete failed", typeof cause === "object" && cause && "code" in cause ? String(cause.code) : "server_error");
    return NextResponse.json({ error: "Jaguar could not delete that homework or classwork column." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
