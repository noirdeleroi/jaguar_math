// Opt-in real API/DB/PDF/browser verification with isolated synthetic accounts.
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { filledPdf } from "./paper-scan-fixtures.mjs";
import { renderScanPage } from "../lib/paper-scan-render.ts";
import { identifyScan } from "../lib/paper-scan-recognition.ts";
import { CHOICES, printedScanChoice } from "../lib/paper-scan-layout.ts";
import { personalizedPaperMaterial } from "../lib/paper-scan-papers.ts";
import { splitPdfMath } from "../lib/pdf-math-text.ts";

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
  questionIds = [],
  objects = [];
const artifacts = join(tmpdir(), `personalized-mixed-demo-${run}`);
let assignmentId, classId;
const check = (r) => {
  if (r.error) throw new Error(r.error.message);
  return r.data;
};
const demo = JSON.parse(
  await readFile(
    new URL(
      "../data/assessment-imports/unit-1-mathematics-test-10q-4v.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const asSheet = (s) => ({
  id: s.id,
  token: s.token,
  studentId: s.student_id,
  studentName: s.student_name,
  studentCode: s.student_code,
  classId: s.class_id,
  className: s.class_name,
  version: s.version,
  questions: s.questions,
});
const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
async function pdfText(bytes) {
  const task = getDocument({ data: new Uint8Array(bytes) }),
    doc = await task.promise;
  try {
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++)
      pages.push(
        (await (await doc.getPage(i)).getTextContent()).items
          .map((x) => x.str ?? "")
          .join(" "),
      );
    return pages;
  } finally {
    await task.destroy();
  }
}
try {
  await mkdir(artifacts, { recursive: true });
  for (let i = 0; i < 6; i++) {
    const role = i === 0 ? "teacher" : "student";
    const u = check(
      await admin.auth.admin.createUser({
        email: `personal-paper-${run}-${i}@example.test`,
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
          full_name:
            i === 0
              ? "Personal Paper QA Teacher"
              : i === 5
                ? "Legacy Demo Student"
                : `Demo Student ${i}`,
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
  const request = (path, body) =>
    fetch(base + path, {
      method: body ? "POST" : "GET",
      headers: {
        Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "),
        Origin: base,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const post = async (body) => {
    for (let retry = 0; ; retry++) {
      const r = await request(`/api/assignments/${assignmentId}/scans`, body),
        value = await r.json();
      // Exercise the same supported resume action as the UI when remote
      // storage takes longer than the processing lease. Issued papers and
      // accepted pages must remain unchanged across this retry.
      if (body.action === "process" && retry < 2 && value.error === "Recognition could not be saved. Retry this page.") {
        console.log("RETRY: resuming an expired scan-processing lease.");
        continue;
      }
      assert.equal(r.status, 200, JSON.stringify(value));
      return value;
    }
  };
  classId = check(
    await teacher
      .from("classes")
      .insert({
        teacher_id: users[0].id,
        name: `Demo Class ${run}`,
        grade_level: 11,
        academic_year: "2026",
      })
      .select("id")
      .single(),
  ).id;
  check(
    await teacher
      .from("class_members")
      .insert(
        users.slice(1).map((u) => ({ class_id: classId, student_id: u.id })),
      ),
  );
  assignmentId = check(
    await teacher.rpc("create_paper_assignment_draft_ready", {
      p_title: `Personal papers QA ${run}`,
      p_description: "Synthetic demo test",
      p_kind: "paper",
      p_due_at: null,
      p_duration_minutes: 30,
      p_max_attempts: 1,
      p_show_score_after_submit: false,
      p_show_answers_after_submit: false,
      p_shuffle_questions: false,
      p_shuffle_options: false,
      p_class_ids: [classId],
      p_questions: demo.question_groups,
      p_exam_mode: false,
      p_exam_require_fullscreen: false,
      p_exam_track_focus_exits: false,
      p_exam_allowed_focus_exits: 0,
      p_exam_violation_action: "warn",
      p_question_display_mode: "all_at_once",
      p_show_feedback_after_each_question: false,
    }),
  );
  const baseQuestions = check(
    await admin
      .from("assignment_questions")
      .select("question_id,position,points")
      .eq("assignment_id", assignmentId)
      .order("position"),
  );
  const variants = check(
    await admin
      .from("assignment_question_variants")
      .select("question_id")
      .eq("assignment_id", assignmentId),
  );
  questionIds.push(
    ...baseQuestions.map((q) => q.question_id),
    ...variants.map((q) => q.question_id),
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
  const legacy = check(
    await admin
      .from("paper_scan_sheets")
      .insert({
        assignment_id: assignmentId,
        student_id: users[5].id,
        class_id: classId,
        student_name: "Legacy Demo Student",
        student_code: "LEGACY",
        class_name: `Demo Class ${run}`,
        version: 1,
        questions: baseQuestions.map((q) => ({
          position: q.position,
          questionId: q.question_id,
          points: q.points,
          options: ["A", "B", "C", "D"],
        })),
      })
      .select("*")
      .single(),
  );
  const sheets = check(
    await teacher.rpc("prepare_owned_scan_sheets", {
      p_assignment_id: assignmentId,
    }),
  );
  assert.equal(sheets.length, 5);
  assert.deepEqual(
    sheets.find((s) => s.id === legacy.id),
    legacy,
  );
  assert.deepEqual(
    check(
      await teacher.rpc("prepare_owned_scan_sheets", {
        p_assignment_id: assignmentId,
      }),
    ),
    sheets,
  );
  const personalized = sheets.filter((s) => s.id !== legacy.id);
  for (const s of personalized)
    for (const q of s.questions) {
      assert.ok(q.variantIndex >= 1 && q.variantIndex <= 4);
      assert.deepEqual([...q.optionOrder].sort(), ["A", "B", "C", "D"]);
    }
  assert.ok(
    personalized.some(
      (s) => new Set(s.questions.map((q) => q.variantIndex)).size > 1,
    ),
  );
  assert.ok(
    Array.from(
      { length: 10 },
      (_, i) =>
        new Set(personalized.map((s) => s.questions[i].variantIndex)).size,
    ).some((size) => size > 1),
  );
  assert.ok(
    new Set(
      personalized.flatMap((s) =>
        s.questions.map((q) => q.optionOrder.join("")),
      ),
    ).size > 4,
  );
  const keys = check(
    await admin
      .from("question_keys")
      .select("question_id,correct_answer,explanation")
      .in("question_id", questionIds),
  );
  const keyMap = new Map(keys.map((k) => [k.question_id, k]));
  assert.ok(
    Array.from(
      { length: 10 },
      (_, i) =>
        new Set(
          personalized.map((s) =>
            printedScanChoice(
              s.questions[i],
              keyMap.get(s.questions[i].questionId).correct_answer,
            ),
          ),
        ).size,
    ).some((size) => size > 1),
  );
  console.log(
    "PASS: real 10×4 import; independent per-question variants and shuffled keys; stable reprints; legacy sheet unchanged.",
  );
  const first = sheets[0],
    firstSheet = asSheet(first);
  const questions = new Map(
    check(
      await admin
        .from("questions")
        .select("id,prompt,options")
        .in("id", questionIds),
    ).map((q) => [q.id, q]),
  );
  const material = personalizedPaperMaterial("Demo", firstSheet, questions);
  for (const kind of ["questions", "packet", "key"]) {
    const r = await request(
      `/api/assignments/${assignmentId}/papers.pdf?kind=${kind}&studentId=${first.student_id}`,
    );
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("cache-control"), "private, no-store");
    const bytes = Buffer.from(await r.arrayBuffer());
    await writeFile(join(artifacts, `${kind}.pdf`), bytes);
    const text = await pdfText(bytes),
      combined = text.join(" ");
    assert.equal(text.length, kind === "questions" ? 2 : 3, "two question pages plus the separate QR sheet or private key");
    assert.ok(combined.includes(first.student_name));
    assert.ok(combined.includes(first.class_name));
    assert.ok(combined.includes(first.id.slice(0, 8).toUpperCase()));
    for (const other of sheets.slice(1))
      assert.ok(!combined.includes(other.student_name));
    const normalized = combined.replace(/\s+/g, " ");
    for (const q of material.questions) {
      // Equations are real typeset glyphs; verify the prose independently of
      // PDF text extraction, which cannot recover outlined mathematical glyphs.
      for (const part of splitPdfMath(q.prompt).filter((part) => !part.math)) {
        const prose = part.text.replace(/\s+/g, " ").trim();
        if (prose.length > 12) assert.ok(normalized.includes(prose), prose);
      }
    }
    assert.match(combined, /\$(?:90|120|150|200)/);
    assert.doesNotMatch(combined, /x\^|\(3x \+|!=|<=|>=/);
    if (kind !== "key")
      assert.doesNotMatch(
        combined,
        /ANSWER KEY|PRIVATE TEACHER KEY|Correct answers and teacher explanations/,
      );
    if (kind === "packet") {
      assert.ok(text.at(-1).includes("Template JM1"));
      const image = await renderScanPage(bytes, text.length, "application/pdf");
      assert.deepEqual((await identifyScan(image.bytes)).identifier, {
        token: first.token,
        page: 1,
      });
      const preview = await renderScanPage(bytes, 1, "application/pdf");
      await writeFile(join(artifacts, "question-preview.png"), preview.bytes);
      await writeFile(join(artifacts, "answer-preview.png"), image.bytes);
    }
    if (kind === "key") {
      assert.match(combined, /PRIVATE TEACHER KEY/);
      for (const slot of firstSheet.questions) {
        const printed = printedScanChoice(slot, keyMap.get(slot.questionId).correct_answer);
        assert.match(combined, new RegExp(`${slot.position}\\.\\s+${printed}\\.`));
      }
    }
  }
  const classPdf = await request(
    `/api/assignments/${assignmentId}/papers.pdf?classId=${classId}`,
  );
  assert.equal(classPdf.status, 200);
  const classPages = await pdfText(
    new Uint8Array(await classPdf.arrayBuffer()),
  );
  assert.equal(classPages.filter((t) => t.includes("Template JM1")).length, 5);
  assert.equal(
    (
      await request(
        `/api/assignments/${assignmentId}/papers.pdf?studentId=${randomUUID()}`,
      )
    ).status,
    404,
  );
  const noAuth = await fetch(
    `${base}/api/assignments/${assignmentId}/papers.pdf`,
    { redirect: "manual" },
  );
  assert.notEqual(noAuth.status, 200);
  const redirect = await request(
    `/api/assignments/${assignmentId}/answer-key.pdf?questionsOnly=1&studentId=${first.student_id}`,
  );
  assert.equal(redirect.status, 200);
  assert.ok(
    (await pdfText(new Uint8Array(await redirect.arrayBuffer())))
      .join(" ")
      .includes(first.student_name),
  );
  console.log(
    "PASS: individual/class packet downloads, matching named question/QR sheets, no student solutions, private keys, download access checks.",
  );
  const second = sheets[1];
  const filled = await filledPdf(
    sheets.map(asSheet),
    (i, s) => {
      if (s.id === second.id && i < 3) return null;
      const q = s.questions[i],
        source = keyMap.get(q.questionId).correct_answer;
      const correct = (q.optionOrder ?? ["A", "B", "C", "D"]).indexOf(source);
      return s.id === first.id && i === 0 ? (correct + 1) % 4 : correct;
    },
    { 0: "faint", 1: "faint", 2: "faint" },
  );
  const registered = await post({
    action: "register",
    name: "five-personalized-answer-sheets.pdf",
    size: filled.length,
    hash: createHash("sha256").update(filled).digest("hex"),
    mime: "application/pdf",
  });
  const uploaded = await fetch(registered.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "application/pdf", "x-upsert": "false" },
    body: filled,
  });
  assert.ok(uploaded.ok);
  await post({ action: "uploaded", batchId: registered.batchId });
  const firstProcessed = await post({
    action: "process",
    batchId: registered.batchId,
  });
  assert.equal(firstProcessed.done, false);
  const partial = await (
    await request(`/api/assignments/${assignmentId}/scans`)
  ).json();
  assert.equal(
    partial.grades.filter((g) => g.status === "submitted").length,
    1,
  );
  assert.equal(partial.sheets.filter((s) => !s.attempt_id).length, 4);
  console.log(
    "PASS: the first pencil scan grades immediately while four unscanned students remain pending.",
  );
  let processed;
  do {
    processed = await post({ action: "process", batchId: registered.batchId });
  } while (!processed.done);
  const workspace = await (
    await request(`/api/assignments/${assignmentId}/scans`)
  ).json();
  assert.equal(
    workspace.pages.filter((p) => p.status === "accepted").length,
    5,
  );
  for (const s of workspace.sheets) {
    const grade = workspace.grades.find((g) => g.id === s.attempt_id);
    assert.equal(grade.status, "submitted");
    assert.equal(grade.max_score, 10);
    assert.equal(
      grade.score,
      s.id === first.id ? 9 : s.id === second.id ? 7 : 10,
    );
    const aq = check(
      await admin
        .from("attempt_questions")
        .select("question_id,option_order")
        .eq("attempt_id", s.attempt_id),
    );
    for (const q of s.questions)
      assert.deepEqual(
        aq.find((a) => a.question_id === q.questionId).option_order,
        q.optionOrder ?? ["A", "B", "C", "D"],
      );
    const responses = check(
      await admin
        .from("responses")
        .select("question_id,student_answer,is_correct")
        .eq("attempt_id", s.attempt_id),
    );
    for (const response of responses)
      if (!(
        (s.id === first.id &&
          s.questions[0].questionId === response.question_id) ||
        (s.id === second.id &&
          s.questions
            .slice(0, 3)
            .some((q) => q.questionId === response.question_id))
      )) {
        assert.equal(
          response.student_answer,
          keyMap.get(response.question_id).correct_answer,
        );
        assert.equal(response.is_correct, true);
      }
  }
  const csv = await (
    await request(`/api/assignments/${assignmentId}/scan-results.csv`)
  ).text();
  assert.equal(csv.split("\r\n").length, 51);
  console.log(
    "PASS: five pencil-marked papers graded automatically (9/10, 7/10, 10/10); blanks score zero; individual keys, canonical answers and CSV correct.",
  );
  if (process.env.PLAYWRIGHT_MODULE) {
    const pw = await import(
      "file:///" + process.env.PLAYWRIGHT_MODULE.replaceAll("\\", "/")
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
      await tab
        .getByRole("heading", {
          name: "Individual question papers & QR sheets",
        })
        .waitFor();
      assert.equal(await tab.getByRole("table").count(), 0);
      await tab.getByRole("link", { name: "2 · Grades & confidence" }).click();
      await tab.getByRole("table").waitFor();
      await tab
        .getByRole("link", { name: "View / edit answers", exact: true })
        .first()
        .waitFor();
      assert.equal(
        await tab
          .getByRole("link", { name: "View / edit answers", exact: true })
          .count(),
        5,
      );
      assert.equal(
        await tab
          .getByRole("link", { name: "Question paper", exact: true })
          .count(),
        5,
      );
      await tab
        .getByRole("searchbox", { name: "Find a student" })
        .fill(first.student_name);
      assert.equal(
        await tab
          .getByRole("link", { name: "View / edit answers", exact: true })
          .count(),
        1,
      );
      await tab.getByRole("searchbox", { name: "Find a student" }).fill("");
      await tab.screenshot({
        path: join(artifacts, "grading-dashboard.png"),
        fullPage: true,
      });
      await tab
        .getByRole("row")
        .filter({ hasText: first.student_name })
        .getByRole("link", { name: "View / edit answers", exact: true })
        .click();
      await tab
        .getByRole("cell", { name: "✕ Incorrect", exact: true })
        .waitFor();
      assert.equal(
        await tab.getByRole("cell", { name: "✓ Correct", exact: true }).count(),
        9,
      );
      assert.equal(
        await tab
          .getByRole("columnheader", {
            name: "Recognition confidence",
            exact: true,
          })
          .count(),
        1,
      );
      assert.equal(
        await tab
          .getByRole("combobox", { name: /Answer for question/ })
          .count(),
        10,
      );
      await tab
        .getByRole("button", {
          name: "Enlarge scan for question 1",
          exact: true,
        })
        .first()
        .waitFor();
      assert.equal(
        await tab
          .getByRole("button", { name: /Enlarge scan for question/ })
          .count(),
        10,
      );
      await tab
        .getByRole("button", {
          name: "Enlarge scan for question 1",
          exact: true,
        })
        .click();
      await tab.getByRole("dialog").waitFor();
      assert.ok((await tab.getByRole("dialog").boundingBox()).width > 600);
      await tab
        .getByRole("button", { name: "Next question", exact: true })
        .click();
      await tab
        .getByRole("heading", {
          name: "Scanned answer · Question 2",
          exact: true,
        })
        .waitFor();
      await tab.keyboard.press("Escape");
      assert.equal(await tab.getByRole("dialog").count(), 0);
      const correct = printedScanChoice(
        first.questions[0],
        keyMap.get(first.questions[0].questionId).correct_answer,
      );
      const saveChange = async () => {
        const response = tab.waitForResponse(
          (r) => r.url().endsWith("/scans") && r.request().method() === "POST",
        );
        await tab
          .getByRole("button", { name: "Save changes", exact: true })
          .click();
        assert.equal((await response).status(), 200);
        await tab
          .getByText("Teacher-reviewed grade saved", { exact: true })
          .waitFor();
      };
      await tab
        .getByRole("combobox", { name: "Answer for question 1", exact: true })
        .selectOption(correct);
      await saveChange();
      const attemptId = workspace.sheets.find(
        (s) => s.id === first.id,
      ).attempt_id;
      assert.equal(
        check(
          await admin
            .from("attempts")
            .select("score")
            .eq("id", attemptId)
            .single(),
        ).score,
        10,
      );
      await tab
        .getByRole("combobox", { name: "Answer for question 1", exact: true })
        .selectOption("blank");
      await saveChange();
      await tab
        .getByRole("cell", { name: "Blank · 0 pts", exact: true })
        .waitFor();
      assert.equal(
        check(
          await admin
            .from("attempts")
            .select("score")
            .eq("id", attemptId)
            .single(),
        ).score,
        9,
      );
      await tab
        .getByRole("button", {
          name: "Enlarge scan for question 1",
          exact: true,
        })
        .first()
        .waitFor();
      await tab.evaluate(async () => {
        const element = document.querySelector("table svg image");
        const image = new Image();
        image.src = element.getAttribute("href");
        await image.decode();
      });
      await tab.screenshot({
        path: join(artifacts, "desktop.png"),
        fullPage: true,
      });
      await tab.setViewportSize({ width: 390, height: 844 });
      assert.ok(
        await tab.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      );
      await tab.screenshot({
        path: join(artifacts, "mobile.png"),
        fullPage: true,
      });
      const reviewed = check(
        await admin
          .from("paper_scan_pages")
          .select("*")
          .eq("sheet_id", first.id)
          .single(),
      );
      await post({
        action: "review",
        pageId: reviewed.id,
        revision: reviewed.revision,
        reviewAction: "reopen",
        decisions: [],
        note: "Explicit teacher grade hold",
      });
      const held = check(
        await admin
          .from("paper_scan_pages")
          .select("*")
          .eq("id", reviewed.id)
          .single(),
      );
      const blocked = await request(`/api/assignments/${assignmentId}/scans`, {
        action: "reprocess",
        pageId: held.id,
        revision: held.revision,
      });
      assert.equal(blocked.status, 409);
      assert.equal(
        check(
          await admin
            .from("attempts")
            .select("score")
            .eq("id", attemptId)
            .single(),
        ).score,
        null,
      );
      // Simulate the stored alignment-failure state without changing its original raster.
      objects.push(held.normalized_path);
      check(
        await admin
          .from("paper_scan_pages")
          .update({
            normalized_path: null,
            problem:
              "QR and alignment squares disagree. Rescan or review manually.",
            decisions: null,
            readings: first.questions.map((q) => ({
              position: q.position,
              choice: null,
              status: "unreadable",
              densities: [],
            })),
          })
          .eq("id", held.id),
      );
      const beforePreview = check(
        await admin
          .from("paper_scan_pages")
          .select("revision,status,readings,decisions")
          .eq("id", held.id)
          .single(),
      );
      const previewResponse = await request(
        `/api/assignments/${assignmentId}/scans?asset=${held.id}&variant=review-preview`,
      );
      assert.equal(previewResponse.status, 200);
      assert.equal(
        previewResponse.headers.get("x-scan-preview"),
        "approximate",
      );
      assert.equal(
        previewResponse.headers.get("cache-control"),
        "private, no-store",
      );
      await tab.reload();
      await tab.getByText(/Approximate crops for visual review only/).waitFor();
      await tab
        .getByRole("button", {
          name: "Enlarge scan for question 1",
          exact: true,
        })
        .first()
        .waitFor();
      await tab
        .getByRole("img", { name: /Scanned answer sheet for/ })
        .waitFor();
      assert.ok(
        await tab
          .getByRole("img", {
            name: "Scanned answer for question 1",
            exact: true,
          })
          .first()
          .isVisible(),
      );
      await tab.screenshot({
        path: join(artifacts, "alignment-review-snippets.png"),
        fullPage: true,
      });
      assert.deepEqual(
        check(
          await admin
            .from("paper_scan_pages")
            .select("revision,status,readings,decisions")
            .eq("id", held.id)
            .single(),
        ),
        beforePreview,
      );
      assert.equal(
        check(
          await admin
            .from("attempts")
            .select("score")
            .eq("id", attemptId)
            .single(),
        ).score,
        null,
      );
      await tab.route(/variant=review-preview/, (route) =>
        route.fulfill({
          status: 422,
          contentType: "application/json",
          body: JSON.stringify({ error: "Cannot place crop" }),
        }),
      );
      await tab.reload();
      await tab
        .getByText(/Individual snippets cannot be positioned reliably/)
        .waitFor();
      const original = tab.getByRole("img", {
        name: /Scanned answer sheet for/,
      });
      await original.waitFor();
      await tab.waitForFunction(() =>
        Array.from(
          document.querySelectorAll('img[alt^="Scanned answer sheet"]'),
        ).some((i) => i.complete && i.naturalWidth > 0),
      );
      assert.ok(await original.isVisible());
      assert.ok(
        await tab.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      );
      console.log(
        "PASS: inline scan snippets, zoom/keyboard navigation, read-only alignment previews, and original-scan fallback without changing grades.",
      );
      console.log(
        "PASS: separate upload/dashboard/student pages, search, confidence for all answers, optional edits recalculate grades, mobile layout and teacher hold protection.",
      );
      await tab.unroute(/variant=review-preview/);
      await tab.setViewportSize({ width: 1440, height: 1000 });
      const target = sheets.find((s) => s.student_name === "Demo Student 4");
      const targetPage = check(await admin.from("paper_scan_pages").select("*").eq("sheet_id", target.id).single());
      await post({ action: "review", pageId: targetPage.id, revision: targetPage.revision, reviewAction: "reopen", decisions: [], note: "Inspection navigation regression" });
      await tab.reload();
      await tab.getByRole("heading", { name: first.student_name, exact: true }).waitFor();
      // Selecting a page must not carry that student's page into the next route.
      await tab.getByRole("button", { name: "Page 1 · Needs attention", exact: true }).click();
      const nextInspection = () => tab.getByRole("link", { name: "Next student needing inspection →", exact: true });
      assert.ok((await nextInspection().getAttribute("href")).endsWith(`/${target.id}`), "skip the two graded students between these pending papers");
      await nextInspection().click();
      await tab.getByRole("heading", { name: target.student_name, exact: true }).waitFor();
      const targetAnswer = printedScanChoice(target.questions[0], keyMap.get(target.questions[0].questionId).correct_answer);
      const select = tab.getByRole("combobox", { name: "Answer for question 1", exact: true });
      await select.selectOption(["A", "B", "C", "D"].find((id) => id !== targetAnswer));
      await select.selectOption(targetAnswer);
      await saveChange();
      assert.ok((await nextInspection().getAttribute("href")).endsWith(`/${first.id}`), "wrap to the remaining pending student after saving");
      await nextInspection().click();
      await tab.getByRole("heading", { name: first.student_name, exact: true }).waitFor();
      for (const slot of first.questions) {
        const reading = held.readings.find((r) => r.position === slot.position);
        await tab.getByRole("combobox", { name: `Answer for question ${slot.position}`, exact: true }).selectOption(reading.choice ?? "blank");
      }
      await saveChange();
      await tab.getByText("No students need inspection.", { exact: true }).waitFor();
      assert.equal(await nextInspection().count(), 0);
      console.log("PASS: inspection navigation skips graded students, opens the correct student's page, wraps within pending reviews, and finishes the queue after real review saves.");

      // The student result view must show the same paper evidence and confirm corrections.
      const resultUrl = `${base}/teacher/assignments/${assignmentId}/attempts/${attemptId}`;
      const scanPage = () => admin.from("paper_scan_pages").select("id,revision,decisions,readings,status").eq("sheet_id", first.id).single().then(check);
      const attemptScore = () => admin.from("attempts").select("score").eq("id", attemptId).single().then(check);
      const responseRows = () => admin.from("responses").select("question_id,student_answer,is_correct,points_awarded").eq("attempt_id", attemptId).order("question_id").then(check);
      const beforeResultPage = await scanPage();
      const beforeResultScore = await attemptScore();
      const beforeResultResponses = await responseRows();
      const firstResponse = beforeResultResponses.find((r) => r.question_id === first.questions[0].questionId);
      await tab.goto(resultUrl);
      await tab.getByRole("heading", { name: "Review each response", exact: true }).waitFor();
      await tab.getByRole("button", { name: "Enlarge scan for question 1", exact: true }).waitFor();
      const resultAnswer = () => tab.getByRole("combobox", { name: "Scanned answer for question 1", exact: true });
      const resultSave = () => tab.getByRole("button", { name: "Save answer change", exact: true });
      const resultCorrect = printedScanChoice(first.questions[0], keyMap.get(first.questions[0].questionId).correct_answer);
      const resultOriginal = firstResponse.student_answer ? printedScanChoice(first.questions[0], firstResponse.student_answer) : "blank";
      assert.equal(await resultAnswer().inputValue(), resultOriginal);
      await tab.getByRole("button", { name: "Enlarge scan for question 1", exact: true }).click();
      await tab.getByRole("dialog", { name: "Scanned answer · Question 1", exact: true }).waitFor();
      await tab.keyboard.press("Escape");
      await tab.getByRole("button", { name: /^Question 2:/ }).click();
      await tab.getByRole("button", { name: "Enlarge scan for question 2", exact: true }).waitFor();
      await tab.getByRole("button", { name: /^Question 1:/ }).click();
      const resultWrong = CHOICES.find((c) => c !== resultCorrect && c !== resultOriginal);
      await resultAnswer().selectOption(resultWrong);
      tab.once("dialog", (dialog) => { assert.match(dialog.message(), /recalculate.*grade/); void dialog.dismiss(); });
      await resultSave().click();
      assert.deepEqual(await scanPage(), beforeResultPage, "cancelling confirmation never saves a correction");
      assert.deepEqual(await responseRows(), beforeResultResponses);

      // Another tab changing the paper must not be overwritten by this view.
      await post({ action: "review", pageId: beforeResultPage.id, revision: beforeResultPage.revision, reviewAction: "accept", decisions: beforeResultPage.decisions, note: "Simulated concurrent teacher review" });
      const concurrentPage = await scanPage();
      tab.once("dialog", (dialog) => void dialog.accept());
      const staleResponse = tab.waitForResponse((r) => r.url().endsWith("/scans") && r.request().method() === "POST");
      await resultSave().click();
      assert.equal((await staleResponse).status(), 409);
      await tab.getByRole("alert").filter({ hasText: "This scan changed" }).waitFor();
      assert.deepEqual(await scanPage(), concurrentPage);
      await tab.getByRole("button", { name: "Reload latest answers", exact: true }).click();
      await tab.waitForLoadState("networkidle");

      const confirmResultChange = async (choice) => {
        await resultAnswer().selectOption(choice);
        tab.once("dialog", (dialog) => void dialog.accept());
        const response = tab.waitForResponse((r) => r.url().endsWith("/scans") && r.request().method() === "POST");
        await resultSave().click();
        assert.equal((await response).status(), 200);
        await tab.getByText("Answer corrected. Grade updated.", { exact: true }).waitFor();
        await resultSave().waitFor({ state: "visible" });
        await tab.waitForFunction(() => {
          const button = [...document.querySelectorAll("button")].find((b) => b.textContent === "Save answer change");
          return button?.disabled;
        });
      };
      await confirmResultChange(resultWrong);
      assert.equal((await attemptScore()).score, beforeResultScore.score - firstResponse.points_awarded);
      const afterWrongResponses = await responseRows();
      const wrongResponse = afterWrongResponses.find((r) => r.question_id === first.questions[0].questionId);
      assert.equal(wrongResponse.student_answer, first.questions[0].optionOrder[CHOICES.indexOf(resultWrong)]);
      assert.deepEqual(afterWrongResponses.filter((r) => r.question_id !== firstResponse.question_id), beforeResultResponses.filter((r) => r.question_id !== firstResponse.question_id));
      await confirmResultChange(resultCorrect);
      assert.equal((await attemptScore()).score, beforeResultScore.score - firstResponse.points_awarded + first.questions[0].points);
      await tab.getByRole("button", { name: "Question 1: Correct", exact: true }).waitFor();
      await confirmResultChange("blank");
      assert.equal((await responseRows()).find((r) => r.question_id === firstResponse.question_id).student_answer, null);
      assert.equal((await attemptScore()).score, beforeResultScore.score - firstResponse.points_awarded);
      await confirmResultChange(resultOriginal);
      assert.deepEqual(await responseRows(), beforeResultResponses);
      assert.deepEqual(await attemptScore(), beforeResultScore);
      const audit = check(await admin.from("paper_scan_audit").select("detail").eq("page_id", beforeResultPage.id).eq("event", "manual_accept"));
      assert.ok(audit.some((event) => event.detail.note.includes("student result view")));
      await tab.screenshot({ path: join(artifacts, "mixed-attempt-scan-desktop.png"), fullPage: true });
      await tab.setViewportSize({ width: 390, height: 844 });
      assert.ok(await tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await tab.screenshot({ path: join(artifacts, "mixed-attempt-scan-mobile.png"), fullPage: true });
      console.log("PASS: mixed student results show shaded scan evidence and confidence; cancelled/stale corrections cannot change grades; confirmed printed choices and blanks update canonical answers, summary and audit without changing other responses.");

      const mixedColumn = check(await admin.from("classroom_grade_columns").select("id,title,week_id").eq("assignment_id", assignmentId).eq("class_id", classId).single());
      const targetAttemptId = workspace.sheets.find((s) => s.id === target.id).attempt_id;
      const pendingMixedPage = check(await admin.from("paper_scan_pages").select("id,revision,decisions,readings").eq("sheet_id", target.id).single());
      await post({ action: "review", pageId: pendingMixedPage.id, revision: pendingMixedPage.revision, reviewAction: "reopen", decisions: [], note: "Missing mixed grade entry regression" });
      check(await admin.from("class_members").update({ nickname: "Missing Mixed Student", nickname_is_custom: true }).eq("class_id", classId).eq("student_id", target.student_id));
      check(await admin.from("classroom_weeks").update({ is_current: true }).eq("id", mixedColumn.week_id));
      await tab.setViewportSize({ width: 1440, height: 1000 });
      await tab.goto(`${base}/teacher/classes/${classId}`);
      const mixedGrade = () => tab.getByRole("spinbutton", { name: `${mixedColumn.title} grade for Missing Mixed Student`, exact: true });
      await mixedGrade().fill("8.5");
      const mixedGradeResponse = tab.waitForResponse((r) => r.url().includes(`/grade-columns/${mixedColumn.id}/grades/`) && r.request().method() === "PUT");
      await mixedGrade().press("Enter");
      assert.equal((await mixedGradeResponse).status(), 200);
      assert.equal(check(await admin.from("classroom_manual_grades").select("score").eq("column_id", mixedColumn.id).eq("student_id", target.student_id).single()).score, 8.5);
      await tab.reload();
      assert.equal(await mixedGrade().inputValue(), "8.5");
      assert.equal(check(await admin.from("attempts").select("status,score").eq("id", targetAttemptId).single()).score, null, "manual class-manager entry does not finalize an uninspected scan");
      await post({ action: "review", pageId: pendingMixedPage.id, revision: pendingMixedPage.revision + 1, reviewAction: "accept", decisions: pendingMixedPage.decisions ?? pendingMixedPage.readings.map((r) => ({ ...r, resolved: true })), note: "Completed mixed scan after manual missing grade" });
      await tab.reload();
      assert.equal(await mixedGrade().count(), 0, "the real graded scan takes precedence over the missing-grade entry");
      assert.ok(await tab.locator(`a[href$='/attempts/${targetAttemptId}']`).count());
      console.log("PASS: missing mixed-exam grade cells accept teacher entries without marking pending scans; completed scan results automatically take precedence.");
    } finally {
      await browser.close();
    }
  }
  console.log(`Artifacts: ${artifacts}`);
} finally {
  if (assignmentId) {
    const pages = check(
      await admin
        .from("paper_scan_pages")
        .select("image_path,normalized_path")
        .eq("assignment_id", assignmentId),
    );
    const batches = check(
      await admin
        .from("paper_scan_batches")
        .select("source_path")
        .eq("assignment_id", assignmentId),
    );
    objects.push(
      ...pages
        .flatMap((p) => [p.image_path, p.normalized_path])
        .filter(Boolean),
      ...batches.map((b) => b.source_path),
    );
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
