import { feedbackSummary, previewFeedback, sendStudentFeedback } from "@/lib/mixed-feedback-server";
import { ScanError } from "@/lib/paper-scan-server";

export const runtime = "nodejs";
export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const uuid = /^[a-f0-9-]{36}$/i;
function failure(error: unknown) {
  if (!(error instanceof ScanError)) console.error("[mixed-feedback] request failed", error);
  return Response.json({ error: error instanceof ScanError ? error.message : "Feedback is unavailable. Please retry." },
    { status: error instanceof ScanError ? error.status : 500, headers });
}
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params, sheetId = new URL(request.url).searchParams.get("preview");
    if (sheetId) {
      if (!uuid.test(sheetId)) throw new ScanError("Student paper not found.", 404);
      return new Response(Buffer.from(await previewFeedback(id, sheetId)), { headers: { ...headers,
        "Content-Type": "application/pdf", "Content-Disposition": 'inline; filename="student-feedback-preview.pdf"' } });
    }
    return Response.json(await feedbackSummary(id), { headers });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (request.headers.get("origin") !== new URL(request.url).origin) throw new ScanError("Refresh this page before sending feedback.", 403);
    if (Number(request.headers.get("content-length") ?? 0) > 2000) throw new ScanError("Invalid feedback request.", 413);
    const raw = await request.text();
    if (raw.length > 2000) throw new ScanError("Invalid feedback request.", 413);
    let body;
    try { body = JSON.parse(raw); } catch { throw new ScanError("Invalid feedback request."); }
    if (!body || typeof body.sheetId !== "string" || !uuid.test(body.sheetId)) throw new ScanError("Choose a student paper.");
    const { id } = await params;
    return Response.json(await sendStudentFeedback(id, body.sheetId), { headers });
  } catch (error) { return failure(error); }
}
