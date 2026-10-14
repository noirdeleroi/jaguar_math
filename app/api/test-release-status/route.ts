import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("assignmentId");
  if (!id || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)) return NextResponse.json({ error: "Invalid test." }, { status: 400 });
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error) return NextResponse.json({ error: "Session verification is temporarily unavailable." }, { status: error.name === "AuthSessionMissingError" ? 401 : 503 });
  if (!data?.claims.sub) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  // RLS restricts this lookup to assignments belonging to the signed-in student.
  const result = await supabase.from("assignments").select("status, teacher_controlled_question_release, questions_released_at").eq("id", id).eq("kind", "test").maybeSingle();
  if (result.error) return NextResponse.json({ error: "The test status could not be checked." }, { status: 503 });
  if (!result.data) return NextResponse.json({ error: "Test unavailable." }, { status: 404 });
  return NextResponse.json({ status: result.data.status, released: !result.data.teacher_controlled_question_release || Boolean(result.data.questions_released_at) }, { headers: { "Cache-Control": "private, no-store" } });
}
