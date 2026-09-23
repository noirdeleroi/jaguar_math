import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const attemptId = new URL(request.url).searchParams.get("attemptId");
  if (!attemptId || !UUID.test(attemptId)) return NextResponse.json({ error: "The attempt is invalid." }, { status: 400 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in again to continue." }, { status: 401 });
  const { data: attempt } = await supabase.from("attempts").select("assignment_id, status, expires_at").eq("id", attemptId).eq("student_id", user.id).maybeSingle();
  if (!attempt) return NextResponse.json({ error: "The attempt is not available." }, { status: 404 });
  const { data: assignment } = await supabase.from("assignments").select("status, exam_mode, exam_require_fullscreen, exam_track_focus_exits, exam_allowed_focus_exits, exam_violation_action").eq("id", attempt.assignment_id).maybeSingle();
  if (!assignment) return NextResponse.json({ error: "The assignment is not available." }, { status: 404 });
  return NextResponse.json({
    serverNow: new Date().toISOString(),
    status: attempt.status,
    expiresAt: attempt.expires_at,
    assignmentStatus: assignment.status,
    examMode: assignment.exam_mode ? {
      requireFullscreen: assignment.exam_require_fullscreen,
      trackFocusExits: assignment.exam_track_focus_exits,
      allowedFocusExits: assignment.exam_allowed_focus_exits,
      violationAction: assignment.exam_violation_action,
    } : null,
  });
}
