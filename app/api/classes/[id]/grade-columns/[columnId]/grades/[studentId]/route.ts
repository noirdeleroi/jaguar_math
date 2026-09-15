import { NextResponse } from "next/server";
import { requireTeacher } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function PUT(request: Request, context: { params: Promise<{ id: string; columnId: string; studentId: string }> }) {
  try {
    const teacher = await requireTeacher();
    const { id, columnId, studentId } = await context.params;
    const body = await request.json() as { score?: unknown };
    const score = body.score === null ? null : typeof body.score === "number" ? body.score : Number(body.score);
    if (score !== null && (!Number.isFinite(score) || score < 0)) return NextResponse.json({ error: "Enter a grade of zero or more." }, { status: 400 });
    const supabase = await createClient();
    const [{ data: classroom }, { data: column }, { data: member }] = await Promise.all([
      supabase.from("classes").select("id").eq("id", id).eq("teacher_id", teacher.id).maybeSingle(),
      supabase.from("classroom_grade_columns").select("id, max_score, source").eq("id", columnId).eq("class_id", id).maybeSingle(),
      supabase.from("class_members").select("student_id").eq("class_id", id).eq("student_id", studentId).maybeSingle(),
    ]);
    if (!classroom || !column || !member) return NextResponse.json({ error: "That manual grade cell was not found." }, { status: 404 });
    const maxScore = Number(column.max_score);
    if (column.source !== "manual" || !Number.isFinite(maxScore)) return NextResponse.json({ error: "Automatic assessment scores cannot be edited here." }, { status: 400 });
    if (score !== null && score > maxScore) return NextResponse.json({ error: `Grade must be between 0 and ${maxScore}.` }, { status: 400 });
    if (score === null) {
      const { error } = await supabase.from("classroom_manual_grades").delete().eq("column_id", columnId).eq("student_id", studentId);
      if (error) throw error;
    } else {
      const { error } = await supabase.from("classroom_manual_grades").upsert({ column_id: columnId, student_id: studentId, score, updated_by: teacher.id }, { onConflict: "column_id,student_id" });
      if (error) throw error;
    }
    return NextResponse.json({ grade: score === null ? null : { attemptId: null, score, maxScore, percent: Math.round(score / maxScore * 100) } }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    console.error("[class-gradebook] manual grade save failed", typeof cause === "object" && cause && "code" in cause ? String(cause.code) : "server_error");
    return NextResponse.json({ error: "Jaguar could not save that grade." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
