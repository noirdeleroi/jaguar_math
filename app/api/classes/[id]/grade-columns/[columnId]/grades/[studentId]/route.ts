import { NextResponse } from "next/server";
import { requireTeacher } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { projectGrades, type ProjectDocument } from "@/lib/business-poster-project";
import { revalidatePath } from "next/cache";

export async function PUT(request: Request, context: { params: Promise<{ id: string; columnId: string; studentId: string }> }) {
  try {
    const teacher = await requireTeacher();
    const { id, columnId, studentId } = await context.params;
    const body = await request.json() as { score?: unknown };
    if (body.score !== null && typeof body.score !== "number") return NextResponse.json({ error: "Enter a numeric grade, or clear the cell." }, { status: 400 });
    const score = body.score;
    if (score !== null && (!Number.isFinite(score) || score < 0)) return NextResponse.json({ error: "Enter a grade of zero or more." }, { status: 400 });
    const supabase = await createClient();
    const [{ data: classroom }, { data: column }, { data: member }] = await Promise.all([
      supabase.from("classes").select("id").eq("id", id).eq("teacher_id", teacher.id).maybeSingle(),
      supabase.from("classroom_grade_columns").select("id, max_score, source, assignment_id").eq("id", columnId).eq("class_id", id).maybeSingle(),
      supabase.from("class_members").select("student_id").eq("class_id", id).eq("student_id", studentId).maybeSingle(),
    ]);
    if (!classroom || !column || !member) return NextResponse.json({ error: "That grade cell was not found." }, { status: 404 });
    let maxScore = Number(column.max_score);
    if (column.source === "assessment") {
      const [{ data: questions, error: questionError }, { data: attempts, error: attemptError }] = await Promise.all([
        supabase.from("assignment_questions").select("points").eq("assignment_id", column.assignment_id),
        supabase.from("attempts").select("id").eq("assignment_id", column.assignment_id).eq("student_id", studentId).eq("status", "submitted").gt("max_score", 0).not("score", "is", null).limit(1),
      ]);
      if (questionError || attemptError) throw questionError ?? attemptError;
      if (score !== null && attempts?.length) return NextResponse.json({ error: "This student now has a submitted result. Open their attempt to change the grade." }, { status: 409 });
      maxScore = (questions ?? []).reduce((sum, q) => sum + Number(q.points), 0);
    } else if (column.source === "project" && score !== null) {
      const { data: project, error } = await supabase.from("classroom_projects").select("document").eq("column_id", column.id).eq("class_id", id).maybeSingle();
      if (error) throw error;
      if (project && projectGrades(project.document as ProjectDocument, new Set([studentId]))[studentId]) return NextResponse.json({ error: "This student now has a project result. Open the project to change the grade." }, { status: 409 });
    }
    if (!Number.isFinite(maxScore) || maxScore <= 0) return NextResponse.json({ error: "This assessment has no maximum score yet." }, { status: 400 });
    if (score !== null && score > maxScore) return NextResponse.json({ error: `Grade must be between 0 and ${maxScore}.` }, { status: 400 });
    if (score === null) {
      const { error } = await supabase.from("classroom_manual_grades").delete().eq("column_id", columnId).eq("student_id", studentId);
      if (error) throw error;
    } else {
      const { error } = await supabase.from("classroom_manual_grades").upsert({ column_id: columnId, student_id: studentId, score, updated_by: teacher.id }, { onConflict: "column_id,student_id" });
      if (error?.code === "P0001") return NextResponse.json({ error: error.message }, { status: 409 });
      if (error) throw error;
    }
    revalidatePath(`/teacher/classes/${id}`);
    revalidatePath(`/teacher/students/${studentId}`);
    revalidatePath("/student", "layout");
    return NextResponse.json({ grade: score === null ? null : { attemptId: null, isManual: true, score, maxScore, percent: Math.round(score / maxScore * 100) } }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    console.error("[class-gradebook] manual grade save failed", typeof cause === "object" && cause && "code" in cause ? String(cause.code) : "server_error");
    return NextResponse.json({ error: "Jaguar could not save that grade." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
