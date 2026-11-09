import { scanAccess, ScanError } from "@/lib/paper-scan-server";
import {
  buildPersonalizedPapersPdf,
  type PaperQuestion,
  type PaperKey,
} from "@/lib/paper-scan-papers";
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
    const url = new URL(request.url);
    const kind = url.searchParams.get("kind") ?? "packet";
    if (kind !== "questions" && kind !== "packet" && kind !== "key")
      throw new ScanError(
        "Choose question papers, complete packets, or teacher keys.",
      );
    const { data, error } = await db.rpc("prepare_owned_scan_sheets", {
      p_assignment_id: id,
    });
    if (error)
      throw new ScanError("Personalized papers could not be prepared.", 500);
    const sheets = (data as SheetRow[]).filter(
      (s) =>
        (!url.searchParams.get("classId") ||
          s.class_id === url.searchParams.get("classId")) &&
        (!url.searchParams.get("studentId") ||
          s.student_id === url.searchParams.get("studentId")),
    );
    if (!sheets.length)
      throw new ScanError("No assigned students match this selection.", 404);
    const ids = [
      ...new Set(sheets.flatMap((s) => s.questions.map((q) => q.questionId))),
    ];
    const questions = new Map<string, PaperQuestion>();
    const keys = new Map<string, PaperKey>();
    for (let start = 0; start < ids.length; start += 200) {
      const chunk = ids.slice(start, start + 200);
      const { data: rows, error: questionError } = await db
        .from("questions")
        .select("id,prompt,options")
        .in("id", chunk);
      if (questionError)
        throw new ScanError("Paper questions could not be loaded.", 500);
      for (const q of rows ?? []) questions.set(q.id, q as PaperQuestion);
      if (kind === "key") {
        const { data: answerKeys, error: keyError } = await db
          .from("question_keys")
          .select("question_id,correct_answer,explanation")
          .in("question_id", chunk);
        if (keyError || answerKeys?.length !== chunk.length)
          throw new ScanError("Teacher keys could not be loaded.", 500);
        for (const k of answerKeys) keys.set(k.question_id, k);
      }
    }
    const bytes = await buildPersonalizedPapersPdf(
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
      questions,
      kind,
      keys,
    );
    return new Response(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="jaguar-${kind === "key" ? "private-teacher-keys" : kind === "questions" ? "question-papers" : "student-packets"}.pdf"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (!(error instanceof ScanError) || error.status >= 500)
      console.error(
        "[personalized-papers]",
        error instanceof Error ? error.message : "PDF failed",
      );
    return Response.json(
      {
        error:
          error instanceof ScanError
            ? error.message
            : "Personalized papers are unavailable.",
      },
      {
        status: error instanceof ScanError ? error.status : 500,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  }
}
