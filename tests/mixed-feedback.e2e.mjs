// Opt-in full application/database verification. No real email is sent.
// Start the local production server with feedback-gmail-mock.cjs preloaded.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { filledPdf } from "./paper-scan-fixtures.mjs";
import { renderScanPage } from "../lib/paper-scan-render.ts";

if (process.env.RUN_FEEDBACK_E2E !== "1") throw new Error("Set RUN_FEEDBACK_E2E=1.");
nextEnv.loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
const base = process.env.FEEDBACK_TEST_BASE_URL ?? "http://localhost:3117";
if (!/^http:\/\/(localhost|127\.0\.0\.1):/.test(base)) throw new Error("Email-flow tests require the local mocked server.");
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const check = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const users = [], questionIds = [], objects = [], run = randomUUID().slice(0, 8), password = randomUUID() + "Aa1!";
const artifacts = join(tmpdir(), `mixed-feedback-${run}`);
let classId, assignmentId, browser;
async function session(user) {
  const jar = new Map();
  const db = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: cs => cs.forEach(c => jar.set(c.name, c.value)) },
  });
  check(await db.auth.signInWithPassword({ email: user.email, password }));
  return { db, jar, cookie: () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ") };
}
try {
  await mkdir(artifacts, { recursive: true });
  for (let i = 0; i < 6; i++) {
    const user = check(await admin.auth.admin.createUser({ email: `feedback-qa-${run}-${i}@example.test`, password, email_confirm: true })).user;
    users.push(user);
    check(await admin.from("profiles").update({ role: i < 2 ? "teacher" : "student", full_name: `Feedback QA ${i}`, must_change_password: false }).eq("id", user.id));
  }
  const teacher = await session(users[0]), other = await session(users[1]), student = await session(users[2]);
  classId = check(await teacher.db.from("classes").insert({ teacher_id: users[0].id, name: `Feedback QA ${run}`, grade_level: 11, academic_year: "2026" }).select("id").single()).id;
  check(await teacher.db.from("class_members").insert(users.slice(2).map(u => ({ class_id: classId, student_id: u.id }))));
  const demo = JSON.parse(await readFile(new URL("../data/assessment-imports/unit-1-extremely-easy-mixed-demo-10q-4v.json", import.meta.url)));
  assignmentId = check(await teacher.db.rpc("create_paper_assignment_draft_ready", {
    p_title: `Feedback QA ${run}`, p_description: "Synthetic email test", p_kind: "paper", p_due_at: null, p_duration_minutes: 30,
    p_max_attempts: 1, p_show_score_after_submit: false, p_show_answers_after_submit: false, p_shuffle_questions: false, p_shuffle_options: false,
    p_class_ids: [classId], p_questions: demo.question_groups, p_exam_mode: false, p_exam_require_fullscreen: false,
    p_exam_track_focus_exits: false, p_exam_allowed_focus_exits: 0, p_exam_violation_action: "warn", p_question_display_mode: "all_at_once", p_show_feedback_after_each_question: false,
  }));
  for (const table of ["assignment_questions", "assignment_question_variants"])
    questionIds.push(...check(await admin.from(table).select("question_id").eq("assignment_id", assignmentId)).map(q => q.question_id));
  check(await teacher.db.from("assignments").update({ paper_scan_enabled: true }).eq("id", assignmentId));
  check(await teacher.db.rpc("publish_owned_assignment", { p_assignment_id: assignmentId }));
  const sheets = check(await teacher.db.rpc("prepare_owned_scan_sheets", { p_assignment_id: assignmentId }));
  const keys = new Map(check(await admin.from("question_keys").select("question_id,correct_answer").in("question_id", questionIds)).map(k => [k.question_id, k.correct_answer]));
  for (let i = 0; i < 3; i++) {
    const s = sheets[i], path = `${users[0].id}/${assignmentId}/qa-${i}.png`;
    const personal = { id: s.id, token: s.token, studentId: s.student_id, studentName: s.student_name, studentCode: s.student_code, classId, className: s.class_name, version: s.version, questions: s.questions };
    const image = (await renderScanPage(await filledPdf([personal]), 1, "application/pdf")).bytes;
    check(await admin.storage.from("paper-scans").upload(path, image, { contentType: "image/png" })); objects.push(path);
    const batch = check(await admin.from("paper_scan_batches").insert({ assignment_id: assignmentId, teacher_id: users[0].id,
      file_name: `qa-${i}.png`, file_hash: randomUUID().replaceAll("-", "").repeat(2), file_size: image.length, mime: "image/png", source_path: path, status: "ready" }).select("id").single());
    const claim = check(await admin.rpc("claim_scan_batch", { p_batch_id: batch.id, p_teacher_id: users[0].id }));
    check(await admin.rpc("record_scan_page", { p_batch_id: batch.id, p_lease: claim.lease, p_page_count: 1, p_sheet: s.id, p_sheet_page: 1,
      p_image_path: path, p_normalized_path: null, p_problem: i === 2 ? "Synthetic alignment review" : null, p_algorithm: "synthetic-feedback-qa",
      p_readings: s.questions.map(q => ({ position: q.position, choice: "ABCD"[(q.optionOrder ?? ["A", "B", "C", "D"]).indexOf(keys.get(q.questionId))], status: "clear", densities: [0, 0, 0, 0] })) }));
  }
  check(await admin.from("google_classroom_connections").insert({ teacher_id: users[0].id, refresh_token: `feedback-qa-${run}`, scopes: ["https://www.googleapis.com/auth/gmail.send"] }));
  const endpoint = `/api/assignments/${assignmentId}/feedback`;
  const request = (path, body, auth = teacher, origin = base) => fetch(base + path, { method: body ? "POST" : "GET",
    headers: { Cookie: auth?.cookie() ?? "", Origin: origin, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const read = async () => { const r = await request(endpoint); assert.equal(r.status, 200); return r.json(); };
  const summary = await read(); assert.equal(summary.graded, 2); assert.equal(summary.ready.length, 2); assert.equal(summary.gmailConnected, true);
  assert.equal((await request(endpoint, null, null)).status, 401);
  assert.equal((await request(endpoint, null, other)).status, 404);
  assert.equal((await request(endpoint, null, student)).status, 403);
  assert.equal((await request(endpoint, { sheetId: sheets[0].id }, teacher, "https://wrong.example")).status, 403);
  assert.ok((await student.db.rpc("claim_paper_feedback", { p_sheet: sheets[0].id, p_teacher: users[0].id })).error);
  assert.ok((await student.db.from("paper_feedback_deliveries").select("*")).error);
  assert.equal((await request(`${endpoint}?preview=${sheets[2].id}`)).status, 409);
  console.log("PASS: only final grades eligible; pending/review/student/foreign-teacher/anonymous/origin/RPC access rejected.");

  const first = summary.ready[0];
  const claimArgs = { p_sheet: first, p_teacher: users[0].id };
  const claims = await Promise.all([admin.rpc("claim_paper_feedback", claimArgs).then(check), admin.rpc("claim_paper_feedback", claimArgs).then(check)]);
  assert.equal(claims.filter(c => c.claimed).length, 1);
  const initialClaim = claims.find(c => c.claimed).delivery;
  const page = check(await admin.from("paper_scan_pages").select("id,revision").eq("sheet_id", first).single());
  check(await admin.from("paper_scan_pages").update({ revision: page.revision + 1 }).eq("id", page.id));
  assert.equal(check(await admin.rpc("begin_paper_feedback_send", { ...claimArgs, p_claim: initialClaim.claim_token })), false);
  const nextClaim = check(await admin.rpc("claim_paper_feedback", claimArgs)); assert.equal(nextClaim.claimed, true);
  check(await admin.from("paper_feedback_deliveries").update({ status: "sending" }).eq("sheet_id", first));
  assert.equal(check(await admin.rpc("claim_paper_feedback", claimArgs)).claimed, false);
  check(await admin.from("paper_feedback_deliveries").update({ status: "uncertain" }).eq("sheet_id", first));
  assert.equal(check(await admin.rpc("claim_paper_feedback", claimArgs)).claimed, false);
  check(await admin.from("paper_feedback_deliveries").update({ status: "failed" }).eq("sheet_id", first));
  console.log("PASS: concurrent claim serialization; changed-paper guard; sending/uncertain receipts cannot be automatically retried.");

  const preview = await request(`${endpoint}?preview=${first}`); assert.equal(preview.status, 200);
  assert.equal(preview.headers.get("cache-control"), "private, no-store");
  await writeFile(join(artifacts, "feedback.pdf"), Buffer.from(await preview.arrayBuffer()));
  const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || "playwright");
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addCookies([...teacher.jar].map(([name, value]) => ({ name, value, url: base })));
  const tab = await context.newPage(), errors = [];
  tab.on("pageerror", e => errors.push(e.message));
  await tab.goto(`${base}/teacher/assignments/${assignmentId}`);
  const panel = tab.getByRole("region", { name: "Student feedback emails" });
  await panel.getByRole("button", { name: "Email feedback to 2 marked students", exact: true }).waitFor();
  await panel.screenshot({ path: join(artifacts, "desktop.png") });
  await tab.setViewportSize({ width: 390, height: 844 });
  assert.ok(await panel.evaluate(el => el.getBoundingClientRect().right <= innerWidth + 1));
  await panel.screenshot({ path: join(artifacts, "mobile.png") });
  await panel.getByRole("button", { name: "Email feedback to 2 marked students", exact: true }).click();
  await panel.getByText("Finished this batch: 2 emailed.", { exact: true }).waitFor({ timeout: 120_000 });
  const receipts = check(await admin.from("paper_feedback_deliveries").select("status,message_id").eq("assignment_id", assignmentId));
  assert.equal(receipts.length, 2); assert.ok(receipts.every(r => r.status === "sent" && r.message_id === "feedback-qa-mocked-gmail-receipt"));
  assert.equal((await read()).ready.length, 0);
  const repeated = await request(endpoint, { sheetId: first }); assert.equal((await repeated.json()).outcome, "skipped");
  assert.deepEqual(errors, []);
  console.log("PASS: desktop/mobile button sends exactly two private mocked emails, saves receipts, and skips repeat clicks.");
  console.log(`Artifacts: ${artifacts}`);
} finally {
  if (browser) await browser.close();
  if (assignmentId) {
    for (const table of ["paper_scan_audit", "paper_scan_pages", "paper_scan_sheets", "paper_scan_batches", "attempts"])
      check(await admin.from(table).delete().eq("assignment_id", assignmentId));
    check(await admin.from("assignments").delete().eq("id", assignmentId));
  }
  if (objects.length) check(await admin.storage.from("paper-scans").remove(objects));
  if (questionIds.length) check(await admin.from("questions").delete().in("id", questionIds));
  if (classId) check(await admin.from("classes").delete().eq("id", classId));
  for (const user of users) check(await admin.auth.admin.deleteUser(user.id));
}
