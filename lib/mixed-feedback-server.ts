import "server-only";
import sharp from "sharp";
import { createAdminClient } from "@/lib/supabase/admin";
import { scanAccess, ScanError, SCAN_BUCKET } from "@/lib/paper-scan-server";
import { getGoogleAccessToken, hasGoogleGmailSendPermission } from "@/lib/google-classroom";
import type { SheetRow } from "@/lib/paper-scan-types";
import { feedbackRows, finalFeedbackGrade, validFeedbackEmail, type FeedbackGrade, type FeedbackPage, type FeedbackSummary } from "./mixed-feedback.ts";
import { buildFeedbackPdf } from "./mixed-feedback-pdf.ts";
import { deliverFeedback } from "./mixed-feedback-delivery.ts";
import { sendFeedbackEmail } from "./mixed-feedback-email.ts";
import type { PaperQuestion, PaperKey } from "./paper-scan-papers.ts";

type Admin = ReturnType<typeof createAdminClient>;
type Delivery = { sheet_id: string; status: string; updated_at: string; claim_token: string; recipient: string };
function check<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new ScanError("Feedback records could not be loaded. Please retry.", 503);
  return result.data;
}
async function all<T>(query: (start: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const data: T[] = [];
  for (let n = 0; ; n += 500) { const page = check(await query(n)) as T[]; data.push(...page); if (page.length < 500) return data; }
}
export async function feedbackAccess(id: string) {
  const access = await scanAccess(id);
  if (access.assignment.archived_at) throw new ScanError("Restore the assessment before emailing feedback.", 409);
  return access;
}

export async function feedbackSummary(id: string): Promise<FeedbackSummary> {
  const { teacher } = await feedbackAccess(id), db = createAdminClient();
  const [sheets, pages, grades, deliveries, gmailConnected] = await Promise.all([
    all<SheetRow>(n => db.from("paper_scan_sheets").select("*").eq("assignment_id", id).order("student_name").order("id").range(n, n + 499)),
    all<FeedbackPage & { sheet_id: string }>(n => db.from("paper_scan_pages").select("id,sheet_id,sheet_page,status,image_path").eq("assignment_id", id).order("id").range(n, n + 499)),
    all<FeedbackGrade>(n => db.from("attempts").select("id,status,score,max_score").eq("assignment_id", id).order("id").range(n, n + 499)),
    all<Delivery>(n => db.from("paper_feedback_deliveries").select("*").eq("assignment_id", id).order("sheet_id").range(n, n + 499)),
    hasGoogleGmailSendPermission(teacher.id),
  ]);
  const emails = new Map<string, string>();
  for (let i = 0; i < sheets.length; i += 150) {
    const profiles = check(await db.from("profiles").select("id,email").in("id", sheets.slice(i, i + 150).map(s => s.student_id)));
    for (const p of profiles ?? []) emails.set(p.id, p.email);
  }
  const summary: FeedbackSummary = { graded: 0, ready: [], sent: 0, excluded: 0, failed: 0, processing: 0, uncertain: 0, gmailConnected, previewSheetId: null };
  const gradeById = new Map(grades.map(g => [g.id, g])), deliveryById = new Map(deliveries.map(d => [d.sheet_id, d]));
  for (const sheet of sheets) {
    if (!finalFeedbackGrade(sheet.questions, pages.filter(p => p.sheet_id === sheet.id), gradeById.get(sheet.attempt_id ?? ""))) continue;
    summary.graded++;
    if (!validFeedbackEmail(emails.get(sheet.student_id))) { summary.excluded++; continue; }
    summary.previewSheetId ??= sheet.id;
    const delivery = deliveryById.get(sheet.id);
    if (delivery?.status === "sent") summary.sent++;
    else if (delivery?.status === "uncertain" || (delivery?.status === "sending" && Date.now() - Date.parse(delivery.updated_at) >= 300_000)) summary.uncertain++;
    else if (delivery?.status === "sending" || (delivery?.status === "preparing" && Date.now() - Date.parse(delivery.updated_at) < 300_000)) summary.processing++;
    else { summary.ready.push(sheet.id); if (delivery?.status === "failed") summary.failed++; }
  }
  return summary;
}

async function loadPacket(db: Admin, assignmentId: string, sheetId: string, title: string) {
  const sheet = check(await db.from("paper_scan_sheets").select("*").eq("assignment_id", assignmentId).eq("id", sheetId).maybeSingle()) as SheetRow | null;
  if (!sheet?.attempt_id) throw new ScanError("Only fully marked student papers can receive feedback.", 409);
  const [grade, pages, profile, responses] = await Promise.all([
    db.from("attempts").select("id,status,score,max_score").eq("id", sheet.attempt_id).eq("assignment_id", assignmentId).eq("student_id", sheet.student_id).maybeSingle().then(check),
    db.from("paper_scan_pages").select("sheet_page,status,image_path").eq("sheet_id", sheet.id).in("status", ["accepted", "review"]).order("sheet_page").then(check),
    db.from("profiles").select("email").eq("id", sheet.student_id).single().then(check),
    db.from("responses").select("question_id,student_answer,is_correct,points_awarded").eq("attempt_id", sheet.attempt_id).then(check),
  ]);
  if (!grade || !finalFeedbackGrade(sheet.questions, pages ?? [], grade) || !validFeedbackEmail(profile?.email))
    throw new ScanError("This student is not ready for feedback. Check the grade and email address.", 409);
  const ids = sheet.questions.map(q => q.questionId);
  const questions = new Map<string, PaperQuestion>(), keys = new Map<string, PaperKey>();
  for (let i = 0; i < ids.length; i += 100) {
    const [qs, ks] = await Promise.all([
      db.from("questions").select("id,prompt,options").in("id", ids.slice(i, i + 100)).then(check),
      db.from("question_keys").select("question_id,correct_answer,explanation").in("question_id", ids.slice(i, i + 100)).then(check),
    ]);
    for (const q of qs ?? []) questions.set(q.id, q);
    for (const k of ks ?? []) keys.set(k.question_id, k);
  }
  const personalSheet = { id: sheet.id, token: sheet.token, studentId: sheet.student_id, studentName: sheet.student_name,
    studentCode: sheet.student_code, classId: sheet.class_id, className: sheet.class_name, version: sheet.version, questions: sheet.questions };
  const rows = feedbackRows(personalSheet, grade, responses ?? [], keys);
  const scans: Uint8Array[] = [];
  for (const page of pages ?? []) {
    const scan = check(await db.storage.from(SCAN_BUCKET).download(page.image_path));
    if (!scan) throw new Error("The student's original scan could not be loaded.");
    scans.push(await sharp(Buffer.from(await scan.arrayBuffer()), { limitInputPixels: 25_000_000 }).rotate().flatten({ background: "white" }).png().toBuffer());
  }
  const pdf = await buildFeedbackPdf({ title, sheet: personalSheet, rows, questions, keys, scans });
  return { pdf, rows, recipient: profile.email, name: sheet.student_name, title };
}

export async function previewFeedback(id: string, sheetId: string) {
  const { assignment } = await feedbackAccess(id);
  return (await loadPacket(createAdminClient(), id, sheetId, assignment.title)).pdf;
}

export async function sendStudentFeedback(id: string, sheetId: string) {
  const { teacher, assignment } = await feedbackAccess(id), db = createAdminClient();
  const sheet = check(await db.from("paper_scan_sheets").select("id").eq("id", sheetId).eq("assignment_id", id).maybeSingle());
  if (!sheet) throw new ScanError("Student paper not found.", 404);
  if (!await hasGoogleGmailSendPermission(teacher.id)) throw new ScanError("Reconnect Google to enable feedback email delivery.", 409);
  const google = await getGoogleAccessToken(teacher.id);
  if (!google.token || google.status !== "connected") throw new ScanError("Reconnect Google to enable feedback email delivery.", 409);
  const claim = check(await db.rpc("claim_paper_feedback", { p_sheet: sheetId, p_teacher: teacher.id })) as { claimed: boolean; delivery?: Delivery };
  if (!claim.claimed || !claim.delivery) return { outcome: "skipped" as const };
  const delivery = claim.delivery;
  return deliverFeedback({
    prepare: () => loadPacket(db, id, sheetId, assignment.title),
    begin: async () => check(await db.rpc("begin_paper_feedback_send", { p_sheet: sheetId, p_teacher: teacher.id, p_claim: delivery.claim_token })) === true,
    send: packet => sendFeedbackEmail(google.token, packet),
    finish: async (status, messageId, error) => {
      const saved = check(await db.from("paper_feedback_deliveries").update({ status, message_id: messageId, error,
        sent_at: status === "sent" ? new Date().toISOString() : null, updated_at: new Date().toISOString() })
        .eq("sheet_id", sheetId).eq("teacher_id", teacher.id).eq("claim_token", delivery.claim_token)
        .in("status", status === "failed" ? ["preparing", "sending"] : ["sending"]).select("sheet_id"));
      if (!saved?.length) throw new Error("The delivery receipt could not be recorded.");
    },
  });
}
