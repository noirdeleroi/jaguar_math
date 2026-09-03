import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const uuid = (value: unknown) => typeof value === "string" && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);
const eventTypes = new Set(["page_hidden", "page_visible", "window_blur", "window_focus", "fullscreen_exited", "fullscreen_restored", "fullscreen_unavailable"]);

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { attemptId?: unknown; eventId?: unknown; eventType?: unknown; awayDurationSeconds?: unknown } | null;
  if (!body || !uuid(body.attemptId) || !uuid(body.eventId) || typeof body.eventType !== "string" || !eventTypes.has(body.eventType) || (body.awayDurationSeconds !== undefined && (!Number.isInteger(body.awayDurationSeconds) || Number(body.awayDurationSeconds) < 0 || Number(body.awayDurationSeconds) > 86400))) return NextResponse.json({ error: "Exam activity is invalid." }, { status: 400 });
  const supabase = await createClient(); const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in again to continue." }, { status: 401 });
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "student") return NextResponse.json({ error: "Exam activity is not available for this account." }, { status: 403 });
  const { data, error } = await supabase.rpc("record_exam_activity", { p_attempt_id: body.attemptId, p_client_event_id: body.eventId, p_event_type: body.eventType, p_away_duration_seconds: body.awayDurationSeconds ?? null });
  if (error) { console.error(`exam_mode_event failed: code=${error.code}; message=${error.message}; details=${error.details ?? "none"}; hint=${error.hint ?? "none"}`); return NextResponse.json({ error: "Exam activity could not be recorded. Your saved answers are unaffected." }, { status: 400 }); }
  const row = Array.isArray(data) ? data[0] : data;
  return NextResponse.json({ focusViolations: Number(row?.focus_violations ?? 0), autoSubmitted: Boolean(row?.auto_submitted) });
}
