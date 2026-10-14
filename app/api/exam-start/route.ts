import { NextResponse } from "next/server";
import { startOrContinueExamAssignment } from "@/app/student/actions";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (typeof body?.assignmentId !== "string" || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(body.assignmentId)) return NextResponse.json({ error: "Invalid test." }, { status: 400 });
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getClaims();
    if (error?.name === "AuthSessionMissingError" || (!error && !data?.claims.sub)) return NextResponse.json({ error: "Sign in again to start the test." }, { status: 401 });
    if (error) return NextResponse.json({ error: "Your session could not be verified. Please retry." }, { status: 503 });
    // The existing launch function verifies the student and uses only their
    // RLS-scoped client. A stable API URL also survives an open tab's deployment.
    const result = await startOrContinueExamAssignment(body.assignmentId);
    return NextResponse.json(result, { status: "error" in result ? 503 : 200, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error(`[exam-launch] request failed; type=${error instanceof Error ? error.name : "unknown"}`);
    return NextResponse.json({ error: "The test could not load. Retry to continue the same attempt." }, { status: 503 });
  }
}
