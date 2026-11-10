import {
  scanAccess,
  scanMutation,
  scanWorkspace,
  ScanError,
  SCAN_BUCKET,
} from "@/lib/paper-scan-server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import { recognizeScan } from "@/lib/paper-scan-recognition";
export const runtime = "nodejs";
export const maxDuration = 60;
const headers = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};
function failure(error: unknown) {
  if (!(error instanceof ScanError))
    console.error("[paper-scan] request failed", error);
  return Response.json(
    {
      error:
        error instanceof ScanError
          ? error.message
          : "Scan workspace is unavailable. Please retry.",
    },
    { status: error instanceof ScanError ? error.status : 500, headers },
  );
}
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const url = new URL(request.url);
    const asset = url.searchParams.get("asset");
    if (url.searchParams.get("audit") === "1") {
      const { db } = await scanAccess(id);
      const events = [];
      for (let offset = 0; ; offset += 500) {
        const { data, error } = await db
          .from("paper_scan_audit")
          .select("*")
          .eq("assignment_id", id)
          .order("id")
          .range(offset, offset + 499);
        if (error)
          throw new ScanError("Audit history could not be exported.", 503);
        events.push(...data);
        if (data.length < 500) break;
      }
      return new Response(JSON.stringify(events, null, 2), {
        headers: {
          ...headers,
          "Content-Type": "application/json",
          "Content-Disposition": 'attachment; filename="mixed-test-audit.json"',
        },
      });
    }
    if (!asset) return Response.json(await scanWorkspace(id), { headers });
    const { db } = await scanAccess(id);
    const variant = url.searchParams.get("variant");
    if (variant === "review-preview") {
      const { data: page } = await db
        .from("paper_scan_pages")
        .select("image_path,normalized_path,sheet_id,problem")
        .eq("id", asset)
        .eq("assignment_id", id)
        .maybeSingle();
      if (!page) throw new ScanError("Scan not found.", 404);
      const bucket = createAdminClient().storage.from(SCAN_BUCKET);
      const { data: source, error } = await bucket.download(
        page.normalized_path ?? page.image_path,
      );
      if (error || !source)
        throw new ScanError("Scan preview could not be loaded.", 503);
      let bytes: Buffer = Buffer.from(await source.arrayBuffer());
      let quality = page.problem ? "approximate" : "aligned";
      if (!page.normalized_path) {
        const { data: sheet } = page.sheet_id
          ? await db
              .from("paper_scan_sheets")
              .select("token")
              .eq("id", page.sheet_id)
              .eq("assignment_id", id)
              .maybeSingle()
          : { data: null };
        if (!sheet)
          throw new ScanError(
            "Use the original scan to review this page.",
            422,
          );
        const review = await recognizeScan(bytes, [], sheet.token);
        const preview = review.normalized ?? review.reviewPreview;
        if (!preview)
          throw new ScanError(
            "Individual crops cannot be positioned reliably. Use the original scan.",
            422,
          );
        bytes = preview;
        quality = page.problem || review.problem ? "approximate" : "aligned";
      }
      // Read-only visual evidence: no recognition decisions, grades or database writes.
      return new Response(new Uint8Array(bytes), {
        headers: {
          ...headers,
          "Content-Type": "image/png",
          "X-Scan-Preview": quality,
        },
      });
    }
    let path: string | null = null;
    if (variant === "source") {
      const { data } = await db
        .from("paper_scan_batches")
        .select("source_path")
        .eq("id", asset)
        .eq("assignment_id", id)
        .maybeSingle();
      path = data?.source_path ?? null;
    } else {
      const { data } = await db
        .from("paper_scan_pages")
        .select("image_path,normalized_path")
        .eq("id", asset)
        .eq("assignment_id", id)
        .maybeSingle();
      path =
        variant === "aligned"
          ? (data?.normalized_path ?? data?.image_path ?? null)
          : (data?.image_path ?? null);
    }
    if (!path) throw new ScanError("Scan not found.", 404);
    const { data, error } = await createAdminClient()
      .storage.from(SCAN_BUCKET)
      .createSignedUrl(path, 60);
    if (error || !data) throw new ScanError("Scan could not be opened.", 503);
    return new Response(null, {
      status: 302,
      headers: {
        ...headers,
        Location: data.signedUrl,
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (error) {
    return failure(error);
  }
}
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    if (request.headers.get("origin") !== new URL(request.url).origin)
      throw new ScanError("Refresh this page before changing scans.", 403);
    if (Number(request.headers.get("content-length") ?? 0) > 128_000)
      throw new ScanError("Scan request is too large.", 413);
    const raw = await request.text();
    if (raw.length > 128_000)
      throw new ScanError("Scan request is too large.", 413);
    const { id } = await params;
    const body = JSON.parse(raw);
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new ScanError("Invalid scan request.");
    const result = await scanMutation(id, body);
    if (["process", "review", "reprocess"].includes(body.action)) {
      revalidatePath(`/teacher/assignments/${id}`);
      revalidatePath("/teacher/classes", "layout");
      revalidatePath("/student", "layout");
    }
    return Response.json(result, { headers });
  } catch (error) {
    return failure(error);
  }
}
