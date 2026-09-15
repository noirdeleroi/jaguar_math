import { NextResponse } from "next/server";
import { requireTeacher } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export async function PATCH(request: Request, context: { params: Promise<{ id: string; columnId: string }> }) {
  try {
    const teacher = await requireTeacher();
    const { id, columnId } = await context.params;
    const body = await request.json() as { weekLabel?: unknown; assessmentDate?: unknown; title?: unknown; maxScore?: unknown };
    if (typeof body.weekLabel !== "string" || typeof body.assessmentDate !== "string" || !datePattern.test(body.assessmentDate)) return NextResponse.json({ error: "Choose a valid week and date." }, { status: 400 });
    const supabase = await createClient();
    const [{ data: classroom }, { data: week }, { data: column }] = await Promise.all([
      supabase.from("classes").select("id").eq("id", id).eq("teacher_id", teacher.id).maybeSingle(),
      supabase.from("classroom_weeks").select("id, label").eq("class_id", id).eq("label", body.weekLabel).maybeSingle(),
      supabase.from("classroom_grade_columns").select("id, source, title, max_score").eq("id", columnId).eq("class_id", id).maybeSingle(),
    ]);
    if (!classroom || !column) return NextResponse.json({ error: "That test column was not found." }, { status: 404 });
    if (!week) return NextResponse.json({ error: "That week does not belong to this class." }, { status: 400 });
    const values: Record<string, unknown> = { week_id: week.id, assessment_date: body.assessmentDate };
    let title = column.title;
    let maxScore = column.max_score === null ? null : Number(column.max_score);
    if (column.source === "manual") {
      title = typeof body.title === "string" ? body.title.trim() : "";
      maxScore = typeof body.maxScore === "number" ? body.maxScore : Number(body.maxScore);
      if (!title || title.length > 120 || !Number.isFinite(maxScore) || maxScore <= 0 || maxScore > 100000) return NextResponse.json({ error: "Enter a title and a positive maximum score." }, { status: 400 });
      const { data: grades } = await supabase.from("classroom_manual_grades").select("score").eq("column_id", columnId).order("score", { ascending: false }).limit(1);
      if (grades?.length && Number(grades[0].score) > maxScore) return NextResponse.json({ error: `The maximum cannot be below the existing grade ${Number(grades[0].score)}.` }, { status: 400 });
      values.title = title;
      values.max_score = maxScore;
    }
    const { data, error } = await supabase.from("classroom_grade_columns").update(values).eq("id", columnId).eq("class_id", id).select("id, assessment_date").single();
    if (error) throw error;
    return NextResponse.json({ column: { id: data.id, weekLabel: week.label, assessmentDate: data.assessment_date, title, maxScore } }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    console.error("[class-gradebook] column update failed", typeof cause === "object" && cause && "code" in cause ? String(cause.code) : "server_error");
    return NextResponse.json({ error: "Jaguar could not update that test column." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string; columnId: string }> }) {
  try {
    const teacher = await requireTeacher();
    const { id, columnId } = await context.params;
    const supabase = await createClient();
    const { data: classroom } = await supabase.from("classes").select("id").eq("id", id).eq("teacher_id", teacher.id).maybeSingle();
    if (!classroom) return NextResponse.json({ error: "That class is not available." }, { status: 404 });
    const { data, error } = await supabase.from("classroom_grade_columns").delete().eq("id", columnId).eq("class_id", id).select("id").maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "That test column was not found." }, { status: 404 });
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    console.error("[class-gradebook] column delete failed", typeof cause === "object" && cause && "code" in cause ? String(cause.code) : "server_error");
    return NextResponse.json({ error: "Jaguar could not delete that test column." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
