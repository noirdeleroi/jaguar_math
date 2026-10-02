import { NextResponse } from "next/server";
import { requireTeacher } from "@/lib/auth";
import { normalizeClassworkGradeNote } from "@/lib/classroom-classwork-note";
import { createClient } from "@/lib/supabase/server";

export async function PUT(request: Request, context: { params: Promise<{ id: string; topicId: string; studentId: string }> }) {
  try {
    const teacher = await requireTeacher();
    const { id, topicId, studentId } = await context.params;
    const body = await request.json() as { note?: unknown };
    const normalized = normalizeClassworkGradeNote(body.note);
    if (normalized.error) return NextResponse.json({ error: normalized.error }, { status: 400 });

    const supabase = await createClient();
    const [{ data: classroom }, { data: topic }, { data: member }] = await Promise.all([
      supabase.from("classes").select("id").eq("id", id).eq("teacher_id", teacher.id).maybeSingle(),
      supabase.from("classroom_weeks").select("id, grading_mode").eq("id", topicId).eq("class_id", id).maybeSingle(),
      supabase.from("class_members").select("student_id").eq("class_id", id).eq("student_id", studentId).maybeSingle(),
    ]);
    if (!classroom || !topic || !member) return NextResponse.json({ error: "That topic or student is not available in this class." }, { status: 404 });
    if (topic.grading_mode !== "classwork") return NextResponse.json({ error: "This topic uses Stars & Skulls." }, { status: 400 });

    if (!normalized.note) {
      const { error } = await supabase.from("classroom_topic_classwork_notes").delete().eq("week_id", topicId).eq("student_id", studentId);
      if (error) throw error;
      return NextResponse.json({ note: "" }, { headers: { "Cache-Control": "no-store" } });
    }

    const { data, error } = await supabase.from("classroom_topic_classwork_notes")
      .upsert({ week_id: topicId, student_id: studentId, note: normalized.note, updated_by: teacher.id }, { onConflict: "week_id,student_id" })
      .select("note")
      .single();
    if (error) throw error;
    return NextResponse.json({ note: data.note }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    console.error("[class-gradebook] classwork note update failed", typeof cause === "object" && cause && "code" in cause ? String(cause.code) : "server_error");
    return NextResponse.json({ error: "Jaguar could not save that classwork note." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
