import { scanAccess, ScanError } from "@/lib/paper-scan-server";
import { buildScanSheetsPdf } from "@/lib/paper-scan-pdf";
import type { SheetRow } from "@/lib/paper-scan-types";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { db, assignment } = await scanAccess(id);
    const { data, error } = await db.rpc("prepare_owned_scan_sheets", {
      p_assignment_id: id,
    });
    if (error) throw new ScanError("Answer sheets could not be prepared.", 500);
    const url = new URL(request.url);
    const classId = url.searchParams.get("classId");
    const studentId = url.searchParams.get("studentId");
    const sheets = (data as SheetRow[]).filter(
      (s) =>
        (!classId || s.class_id === classId) &&
        (!studentId || s.student_id === studentId),
    );
    if (!sheets.length)
      throw new ScanError("No assigned students match this selection.", 404);
    const bytes = await buildScanSheetsPdf(
      assignment.title,
      sheets.map((s) => ({
        id: s.id,
        token: s.token,
        studentId: s.student_id,
        studentName: s.student_name,
        studentCode: s.student_code,
        classId: s.class_id,
        className: s.class_name,
        version: s.version,
        questions: s.questions,
      })),
    );
    return new Response(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition":
          'attachment; filename="jaguar-answer-sheets.pdf"',
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof ScanError
            ? error.message
            : "Answer sheets are unavailable.",
      },
      {
        status: error instanceof ScanError ? error.status : 500,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  }
}
