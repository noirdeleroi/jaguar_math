import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const assignmentId = new URL(request.url).searchParams.get("assignmentId");
  if (!assignmentId || !UUID.test(assignmentId)) return NextResponse.json({ error: "The paper test is invalid." }, { status: 400 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in again to continue." }, { status: 401 });
  const { data, error } = await supabase.rpc("get_my_paper_session_state", { p_assignment_id: assignmentId });
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row) return NextResponse.json({ error: "The paper session is not available." }, { status: 404 });
  const { data: assignment } = await supabase.from("assignments").select("status").eq("id", assignmentId).maybeSingle();
  return NextResponse.json({
    serverNow: row.server_now,
    writingStartedAt: row.writing_started_at,
    writingEndsAt: row.writing_ends_at,
    answersReleasedAt: row.answers_released_at,
    answerEndsAt: row.answer_ends_at,
    answerDurationSeconds: Number(row.answer_duration_seconds ?? 90),
    attemptId: row.attempt_id,
    attemptStatus: row.attempt_status,
    formCode: row.form_code,
    focusViolations: Number(row.focus_violations ?? 0),
    assignmentStatus: assignment?.status ?? "closed",
  });
}
