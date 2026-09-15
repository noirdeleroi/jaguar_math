import { NextResponse } from "next/server";
import { requireTeacher } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

type GradeColumnBody = {
  source?: unknown;
  assignmentId?: unknown;
  weekLabel?: unknown;
  assessmentDate?: unknown;
  title?: unknown;
  maxScore?: unknown;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function validDate(value: unknown): value is string {
  return typeof value === "string" && datePattern.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`));
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const teacher = await requireTeacher();
    const { id } = await context.params;
    const body = await request.json() as GradeColumnBody;
    if ((body.source !== "assessment" && body.source !== "manual") || typeof body.weekLabel !== "string" || !validDate(body.assessmentDate)) {
      return NextResponse.json({ error: "Choose a valid topic, date, and test type." }, { status: 400 });
    }

    const supabase = await createClient();
    const [{ data: classroom }, { data: week }] = await Promise.all([
      supabase.from("classes").select("id").eq("id", id).eq("teacher_id", teacher.id).maybeSingle(),
      supabase.from("classroom_weeks").select("id, label").eq("class_id", id).eq("label", body.weekLabel).maybeSingle(),
    ]);
    if (!classroom) return NextResponse.json({ error: "That class is not available." }, { status: 404 });
    if (!week) return NextResponse.json({ error: "That topic does not belong to this class." }, { status: 400 });

    let values: Record<string, unknown>;
    if (body.source === "assessment") {
      if (typeof body.assignmentId !== "string" || !uuidPattern.test(body.assignmentId)) return NextResponse.json({ error: "Choose an assessment." }, { status: 400 });
      const [{ data: assignment }, { data: assignmentClass }] = await Promise.all([
        supabase.from("assignments").select("id, title").eq("id", body.assignmentId).eq("created_by", teacher.id).in("status", ["published", "closed"]).maybeSingle(),
        supabase.from("assignment_classes").select("assignment_id").eq("assignment_id", body.assignmentId).eq("class_id", id).maybeSingle(),
      ]);
      if (!assignment || !assignmentClass) return NextResponse.json({ error: "That assessment is not assigned to this class." }, { status: 400 });
      values = { class_id: id, week_id: week.id, title: assignment.title, assessment_date: body.assessmentDate, source: "assessment", assignment_id: assignment.id, max_score: null, created_by: teacher.id };
    } else {
      const title = typeof body.title === "string" ? body.title.trim() : "";
      const maxScore = typeof body.maxScore === "number" ? body.maxScore : Number(body.maxScore);
      if (!title || title.length > 120 || !Number.isFinite(maxScore) || maxScore <= 0 || maxScore > 100000) return NextResponse.json({ error: "Enter a title and a positive maximum score." }, { status: 400 });
      values = { class_id: id, week_id: week.id, title, assessment_date: body.assessmentDate, source: "manual", assignment_id: null, max_score: maxScore, created_by: teacher.id };
    }

    const { data, error } = await supabase.from("classroom_grade_columns").insert(values).select("id, title, assessment_date, source, assignment_id, max_score").single();
    if (error?.code === "23505") return NextResponse.json({ error: "That assessment is already in this class manager." }, { status: 409 });
    if (error) throw error;
    return NextResponse.json({ column: { id: data.id, weekLabel: week.label, title: data.title, assessmentDate: data.assessment_date, source: data.source, assignmentId: data.assignment_id, maxScore: data.max_score === null ? null : Number(data.max_score), average: null, scores: {} } }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    console.error("[class-gradebook] column create failed", typeof cause === "object" && cause && "code" in cause ? String(cause.code) : "server_error");
    return NextResponse.json({ error: "Jaguar could not add that test column." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
