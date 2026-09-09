import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
type ResponseInput = { questionId?: unknown; answer?: unknown; revision?: unknown };

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { attemptId?: unknown; responses?: unknown } | null;
  if (!body || typeof body.attemptId !== "string" || !UUID.test(body.attemptId) || !Array.isArray(body.responses) || body.responses.length < 1 || body.responses.length > 200) {
    return NextResponse.json({ error: "The response batch is invalid." }, { status: 400 });
  }
  const responses = body.responses as ResponseInput[];
  if (responses.some((item) => typeof item.questionId !== "string" || !UUID.test(item.questionId) || typeof item.answer !== "string" || item.answer.length > 20_000 || !Number.isSafeInteger(item.revision) || Number(item.revision) < 0)) {
    return NextResponse.json({ error: "One or more answers are invalid." }, { status: 400 });
  }
  if (new Set(responses.map((item) => item.questionId)).size !== responses.length) {
    return NextResponse.json({ error: "Each question can appear only once per save." }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in again to save your answers." }, { status: 401 });
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "student") return NextResponse.json({ error: "Answers are not available for this account." }, { status: 403 });

  const payload = responses.map((item) => ({ question_id: item.questionId, student_answer: item.answer, client_revision: item.revision }));
  const { data, error } = await supabase.rpc("save_response_batch", { p_attempt_id: body.attemptId, p_responses: payload });
  if (error) {
    const closed = error.message.includes("closed") || error.message.includes("window") || error.message.includes("available");
    return NextResponse.json({ error: closed ? "The response window has closed." : "Answers could not be synchronized. They remain saved on this device." }, { status: closed ? 409 : 400 });
  }
  return NextResponse.json({ saved: Number(data ?? responses.length) });
}
