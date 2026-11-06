// Optional browser QA after paper-scan-e2e.mjs retains isolated fixtures.
// Reads auth state from a local temporary file; never logs credentials.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { filledPdf, rasterizePdf } from "./paper-scan-fixtures.mjs";

nextEnv.loadEnvConfig(process.cwd());
const statePath = process.env.PAPER_SCAN_FIXTURE_STATE;
if (!statePath)
  throw new Error(
    "Set PAPER_SCAN_FIXTURE_STATE to the isolated test fixture state.",
  );
const state = JSON.parse(await readFile(statePath, "utf8"));
const base = process.env.PAPER_SCAN_BASE_URL ?? "http://localhost:3000";
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const playwright = await import(
  pathToFileURL(
    process.env.PLAYWRIGHT_MODULE ??
      createRequire(import.meta.url).resolve("playwright"),
  ).href
);
const { chromium } = playwright.default ?? playwright;
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
await context.addCookies(
  state.teacherCookie.split("; ").map((part) => {
    const index = part.indexOf("=");
    return {
      name: part.slice(0, index),
      value: part.slice(index + 1),
      url: base,
    };
  }),
);
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
  await page.goto(`${base}/teacher/assignments/new`);
  await page
    .locator('input[name="title"]')
    .fill("Browser Mixed Test - synthetic QA");
  await page.locator('input[name="kind"][value="mixed"]').check();
  await page
    .locator('input[name="class_ids"][type="checkbox"]')
    .first()
    .check();
  const { data: skills, error } = await admin
    .from("skills")
    .select("code")
    .limit(1);
  if (error) throw error;
  const questions = Array.from({ length: 3 }, (_, i) => ({
    prompt: `Browser QA question ${i + 1}`,
    type: "multiple_choice",
    options: ["A", "B", "C", "D"].map((id) => ({ id, text: `Choice ${id}` })),
    correct_answer: ["A", "B", "C"][i],
    difficulty: 2,
    points: 1,
    skills: [{ code: skills[0].code, weight: 1, is_primary: true }],
  }));
  await page
    .getByRole("textbox", { name: "Question import JSON", exact: true })
    .fill(JSON.stringify({ questions }));
  await page
    .getByRole("button", { name: "Validate & preview", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Close question review", exact: true })
    .click();
  await page.getByRole("button", { name: /^Create & publish/ }).click();
  await page.waitForURL(/\/teacher\/assignments\/[a-f0-9-]{36}\?/, {
    timeout: 60000,
  });
  const assignmentId = new URL(page.url()).pathname.split("/").pop();
  state.assignments.push(assignmentId);
  // Update cleanup inventory immediately after the browser creates records.
  const { data: questionRows } = await admin
    .from("assignment_questions")
    .select("question_id")
    .eq("assignment_id", assignmentId);
  state.questionIds.push(...questionRows.map((q) => q.question_id));
  await writeFile(statePath, JSON.stringify(state));
  await page.getByRole("link", { name: /Print sheets & mark papers/ }).click();
  await page
    .getByRole("heading", { name: "Personalized answer sheets", exact: true })
    .waitFor();
  await page.waitForFunction(() =>
    document.body.innerText.includes("Scan Test Student 00"),
  );
  const workspace = await page.evaluate(
    async (id) => (await fetch(`/api/assignments/${id}/scans`)).json(),
    assignmentId,
  );
  const s = workspace.sheets[0];
  const sheet = {
    id: s.id,
    token: s.token,
    studentId: s.student_id,
    studentName: s.student_name,
    studentCode: s.student_code,
    classId: s.class_id,
    className: s.class_name,
    version: s.version,
    questions: s.questions,
  };
  const scan = await rasterizePdf(
    await filledPdf([sheet], (i) => i % 4, { 1: "faint" }),
  );
  await page
    .getByLabel("Upload scanned answer sheets", { exact: true })
    .setInputFiles({
      name: "browser-ambiguous-scan.pdf",
      mimeType: "application/pdf",
      buffer: scan,
    });
  await page.getByText(/Batch finished/).waitFor({ timeout: 120000 });
  await page
    .getByRole("button", { name: "Page 1 · Review", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Question 2: B", exact: true })
    .click();
  await page
    .getByPlaceholder("e.g. Q7: erased B, clearly shaded C")
    .fill("Browser QA: faint B confirmed against original scan");
  await page
    .getByRole("button", { name: "Save review & recalculate", exact: true })
    .click();
  await page.getByText(/Review saved/).waitFor();
  await page.getByText("3 / 3 · 100%", { exact: true }).waitFor();
  await page.locator('img[alt^="Scanned answer sheet"]').waitFor();
  await page.screenshot({
    path: join(dirname(statePath), "marking-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
    true,
    "Mobile page must not overflow horizontally",
  );
  await page.screenshot({
    path: join(dirname(statePath), "marking-mobile.png"),
    fullPage: true,
  });
  const { data: grades } = await admin
    .from("attempts")
    .select("status,score,max_score")
    .eq("assignment_id", assignmentId);
  assert.deepEqual(grades, [{ status: "submitted", score: 3, max_score: 3 }]);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${base}/teacher/classes/${s.class_id}`);
  assert.match(
    await page.textContent("body"),
    /Browser Mixed Test - synthetic QA/,
  );
  assert.deepEqual(errors, []);
  console.log(
    "[scan-browser] PASS: actual JSON form → publish → marking → upload → visual review → 3/3 grade → class manager. Desktop and mobile screenshots saved.",
  );
} finally {
  await browser.close();
}
