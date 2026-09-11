import { NextResponse } from "next/server";
import { requireTeacher } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string; recordId: string }> }) {
  try {
    const teacher = await requireTeacher();
    const { id, recordId } = await context.params;
    const supabase = await createClient();
    const { data: classroom } = await supabase.from("classes").select("id").eq("id", id).eq("teacher_id", teacher.id).maybeSingle();
    if (!classroom) return NextResponse.json({ error: "That class is not available." }, { status: 404 });
    const { data, error } = await supabase.from("classroom_cw_records").delete().eq("id", recordId).eq("class_id", id).select("id").maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "That classwork record was not found." }, { status: 404 });
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    console.error("[class-manager] CW record delete failed", typeof cause === "object" && cause && "code" in cause ? String(cause.code) : "server_error");
    return NextResponse.json({ error: "Jaguar could not delete that classwork record." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
