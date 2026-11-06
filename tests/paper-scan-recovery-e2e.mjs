// Opt-in retry/API/browser regression using synthetic accounts only.
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { filledPdf, fixtureSheet } from "./paper-scan-fixtures.mjs";
import { renderScanPage } from "../lib/paper-scan-render.ts";
if (process.env.RUN_PAPER_SCAN_E2E !== "1")
  throw new Error("Set RUN_PAPER_SCAN_E2E=1.");
nextEnv.loadEnvConfig(process.cwd());
const base = process.env.PAPER_SCAN_BASE_URL ?? "http://localhost:3000";
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  { auth: { persistSession: false } },
);
const run = randomUUID().slice(0, 8),
  password = randomUUID() + "Aa1!",
  users = [],
  objects = [],
  questionIds = [];
let classId, assignmentId;
const check = (r) => {
  if (r.error) throw new Error(r.error.message);
  return r.data;
};
try {
  for (const role of ["teacher", "student"]) {
    const u = check(
      await admin.auth.admin.createUser({
        email: `scan-recovery-${run}-${role}@example.test`,
        password,
        email_confirm: true,
      }),
    ).user;
    users.push(u);
    check(
      await admin
        .from("profiles")
        .update({
          role,
          full_name: `Recovery Demo ${role}`,
          must_change_password: false,
        })
        .eq("id", u.id),
    );
  }
  const jar = new Map();
  const teacher = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll: () => [...jar].map(([name, value]) => ({ name, value })),
        setAll: (cs) => cs.forEach((c) => jar.set(c.name, c.value)),
      },
    },
  );
  check(
    await teacher.auth.signInWithPassword({ email: users[0].email, password }),
  );
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  classId = check(
    await teacher
      .from("classes")
      .insert({
        teacher_id: users[0].id,
        name: `Scan recovery QA ${run}`,
        grade_level: 11,
        academic_year: "2026",
      })
      .select("id")
      .single(),
  ).id;
  check(
    await teacher
      .from("class_members")
      .insert({ class_id: classId, student_id: users[1].id }),
  );
  const skill = check(await teacher.from("skills").select("code").limit(1))[0]
    .code;
  const questions = Array.from({ length: 2 }, (_, i) => [
    {
      prompt: `Recovery demo ${i + 1}`,
      type: "multiple_choice",
      options: ["A", "B", "C", "D"].map((id) => ({ id, text: id })),
      correct_answer: "A",
      numeric_tolerance: 0,
      difficulty: 1,
      points: 1,
      skills: [{ code: skill, weight: 1, is_primary: true }],
    },
  ]);
  assignmentId = check(
    await teacher.rpc("create_paper_assignment_draft_ready", {
      p_title: `Scan recovery regression ${run}`,
      p_description: "Synthetic fixture",
      p_kind: "paper",
      p_due_at: null,
      p_duration_minutes: 60,
      p_max_attempts: 1,
      p_show_score_after_submit: false,
      p_show_answers_after_submit: false,
      p_shuffle_questions: false,
      p_shuffle_options: false,
      p_class_ids: [classId],
      p_questions: questions,
      p_exam_mode: false,
      p_exam_require_fullscreen: false,
      p_exam_track_focus_exits: false,
      p_exam_allowed_focus_exits: 0,
      p_exam_violation_action: "warn",
      p_question_display_mode: "all_at_once",
      p_show_feedback_after_each_question: false,
    }),
  );
  questionIds.push(
    ...check(
      await admin
        .from("assignment_questions")
        .select("question_id")
        .eq("assignment_id", assignmentId),
    ).map((q) => q.question_id),
  );
  check(
    await teacher
      .from("assignments")
      .update({ paper_scan_enabled: true })
      .eq("id", assignmentId),
  );
  check(
    await teacher.rpc("publish_owned_assignment", {
      p_assignment_id: assignmentId,
    }),
  );
  const s = check(
    await teacher.rpc("prepare_owned_scan_sheets", {
      p_assignment_id: assignmentId,
    }),
  )[0];
  const sheet = fixtureSheet(2, {
    id: s.id,
    token: s.token,
    studentId: s.student_id,
    studentName: s.student_name,
    classId: s.class_id,
    className: s.class_name,
    questions: s.questions,
  });
  // A wrong clear answer and a correct clear answer make the result table testable.
  const pdf = await filledPdf([sheet], (i) => (i === 0 ? 0 : 1));
  const image = await renderScanPage(pdf, 1, "application/pdf");
  const batch = randomUUID(),
    root = `${users[0].id}/${assignmentId}/${batch}`,
    source = root + "/source",
    original = root + "/original.png";
  objects.push(source, original);
  check(
    await admin.storage
      .from("paper-scans")
      .upload(source, pdf, { contentType: "application/pdf" }),
  );
  check(
    await admin.storage
      .from("paper-scans")
      .upload(original, image.bytes, { contentType: "image/png" }),
  );
  check(
    await admin
      .from("paper_scan_batches")
      .insert({
        id: batch,
        assignment_id: assignmentId,
        teacher_id: users[0].id,
        file_name: "old-unidentified.pdf",
        file_hash: createHash("sha256").update(pdf).digest("hex"),
        file_size: pdf.length,
        mime: "application/pdf",
        source_path: source,
        status: "complete",
        page_count: 1,
        next_page: 2,
      }),
  );
  let page = check(
    await admin
      .from("paper_scan_pages")
      .insert({
        assignment_id: assignmentId,
        batch_id: batch,
        source_page: 1,
        image_path: original,
        status: "unidentified",
        readings: [],
        problem: "QR code unreadable",
        algorithm: "jm-omr-1.0",
      })
      .select("*")
      .single(),
  );
  const request = async (body) => {
    const r = await fetch(`${base}/api/assignments/${assignmentId}/scans`, {
      method: "POST",
      headers: {
        Cookie: cookie(),
        Origin: base,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    return { status: r.status, value: await r.json() };
  };
  const retried = await request({
    action: "reprocess",
    pageId: page.id,
    revision: page.revision,
  });
  assert.equal(retried.status, 200, JSON.stringify(retried.value));
  page = retried.value.page;
  assert.equal(page.status, "accepted");
  assert.equal(page.sheet_id, s.id);
  assert.equal(page.image_path, original);
  const grade = check(
    await admin
      .from("attempts")
      .select("status,score,max_score")
      .eq("assignment_id", assignmentId)
      .single(),
  );
  assert.deepEqual(grade, { status: "submitted", score: 1, max_score: 2 });
  const audit = check(
    await admin
      .from("paper_scan_audit")
      .select("detail")
      .eq("page_id", page.id)
      .eq("event", "recognition_retried"),
  );
  assert.equal(audit[0].detail.previousStatus, "unidentified");
  assert.deepEqual(audit[0].detail.previousReadings, []);
  assert.equal(
    (await request({ action: "reprocess", pageId: page.id, revision: 1 }))
      .status,
    409,
  );
  assert.equal(
    (
      await request({
        action: "reprocess",
        pageId: page.id,
        revision: page.revision,
      })
    ).status,
    409,
  );
  if (process.env.PLAYWRIGHT_MODULE) {
    const pw = await import(
      process.env.PLAYWRIGHT_MODULE.replaceAll("\\", "/").startsWith("file:")
        ? process.env.PLAYWRIGHT_MODULE
        : "file:///" + process.env.PLAYWRIGHT_MODULE.replaceAll("\\", "/")
    );
    const { chromium } = pw.default ?? pw;
    const browser = await chromium.launch({
      headless: true,
      channel: "chrome",
    });
    try {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
      });
      await context.addCookies(
        [...jar].map(([name, value]) => ({ name, value, url: base })),
      );
      const tab = await context.newPage();
      await tab.goto(`${base}/teacher/assignments/${assignmentId}/marking`);
      await tab.getByRole("table").waitFor();
      assert.equal(
        await tab.getByRole("cell", { name: "✓ Correct", exact: true }).count(),
        1,
      );
      assert.equal(
        await tab
          .getByRole("cell", { name: "✕ Incorrect", exact: true })
          .count(),
        1,
      );
      await tab.screenshot({
        path: join(tmpdir(), "scan-recovery-desktop.png"),
        fullPage: true,
      });
      await tab.setViewportSize({ width: 390, height: 844 });
      assert.equal(
        await tab.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        true,
      );
      await tab.screenshot({
        path: join(tmpdir(), "scan-recovery-mobile.png"),
        fullPage: true,
      });
    } finally {
      await browser.close();
    }
  }
  // An explicit teacher hold must survive all subsequent recognition retries.
  const reopened = await request({
    action: "review",
    pageId: page.id,
    revision: page.revision,
    reviewAction: "reopen",
    decisions: [],
    note: "Manual hold must not be replaced by recognition",
  });
  assert.equal(reopened.status, 200);
  page = reopened.value.page;
  const blocked = await request({
    action: "reprocess",
    pageId: page.id,
    revision: page.revision,
  });
  assert.equal(blocked.status, 409);
  const held = check(
    await admin
      .from("attempts")
      .select("status,score")
      .eq("assignment_id", assignmentId)
      .single(),
  );
  assert.equal(held.status, "in_progress");
  assert.equal(held.score, null);
  console.log(
    "PASS: retry recovers identity, grades once, shows correct/incorrect on desktop/mobile, preserves original evidence/audit, rejects stale and finalized retries, and preserves manual holds.",
  );
} finally {
  if (assignmentId) {
    const pages = check(
      await admin
        .from("paper_scan_pages")
        .select("normalized_path")
        .eq("assignment_id", assignmentId),
    );
    objects.push(...pages.map((p) => p.normalized_path).filter(Boolean));
    for (const table of [
      "paper_scan_audit",
      "paper_scan_pages",
      "paper_scan_sheets",
      "paper_scan_batches",
      "attempts",
    ])
      check(await admin.from(table).delete().eq("assignment_id", assignmentId));
    check(await admin.from("assignments").delete().eq("id", assignmentId));
  }
  if (objects.length)
    check(await admin.storage.from("paper-scans").remove(objects));
  if (questionIds.length)
    check(await admin.from("questions").delete().in("id", questionIds));
  if (classId) check(await admin.from("classes").delete().eq("id", classId));
  for (const u of users) check(await admin.auth.admin.deleteUser(u.id));
}
