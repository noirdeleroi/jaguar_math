import { NextResponse } from "next/server";
import { requireTeacher } from "@/lib/auth";
import type { ClassroomCwRecord } from "@/lib/classroom-stars";
import { createClient } from "@/lib/supabase/server";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const teacher = await requireTeacher();
    const { id } = await context.params;
    const supabase = await createClient();
    const { data: classroom } = await supabase.from("classes").select("id").eq("id", id).eq("teacher_id", teacher.id).maybeSingle();
    if (!classroom) return NextResponse.json({ error: "That class is not available." }, { status: 404 });
    const { data, error } = await supabase.from("classroom_cw_records").select("id, student_id, record_date, reason, classroom_weeks!inner(label)").eq("class_id", id).order("record_date", { ascending: false }).order("created_at", { ascending: false });
    if (error) throw error;
    const records: ClassroomCwRecord[] = (data ?? []).flatMap((row) => {
      const week = Array.isArray(row.classroom_weeks) ? row.classroom_weeks[0] : row.classroom_weeks;
      return week?.label ? [{ id: row.id, studentId: row.student_id, weekLabel: week.label, recordDate: row.record_date, reason: row.reason }] : [];
    });
    return NextResponse.json({ records }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    console.error("[class-manager] CW records load failed", typeof cause === "object" && cause && "code" in cause ? String(cause.code) : "server_error");
    return NextResponse.json({ error: "Classwork records are not available right now." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const teacher = await requireTeacher();
    const { id } = await context.params;
    const body = await request.json() as { studentId?: unknown; weekLabel?: unknown; recordDate?: unknown; reason?: unknown };
    const studentId = typeof body.studentId === "string" ? body.studentId : "";
    const weekLabel = typeof body.weekLabel === "string" ? body.weekLabel.trim() : "";
    const recordDate = typeof body.recordDate === "string" ? body.recordDate : "";
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (!uuidPattern.test(studentId) || !weekLabel || weekLabel.length > 30 || !datePattern.test(recordDate) || !reason || reason.length > 500) return NextResponse.json({ error: "Enter a valid date and a reason of up to 500 characters." }, { status: 400 });

    const supabase = await createClient();
    const [{ data: classroom }, { data: week }, { data: member }] = await Promise.all([
      supabase.from("classes").select("id").eq("id", id).eq("teacher_id", teacher.id).maybeSingle(),
      supabase.from("classroom_weeks").select("id").eq("class_id", id).eq("label", weekLabel).maybeSingle(),
      supabase.from("class_members").select("student_id").eq("class_id", id).eq("student_id", studentId).maybeSingle(),
    ]);
    if (!classroom || !week || !member) return NextResponse.json({ error: "That student or week is not available in this class." }, { status: 404 });
    const { data, error } = await supabase.from("classroom_cw_records").insert({ class_id: id, week_id: week.id, student_id: studentId, status: "not_ok", record_date: recordDate, reason, created_by: teacher.id }).select("id, student_id, record_date, reason").single();
    if (error) throw error;
    const record: ClassroomCwRecord = { id: data.id, studentId: data.student_id, weekLabel, recordDate: data.record_date, reason: data.reason };
    return NextResponse.json({ record }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    console.error("[class-manager] CW record save failed", typeof cause === "object" && cause && "code" in cause ? String(cause.code) : "server_error");
    return NextResponse.json({ error: "Jaguar could not save that classwork record." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
