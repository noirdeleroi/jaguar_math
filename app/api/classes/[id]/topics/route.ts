import { NextResponse } from "next/server";
import { requireTeacher } from "@/lib/auth";
import type { ClassroomWeek } from "@/lib/classroom-stars";
import { createClient } from "@/lib/supabase/server";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const teacher = await requireTeacher();
    const { id } = await context.params;
    const body = await request.json() as { title?: unknown; classIds?: unknown; gradingMode?: unknown; classworkDefaultGrade?: unknown; makeCurrent?: unknown };
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const classIds = Array.isArray(body.classIds) ? [...new Set(body.classIds.filter((value): value is string => typeof value === "string" && uuidPattern.test(value)))] : [];
    const gradingMode = body.gradingMode === "classwork" ? "classwork" : body.gradingMode === "stars" ? "stars" : null;
    const classworkDefaultGrade = Number(body.classworkDefaultGrade);
    if (!title || title.length > 120) return NextResponse.json({ error: "Enter a topic name under 120 characters." }, { status: 400 });
    if (!classIds.includes(id)) return NextResponse.json({ error: "The open class must be selected." }, { status: 400 });
    if (!gradingMode) return NextResponse.json({ error: "Choose Stars & Skulls or Classwork grade." }, { status: 400 });
    if (!Number.isFinite(classworkDefaultGrade) || classworkDefaultGrade < 0 || classworkDefaultGrade > 100) return NextResponse.json({ error: "Enter a default classwork grade from 0% to 100%." }, { status: 400 });

    const supabase = await createClient();
    const { data: ownedClasses, error: classesError } = await supabase.from("classes").select("id").eq("teacher_id", teacher.id).in("id", classIds);
    if (classesError) throw classesError;
    if ((ownedClasses ?? []).length !== classIds.length) return NextResponse.json({ error: "One or more selected classes are not available." }, { status: 403 });

    const { data, error } = await supabase.rpc("create_classroom_topics", {
      p_class_ids: classIds,
      p_title: title,
      p_grading_mode: gradingMode,
      p_classwork_default_grade: classworkDefaultGrade,
      p_make_current: body.makeCurrent === true,
    });
    if (error) throw error;
    const topics = ((data as { topics?: Array<ClassroomWeek & { classId: string }> } | null)?.topics ?? []).map((topic) => ({ ...topic, classworkNotes: topic.classworkNotes ?? {} }));
    const topic = topics.find((item) => item.classId === id);
    if (!topic) throw new Error("The topic was not returned for the open class.");
    return NextResponse.json({ topic, classCount: topics.length }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    console.error("[class-gradebook] topic creation failed", typeof cause === "object" && cause && "code" in cause ? String(cause.code) : "server_error");
    return NextResponse.json({ error: "Jaguar could not create that topic." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
