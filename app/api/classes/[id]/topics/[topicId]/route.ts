import { NextResponse } from "next/server";
import { requireTeacher } from "@/lib/auth";
import { normalizeTopicGradeFormula } from "@/lib/classroom-topic-grade";
import { createClient } from "@/lib/supabase/server";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function PATCH(request: Request, context: { params: Promise<{ id: string; topicId: string }> }) {
  try {
    const teacher = await requireTeacher();
    const { id, topicId } = await context.params;
    const body = await request.json() as { title?: unknown; finalGradeFormula?: unknown; finalGradeMax?: unknown; summativeGradeColumnId?: unknown; makeCurrent?: unknown };
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title || title.length > 120) return NextResponse.json({ error: "Enter a topic name under 120 characters." }, { status: 400 });

    let finalGradeFormula: string;
    try {
      finalGradeFormula = normalizeTopicGradeFormula(typeof body.finalGradeFormula === "string" ? body.finalGradeFormula : "");
    } catch (cause) {
      return NextResponse.json({ error: cause instanceof Error ? cause.message : "Check the final-grade formula." }, { status: 400 });
    }

    const finalGradeMax = typeof body.finalGradeMax === "number" ? body.finalGradeMax : Number(body.finalGradeMax);
    if (!Number.isFinite(finalGradeMax) || finalGradeMax <= 0 || finalGradeMax > 100000) {
      return NextResponse.json({ error: "Enter a final-grade maximum between 0 and 100,000." }, { status: 400 });
    }

    const summativeGradeColumnId = body.summativeGradeColumnId === null || body.summativeGradeColumnId === "" ? null : body.summativeGradeColumnId;
    if (summativeGradeColumnId !== null && (typeof summativeGradeColumnId !== "string" || !uuidPattern.test(summativeGradeColumnId))) {
      return NextResponse.json({ error: "Choose a valid summative test column." }, { status: 400 });
    }

    const supabase = await createClient();
    const [{ data: classroom }, { data: topic }] = await Promise.all([
      supabase.from("classes").select("id").eq("id", id).eq("teacher_id", teacher.id).maybeSingle(),
      supabase.from("classroom_weeks").select("id, label, sort_order, focus, is_current").eq("id", topicId).eq("class_id", id).maybeSingle(),
    ]);
    if (!classroom || !topic) return NextResponse.json({ error: "That topic was not found in this class." }, { status: 404 });

    if (summativeGradeColumnId) {
      const { data: column } = await supabase.from("classroom_grade_columns").select("id").eq("id", summativeGradeColumnId).eq("class_id", id).eq("week_id", topicId).maybeSingle();
      if (!column) return NextResponse.json({ error: "The summative test must belong to this topic." }, { status: 400 });
    }

    if (body.makeCurrent === true && !topic.is_current) {
      const { error: currentTopicError } = await supabase.rpc("set_current_classroom_topic", { p_class_id: id, p_topic_id: topicId });
      if (currentTopicError) throw currentTopicError;
    }

    const { data, error } = await supabase.from("classroom_weeks")
      .update({ title, final_grade_formula: finalGradeFormula, final_grade_max: finalGradeMax, summative_grade_column_id: summativeGradeColumnId })
      .eq("id", topicId)
      .eq("class_id", id)
      .select("id, label, sort_order, title, focus, is_current, final_grade_formula, final_grade_max, summative_grade_column_id")
      .single();
    if (error) throw error;

    return NextResponse.json({
      topic: {
        id: data.id,
        label: data.label,
        sortOrder: data.sort_order,
        title: data.title,
        focus: data.focus,
        isCurrent: data.is_current,
        finalGradeFormula: data.final_grade_formula,
        finalGradeMax: Number(data.final_grade_max),
        summativeGradeColumnId: data.summative_grade_column_id,
      },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    console.error("[class-gradebook] topic update failed", typeof cause === "object" && cause && "code" in cause ? String(cause.code) : "server_error");
    return NextResponse.json({ error: "Jaguar could not save those topic settings." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
