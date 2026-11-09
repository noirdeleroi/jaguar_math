import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  identifyScan,
  recognizeScan,
  SCAN_ALGORITHM,
} from "@/lib/paper-scan-recognition";
import { renderScanPage } from "@/lib/paper-scan-render";
import { pageQuestions, QUESTIONS_PER_PAGE } from "@/lib/paper-scan-layout";
import type { SheetRow, ScanWorkspace } from "@/lib/paper-scan-types";
import { ScanSourceCache } from "@/lib/paper-scan-source-cache";
const sourceCache = new ScanSourceCache();

export const SCAN_BUCKET = "paper-scans";
export class ScanError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}
export async function scanAccess(id: string) {
  const teacher = await getCurrentProfile();
  if (!teacher) throw new ScanError("Sign in to mark papers.", 401);
  if (teacher.role !== "teacher")
    throw new ScanError("Teacher access required.", 403);
  if (!/^[a-f0-9-]{36}$/i.test(id))
    throw new ScanError("Assessment not found.", 404);
  const db = await createClient();
  const { data: assignment, error } = await db
    .from("assignments")
    .select("id,title,status,paper_scan_enabled,archived_at")
    .eq("id", id)
    .eq("created_by", teacher.id)
    .maybeSingle();
  if (error) throw new ScanError("Assessment could not be loaded.", 503);
  if (!assignment?.paper_scan_enabled || assignment.status === "draft")
    throw new ScanError("Publish a Mixed Test before opening marking.", 404);
  return { teacher, db, assignment };
}
function check(error: { message: string } | null, message: string) {
  if (error) {
    console.error(`[paper-scan] ${message}: ${error.message}`);
    throw new ScanError(message, 500);
  }
}
async function rows<T>(
  query: (
    start: number,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<T[]> {
  const all: T[] = [];
  for (let start = 0; ; start += 500) {
    const { data, error } = await query(start);
    check(error, "Scan records could not be loaded.");
    const page = data as T[];
    all.push(...page);
    if (page.length < 500) return all;
  }
}
export async function scanWorkspace(id: string): Promise<ScanWorkspace> {
  const { db } = await scanAccess(id);
  const { error: prepareError } = await db.rpc("prepare_owned_scan_sheets", {
    p_assignment_id: id,
  });
  check(prepareError, "Personalized sheets could not be prepared.");
  const [sheets, batches, pages, grades, audit] = await Promise.all([
    rows<SheetRow>((n) =>
      db
        .from("paper_scan_sheets")
        .select("*")
        .eq("assignment_id", id)
        .order("id")
        .range(n, n + 499),
    ),
    rows<ScanWorkspace["batches"][number]>((n) =>
      db
        .from("paper_scan_batches")
        .select(
          "id,file_name,status,page_count,next_page,error,duplicate_uploads,lease_until",
        )
        .eq("assignment_id", id)
        .order("created_at", { ascending: false })
        .range(n, n + 499),
    ),
    rows<ScanWorkspace["pages"][number]>((n) =>
      db
        .from("paper_scan_pages")
        .select(
          "id,batch_id,source_page,sheet_id,sheet_page,status,readings,decisions,problem,normalized_path,revision,algorithm",
        )
        .eq("assignment_id", id)
        .order("created_at", { ascending: false })
        .range(n, n + 499),
    ),
    rows<ScanWorkspace["grades"][number]>((n) =>
      db
        .from("attempts")
        .select("id,score,max_score,status")
        .eq("assignment_id", id)
        .order("id")
        .range(n, n + 499),
    ),
    db
      .from("paper_scan_audit")
      .select("id,page_id,sheet_id,event,created_at,detail")
      .eq("assignment_id", id)
      .order("id", { ascending: false })
      .limit(100),
  ]);
  check(audit.error, "Audit history could not be loaded.");
  const questionIds = [
    ...new Set(sheets.flatMap((s) => s.questions.map((q) => q.questionId))),
  ];
  const keys: Record<string, string> = {};
  for (let start = 0; start < questionIds.length; start += 200) {
    const { data, error } = await db
      .from("question_keys")
      .select("question_id,correct_answer")
      .in("question_id", questionIds.slice(start, start + 200));
    check(error, "Protected answer key could not be loaded.");
    for (const key of data ?? []) keys[key.question_id] = key.correct_answer;
  }
  return { sheets, batches, pages, grades, keys, audit: audit.data ?? [] };
}

export async function scanMutation(id: string, body: Record<string, unknown>) {
  const { teacher, assignment } = await scanAccess(id);
  if (assignment.archived_at)
    throw new ScanError("Restore the assessment before changing scans.");
  const admin = createAdminClient();
  const bucket = admin.storage.from(SCAN_BUCKET);
  if (body.action === "reprocess") {
    if (
      typeof body.pageId !== "string" ||
      !/^[a-f0-9-]{36}$/i.test(body.pageId) ||
      !Number.isInteger(body.revision) ||
      Number(body.revision) < 1
    )
      throw new ScanError("Refresh the scan before retrying.");
    const { data: page, error } = await admin
      .from("paper_scan_pages")
      .select("*")
      .eq("id", body.pageId)
      .eq("assignment_id", id)
      .maybeSingle();
    check(error, "Scan could not be loaded.");
    if (!page) throw new ScanError("Scan not found.", 404);
    if (
      page.revision !== body.revision ||
      !["unidentified", "review"].includes(page.status) ||
      page.decisions !== null
    )
      throw new ScanError(
        "This scan changed or already has a review. Refresh before retrying.",
        409,
      );
    const { data: manualReview, error: auditError } = await admin
      .from("paper_scan_audit")
      .select("id")
      .eq("page_id", page.id)
      .like("event", "manual_%")
      .limit(1)
      .maybeSingle();
    check(auditError, "Review history could not be checked.");
    if (manualReview)
      throw new ScanError(
        "Recognition cannot replace a teacher's manual review or grade hold.",
        409,
      );
    const { data: image, error: imageError } = await bucket.download(
      page.image_path,
    );
    check(imageError, "Original scan could not be loaded.");
    const bytes = Buffer.from(await image!.arrayBuffer());
    const identification = await identifyScan(bytes);
    const { data: sheet } = identification.identifier
      ? await admin
          .from("paper_scan_sheets")
          .select("*")
          .eq("assignment_id", id)
          .eq("token", identification.identifier.token)
          .maybeSingle()
      : { data: null };
    const sheetPage = identification.identifier?.page ?? null;
    const questions =
      sheet && sheetPage ? pageQuestions(sheet.questions, sheetPage) : [];
    const validSheet = Boolean(sheet && questions.length);
    const recognition = validSheet
      ? await recognizeScan(bytes, questions, sheet.token)
      : null;
    const normalizedPath = recognition?.normalized
      ? `${teacher.id}/${id}/${page.batch_id}/retry-${page.id}-${randomUUID()}.png`
      : null;
    if (normalizedPath) {
      const { error } = await bucket.upload(
        normalizedPath,
        recognition!.normalized!,
        { contentType: "image/png", upsert: false, cacheControl: "0" },
      );
      check(error, "Aligned scan could not be preserved.");
    }
    const { data: updated, error: retryError } = await admin.rpc(
      "reprocess_scan_page",
      {
        p_page_id: page.id,
        p_teacher_id: teacher.id,
        p_revision: body.revision,
        p_sheet: validSheet ? sheet.id : null,
        p_sheet_page: validSheet ? sheetPage : null,
        p_normalized_path: normalizedPath,
        p_readings: recognition?.readings ?? [],
        p_problem:
          recognition?.problem ??
          (validSheet
            ? null
            : identification.identifier
              ? "QR code belongs to another assessment or page."
              : "QR code is still unreadable. Check the original scan or identify the student manually."),
        p_algorithm: SCAN_ALGORITHM,
      },
    );
    if (retryError && normalizedPath) await bucket.remove([normalizedPath]);
    if (retryError)
      throw new ScanError(
        retryError.code === "P0001"
          ? retryError.message
          : "Recognition could not be retried. Refresh and try again.",
        409,
      );
    return { page: updated };
  }
  if (body.action === "register") {
    const name = String(body.name ?? "")
      .replace(/[\u0000-\u001f]/g, "")
      .slice(0, 180);
    const size = Number(body.size);
    const hash = String(body.hash ?? "");
    const mime = String(body.mime ?? "");
    if (
      !name ||
      !Number.isInteger(size) ||
      size < 1 ||
      size > 50 * 1024 * 1024 ||
      !/^[a-f0-9]{64}$/.test(hash) ||
      !["application/pdf", "image/png", "image/jpeg"].includes(mime)
    )
      throw new ScanError("Choose a PDF, PNG or JPEG no larger than 50 MB.");
    const batchId = randomUUID();
    const sourcePath = `${teacher.id}/${id}/${batchId}/source`;
    const { error: insertError } = await admin
      .from("paper_scan_batches")
      .insert({
        id: batchId,
        assignment_id: id,
        teacher_id: teacher.id,
        file_name: name,
        file_hash: hash,
        file_size: size,
        mime,
        source_path: sourcePath,
      });
    if (insertError && insertError.code !== "23505")
      check(insertError, "Upload could not be registered.");
    const { data: batch, error } = await admin
      .from("paper_scan_batches")
      .select("*")
      .eq("assignment_id", id)
      .eq("file_hash", hash)
      .single();
    check(error, "Upload could not be opened.");
    if (insertError)
      await admin
        .from("paper_scan_batches")
        .update({ duplicate_uploads: batch.duplicate_uploads + 1 })
        .eq("id", batch.id);
    if (batch.status !== "uploading")
      return { batchId: batch.id, duplicate: true };
    if (insertError) {
      const { data: existing } = await bucket.info(batch.source_path);
      if (existing && Number(existing.size) === Number(batch.file_size)) {
        const { error } = await admin
          .from("paper_scan_batches")
          .update({ status: "ready" })
          .eq("id", batch.id)
          .eq("status", "uploading");
        check(error, "The interrupted upload could not be resumed.");
        return { batchId: batch.id, duplicate: true };
      }
    }
    const { data: signed, error: signedError } =
      await bucket.createSignedUploadUrl(batch.source_path);
    check(signedError, "A private upload link could not be created.");
    return {
      batchId: batch.id,
      uploadUrl: signed!.signedUrl,
      duplicate: Boolean(insertError),
    };
  }
  if (body.action === "review") {
    if (
      !Number.isInteger(body.revision) ||
      Number(body.revision) < 1 ||
      typeof body.pageId !== "string" ||
      !/^[a-f0-9-]{36}$/i.test(body.pageId) ||
      !["accept", "reject", "reopen", "identify"].includes(
        String(body.reviewAction),
      ) ||
      !Array.isArray(body.decisions) ||
      body.decisions.length > 60 ||
      typeof body.note !== "string" ||
      body.note.length > 1000
    )
      throw new ScanError("Review at most 60 answers and add a reason.");
    const { data: page } = await admin
      .from("paper_scan_pages")
      .select("assignment_id")
      .eq("id", body.pageId)
      .maybeSingle();
    if (page?.assignment_id !== id) throw new ScanError("Scan not found.", 404);
    const { data, error } = await admin.rpc("review_scan_page", {
      p_page_id: body.pageId,
      p_teacher_id: teacher.id,
      p_revision: body.revision,
      p_action: body.reviewAction,
      p_decisions: body.decisions,
      p_note: body.note,
      p_sheet: body.sheetId ?? null,
      p_sheet_page: body.sheetPage ?? null,
    });
    if (error)
      throw new ScanError(
        error.code === "P0001"
          ? error.message
          : "This review could not be saved. Refresh and retry.",
        409,
      );
    return { page: data };
  }
  const { data: batch, error: batchError } = await admin
    .from("paper_scan_batches")
    .select("*")
    .eq("id", body.batchId)
    .eq("assignment_id", id)
    .eq("teacher_id", teacher.id)
    .maybeSingle();
  check(batchError, "Batch could not be loaded.");
  if (!batch) throw new ScanError("Batch not found.", 404);
  if (body.action === "uploaded") {
    if (batch.status !== "uploading") return { batchId: batch.id };
    const { data, error } = await bucket.info(batch.source_path);
    if (error || !data || Number(data.size) !== Number(batch.file_size))
      throw new ScanError(
        "Upload is incomplete. Choose the original file again to retry.",
      );
    const { error: updateError } = await admin
      .from("paper_scan_batches")
      .update({ status: "ready" })
      .eq("id", batch.id)
      .eq("status", "uploading");
    check(updateError, "Upload could not be queued.");
    return { batchId: batch.id };
  }
  if (body.action !== "process") throw new ScanError("Unknown scan action.");
  if (batch.status === "complete") return { done: true };
  const { data: claimed, error: claimError } = await admin.rpc(
    "claim_scan_batch",
    { p_batch_id: batch.id, p_teacher_id: teacher.id },
  );
  if (claimError)
    throw new ScanError(
      claimError.code === "P0001"
        ? claimError.message
        : "Batch could not be resumed.",
      409,
    );
  if (claimed.status === "complete") return { done: true };
  try {
    const cacheKey = `${teacher.id}/${id}/${batch.id}/${batch.file_hash}`;
    let bytes = sourceCache.get(cacheKey);
    if (!bytes) {
      const { data: original, error: downloadError } = await bucket.download(
        batch.source_path,
      );
      check(
        downloadError,
        "Original file is unavailable. Re-upload the original file.",
      );
      bytes = Buffer.from(await original!.arrayBuffer());
    }
    if (
      bytes.length !== Number(batch.file_size) ||
      createHash("sha256").update(bytes).digest("hex") !== batch.file_hash
    )
      throw new ScanError(
        "Original file integrity check failed. Upload the correct file.",
      );
    sourceCache.put(cacheKey, bytes);
    if (
      batch.mime === "application/pdf" &&
      !bytes.subarray(0, 1024).includes(Buffer.from("%PDF-"))
    )
      throw new ScanError("The uploaded file is not a PDF.");
    const rendered = await renderScanPage(bytes, claimed.next_page, batch.mime);
    const identification = await identifyScan(rendered.bytes);
    const { data: sheet } = identification.identifier
      ? await admin
          .from("paper_scan_sheets")
          .select("*")
          .eq("assignment_id", id)
          .eq("token", identification.identifier.token)
          .maybeSingle()
      : { data: null };
    const sheetPage = identification.identifier?.page ?? null;
    const questions =
      sheet && sheetPage ? pageQuestions(sheet.questions, sheetPage) : [];
    const validSheet =
      sheet &&
      questions.length &&
      sheetPage! <= Math.ceil(sheet.questions.length / QUESTIONS_PER_PAGE);
    const recognition = validSheet
      ? await recognizeScan(rendered.bytes, questions, sheet.token)
      : null;
    const root = `${teacher.id}/${id}/${batch.id}/page-${claimed.next_page}`;
    // Paths include the lease: a timed-out worker cannot overwrite a newer retry.
    const imagePath = `${root}-${claimed.lease}.png`;
    const normalizedPath = recognition?.normalized
      ? `${root}-${claimed.lease}-aligned.png`
      : null;
    async function preserve(path: string, image: Buffer) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const { error } = await bucket.upload(path, image, {
          contentType: "image/png",
          cacheControl: "0",
          upsert: false,
        });
        if (!error) return;
        // A lost acknowledgement can follow a successful write. Confirm that
        // immutable lease-specific object rather than overwriting the evidence.
        const { data: existing } = await bucket.info(path);
        if (existing && Number(existing.size) === image.length) return;
        if (attempt === 2)
          check(
            error,
            "Scan preview could not be preserved. Resume this batch to retry.",
          );
        await new Promise((resolve) =>
          setTimeout(resolve, 250 * (attempt + 1)),
        );
      }
    }
    await preserve(imagePath, rendered.bytes);
    if (normalizedPath)
      await preserve(normalizedPath, recognition!.normalized!);
    const { data: page, error: recordError } = await admin.rpc(
      "record_scan_page",
      {
        p_batch_id: batch.id,
        p_lease: claimed.lease,
        p_page_count: rendered.pageCount,
        p_sheet: validSheet ? sheet.id : null,
        p_sheet_page: validSheet ? sheetPage : null,
        p_image_path: imagePath,
        p_normalized_path: normalizedPath,
        p_readings: recognition?.readings ?? [],
        p_problem:
          recognition?.problem ??
          (validSheet
            ? null
            : identification.identifier
              ? "QR code does not match this assessment or page. Check the printed identity before assigning manually."
              : "QR code unreadable. Identify the student and page manually, or rescan."),
        p_algorithm: SCAN_ALGORITHM,
      },
    );
    check(recordError, "Recognition could not be saved. Retry this page.");
    return {
      done: claimed.next_page >= rendered.pageCount,
      page,
      processed: claimed.next_page,
      total: rendered.pageCount,
    };
  } catch (cause) {
    const message =
      cause instanceof ScanError
        ? cause.message
        : "This document could not be processed. Check that it is an unencrypted PDF or a valid PNG/JPEG, then retry.";
    console.error(
      "[paper-scan] processing failed",
      cause instanceof Error ? cause.message : "unknown",
    );
    await admin
      .from("paper_scan_batches")
      .update({
        status: "failed",
        error: message,
        lease: null,
        lease_until: null,
      })
      .eq("id", batch.id)
      .eq("lease", claimed.lease);
    throw new ScanError(message, 422);
  }
}
