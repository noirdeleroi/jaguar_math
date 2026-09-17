import { NextResponse } from "next/server";
import { requireTeacher } from "@/lib/auth";
import { normalizeFinalGradeOverride } from "@/lib/classroom-final-grade";
import { createClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ id: string; topicId: string; studentId: string }> };

async function loadEditableGradeContext(id: string, topicId: string, studentId: string, teacherId: string) {
  const supabase = await createClient();
  const [{ data: classroom }, { data: topic }, { data: member }] = await Promise.all([
    supabase.from("classes").select("id").eq("id", id).eq("teacher_id", teacherId).maybeSingle(),
    supabase.from("classroom_weeks").select("id, final_grade_formula, final_grade_max").eq("id", topicId).eq("class_id", id).maybeSingle(),
    supabase.from("class_members").select("student_id").eq("class_id", id).eq("student_id", studentId).maybeSingle(),
  ]);
  return { supabase, classroom, topic, member };
}

export async function PUT(request: Request, context: RouteContext) {
  try {
    const teacher = await requireTeacher();
    const { id, topicId, studentId } = await context.params;
    const body = await request.json() as { score?: unknown; comment?: unknown };
    const { supabase, classroom, topic, member } = await loadEditableGradeContext(id, topicId, studentId, teacher.id);
    if (!classroom || !topic || !member) return NextResponse.json({ error: "That final-grade cell was not found." }, { status: 404 });
    if (!topic.final_grade_formula) return NextResponse.json({ error: "Configure this topic’s final grade before overriding a student grade." }, { status: 400 });

    let override: { score: number; comment: string };
    try {
      override = normalizeFinalGradeOverride(body.score, typeof body.comment === "string" ? body.comment : "", Number(topic.final_grade_max));
    } catch (cause) {
      return NextResponse.json({ error: cause instanceof Error ? cause.message : "Check the final grade." }, { status: 400 });
    }

    const { data, error } = await supabase.from("classroom_final_grade_overrides")
      .upsert({ week_id: topicId, student_id: studentId, score: override.score, comment: override.comment, updated_by: teacher.id }, { onConflict: "week_id,student_id" })
      .select("score, comment")
      .single();
    if (error) throw error;
    return NextResponse.json({ override: { score: Number(data.score), comment: data.comment } }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    console.error("[class-gradebook] final grade override save failed", typeof cause === "object" && cause && "code" in cause ? String(cause.code) : "server_error");
    return NextResponse.json({ error: "Jaguar could not save that final grade." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const teacher = await requireTeacher();
    const { id, topicId, studentId } = await context.params;
    const { supabase, classroom, topic, member } = await loadEditableGradeContext(id, topicId, studentId, teacher.id);
    if (!classroom || !topic || !member) return NextResponse.json({ error: "That final-grade cell was not found." }, { status: 404 });
    const { error } = await supabase.from("classroom_final_grade_overrides").delete().eq("week_id", topicId).eq("student_id", studentId);
    if (error) throw error;
    return NextResponse.json({ override: null }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    console.error("[class-gradebook] final grade override delete failed", typeof cause === "object" && cause && "code" in cause ? String(cause.code) : "server_error");
    return NextResponse.json({ error: "Jaguar could not restore the calculated final grade." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
