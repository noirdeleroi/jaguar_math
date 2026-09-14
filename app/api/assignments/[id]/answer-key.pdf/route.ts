import { getCurrentProfile } from "@/lib/auth";
import { assignmentPdfFilename, buildAssignmentAnswerKeyPdf, type AssignmentPdfMaterial, type AssignmentPdfOption } from "@/lib/assignment-pdf";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
type PdfRow = {
  position?: unknown;
  variant_index?: unknown;
  prompt?: unknown;
  type?: unknown;
  options?: unknown;
  points?: unknown;
  correct_answer?: unknown;
  numeric_tolerance?: unknown;
  explanation?: unknown;
};
type PdfPayload = { title?: unknown; description?: unknown; kind?: unknown; due_at?: unknown; questions?: unknown };

function options(value: unknown): AssignmentPdfOption[] | null {
  if (value === null) return null;
  if (!Array.isArray(value)) throw new Error("Invalid PDF options");
  const parsed = value.flatMap((option) => {
    if (!option || typeof option !== "object") return [];
    const row = option as { id?: unknown; text?: unknown };
    return typeof row.id === "string" && typeof row.text === "string" ? [{ id: row.id, text: row.text }] : [];
  });
  if (parsed.length !== value.length) throw new Error("Invalid PDF options");
  return parsed;
}

function material(value: unknown): AssignmentPdfMaterial {
  if (!value || typeof value !== "object") throw new Error("Invalid PDF material");
  const payload = value as PdfPayload;
  if (typeof payload.title !== "string" || typeof payload.kind !== "string" || (payload.description !== null && typeof payload.description !== "string") || (payload.due_at !== null && typeof payload.due_at !== "string") || !Array.isArray(payload.questions)) throw new Error("Invalid PDF material");
  const questions = payload.questions.map((item) => {
    if (!item || typeof item !== "object") throw new Error("Invalid PDF question");
    const row = item as PdfRow;
    const position = Number(row.position); const variantIndex = Number(row.variant_index); const points = Number(row.points); const tolerance = Number(row.numeric_tolerance);
    if (!Number.isInteger(position) || position < 1 || !Number.isInteger(variantIndex) || variantIndex < 1 || typeof row.prompt !== "string" || typeof row.type !== "string" || !Number.isFinite(points) || points <= 0 || typeof row.correct_answer !== "string" || !Number.isFinite(tolerance) || tolerance < 0 || (row.explanation !== null && typeof row.explanation !== "string")) throw new Error("Invalid PDF question");
    return { position, variantIndex, prompt: row.prompt, type: row.type, options: options(row.options), points, correctAnswer: row.correct_answer, numericTolerance: tolerance, explanation: row.explanation as string | null };
  });
  return { title: payload.title, description: payload.description as string | null, kind: payload.kind, dueAt: payload.due_at as string | null, questions };
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile) return new Response("Sign in to download this PDF.", { status: 401 });
  const { id } = await context.params;
  if (!UUID.test(id)) return new Response("Not found", { status: 404 });

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_assignment_pdf_material", { p_assignment_id: id });
  if (error || !data) {
    if (error) console.error(`[assignment-pdf] material unavailable: code=${error.code}; message=${error.message}`);
    return new Response("This PDF is not available.", { status: 404, headers: { "Cache-Control": "private, no-store" } });
  }

  try {
    const pdfMaterial = material(data);
    const bytes = await buildAssignmentAnswerKeyPdf(pdfMaterial);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${assignmentPdfFilename(pdfMaterial.title)}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (cause) {
    console.error("[assignment-pdf] generation failed", cause instanceof Error ? cause.message : "unknown error");
    return new Response("The PDF could not be created.", { status: 500, headers: { "Cache-Control": "private, no-store" } });
  }
}
