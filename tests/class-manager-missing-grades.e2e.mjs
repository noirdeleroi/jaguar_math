// Opt-in verification using isolated synthetic users/classes; always cleaned up.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

if (process.env.RUN_MISSING_GRADES_E2E !== "1") throw new Error("Set RUN_MISSING_GRADES_E2E=1.");
nextEnv.loadEnvConfig(process.cwd());
const base = process.env.PAPER_SCAN_BASE_URL ?? "http://localhost:3100";
const check = (r) => { if (r.error) throw new Error(r.error.message); return r.data; };
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const run = randomUUID().slice(0, 8), users = [], assignments = [], password = randomUUID() + "Aa1!";
const artifacts = join(tmpdir(), `missing-grades-${run}`);
let classId, questionId, browser;
try {
  for (const role of ["teacher", "teacher", "student", "student"]) {
    const user = check(await admin.auth.admin.createUser({ email: `missing-grade-${run}-${users.length}@example.test`, password, email_confirm: true })).user;
    users.push(user);
    check(await admin.from("profiles").update({ role, full_name: `${role} ${run} ${users.length}`, must_change_password: false }).eq("id", user.id));
  }
  const jar = new Map();
  const teacher = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (cs) => cs.forEach((c) => jar.set(c.name, c.value)) } });
  check(await teacher.auth.signInWithPassword({ email: users[0].email, password }));
  classId = check(await teacher.from("classes").insert({ name: `Missing Grades ${run}`, grade_level: 11, academic_year: "2026", teacher_id: users[0].id }).select("id").single()).id;
  check(await teacher.from("class_members").insert([{ class_id: classId, student_id: users[2].id, nickname: "Missing Student", nickname_is_custom: true }, { class_id: classId, student_id: users[3].id, nickname: "Actual Student", nickname_is_custom: true }]));
  const topic = check(await admin.from("classroom_weeks").select("id,label").eq("class_id", classId).order("sort_order").limit(1).single());
  check(await admin.from("classroom_weeks").update({ is_current: true }).eq("id", topic.id));
  questionId = check(await teacher.from("questions").insert({ prompt: "Synthetic grading question", type: "multiple_choice", options: [{ id: "A", text: "One" }, { id: "B", text: "Two" }, { id: "C", text: "Three" }, { id: "D", text: "Four" }], difficulty: 1, created_by: users[0].id }).select("id").single()).id;
  check(await teacher.from("question_keys").insert({ question_id: questionId, correct_answer: "A" }));
  const columns = [];
  for (const kind of ["test", "homework", "paper"]) {
    const assignment = check(await teacher.from("assignments").insert({ title: `Missing ${kind} ${run}`, kind, status: "draft", created_by: users[0].id, include_in_class_manager: true }).select("id,title").single());
    assignments.push(assignment.id);
    check(await teacher.from("assignment_questions").insert({ assignment_id: assignment.id, question_id: questionId, position: 1, points: 20 }));
    check(await teacher.from("assignment_classes").insert({ assignment_id: assignment.id, class_id: classId }));
    check(await teacher.from("assignments").update({ status: "published" }).eq("id", assignment.id));
    const column = check(await admin.from("classroom_grade_columns").select("id,title").eq("assignment_id", assignment.id).eq("class_id", classId).single());
    check(await teacher.from("classroom_grade_columns").update({ week_id: topic.id }).eq("id", column.id));
    columns.push({ ...column, max: 20, assignmentId: assignment.id });
  }
  const manual = check(await teacher.from("classroom_grade_columns").insert({ class_id: classId, week_id: topic.id, title: `Manual ${run}`, source: "manual", max_score: 20, assessment_date: "2026-11-18", created_by: users[0].id }).select("id,title").single());
  columns.push({ ...manual, max: 20 });
  const document = { rubricVersion: 1, teams: [{ id: randomUUID(), name: "Team 1", members: [{ studentId: users[2].id, label: "Missing Student" }], scores: [null, null, null] }], individualScores: { [users[2].id]: [null, null] } };
  const project = check(await teacher.rpc("create_business_poster_project", { p_class_id: classId, p_week_label: topic.label, p_activity_date: "2026-11-18", p_document: document }));
  columns.push({ id: project.column_id, title: "Business Poster Project", max: 100 });
  check(await teacher.from("classroom_weeks").update({ summative_grade_column_id: columns[0].id, final_grade_formula: "N", final_grade_max: 20 }).eq("id", topic.id));

  const pw = await import("file:///" + process.env.PLAYWRIGHT_MODULE.replaceAll("\\", "/"));
  browser = await (pw.default ?? pw).chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addCookies([...jar].map(([name, value]) => ({ name, value, url: base })));
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/teacher/classes/${classId}`);
  const cell = (column) => page.getByRole("spinbutton", { name: `${column.title} grade for Missing Student`, exact: true });
  const gradeUrl = (column, studentId = users[2].id) => `/api/classes/${classId}/grade-columns/${column.id}/grades/${studentId}`;
  const put = async (column, score, studentId) => context.request.put(base + gradeUrl(column, studentId), { data: { score } });
  for (const column of columns) {
    await cell(column).fill("8.5");
    const response = page.waitForResponse((r) => r.url().endsWith(gradeUrl(column)) && r.request().method() === "PUT");
    await cell(column).press("Enter");
    assert.equal((await response).status(), 200);
    assert.equal(check(await admin.from("classroom_manual_grades").select("score").eq("column_id", column.id).eq("student_id", users[2].id).single()).score, 8.5);
  }
  await page.reload();
  for (const column of columns) assert.equal(await cell(column).inputValue(), "8.5");
  const studentJar = new Map();
  const student = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: { getAll: () => [...studentJar].map(([name, value]) => ({ name, value })), setAll: (cs) => cs.forEach((c) => studentJar.set(c.name, c.value)) } });
  check(await student.auth.signInWithPassword({ email: users[2].email, password }));
  const studentContext = await browser.newContext();
  await studentContext.addCookies([...studentJar].map(([name, value]) => ({ name, value, url: base })));
  const studentPage = await studentContext.newPage();
  await studentPage.goto(`${base}/student/records`);
  await studentPage.getByText("8.5 / 20", { exact: true }).waitFor();
  assert.equal(check(await admin.from("attempts").select("id").in("assignment_id", assignments)).length, 0, "do not fabricate student attempts");
  assert.equal((await put(columns[0], 21)).status(), 400);
  assert.equal((await put(columns[0], -1)).status(), 400);
  assert.equal((await put(columns[0], "bad")).status(), 400);
  assert.equal((await put(columns[0], 1, users[1].id)).status(), 404);
  const foreign = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
  check(await foreign.auth.signInWithPassword({ email: users[1].email, password }));
  assert.ok((await foreign.from("classroom_manual_grades").upsert({ column_id: columns[0].id, student_id: users[2].id, score: 10, updated_by: users[1].id })).error, "other teachers cannot change this grade");

  // Escape abandons the draft rather than sending the blur save.
  await cell(columns[0]).fill("12");
  await cell(columns[0]).press("Escape");
  assert.equal(await cell(columns[0]).inputValue(), "8.5");
  assert.equal(check(await admin.from("classroom_manual_grades").select("score").eq("column_id", columns[0].id).eq("student_id", users[2].id).single()).score, 8.5);
  const saveValue = async (value) => {
    await cell(columns[0]).fill(value);
    const response = page.waitForResponse((r) => r.url().endsWith(gradeUrl(columns[0])) && r.request().method() === "PUT");
    await cell(columns[0]).press("Enter");
    assert.equal((await response).status(), 200);
  };
  await saveValue("0");
  await page.reload();
  assert.equal(await cell(columns[0]).inputValue(), "0");
  const clearResponse = page.waitForResponse((r) => r.url().endsWith(gradeUrl(columns[0])) && r.request().method() === "PUT");
  await page.getByRole("button", { name: `Clear ${columns[0].title} grade for Missing Student`, exact: true }).click();
  assert.equal((await clearResponse).status(), 200);
  await page.reload();
  assert.equal(await cell(columns[0]).inputValue(), "");
  await saveValue("15");

  // A newly submitted result supersedes the teacher's missing-grade entry.
  const attempt = check(await admin.from("attempts").insert({ assignment_id: assignments[0], student_id: users[2].id, attempt_number: 1, status: "submitted", score: 18, max_score: 20, submitted_at: new Date().toISOString() }).select("id").single());
  await page.reload();
  assert.equal(await cell(columns[0]).count(), 0);
  assert.ok(await page.locator(`a[href$='/attempts/${attempt.id}']`).count());
  await studentPage.reload();
  await studentPage.getByText("18 / 20", { exact: true }).waitFor();
  assert.equal((await put(columns[0], 19)).status(), 409);
  assert.ok((await teacher.from("classroom_manual_grades").upsert({ column_id: columns[0].id, student_id: users[2].id, score: 19, updated_by: users[0].id })).error, "database also protects submitted results");

  check(await teacher.from("classroom_weeks").update({ summative_grade_column_id: columns[4].id, final_grade_max: 100 }).eq("id", topic.id));
  await studentPage.reload();
  await studentPage.getByText("8.5 / 100", { exact: true }).waitFor();
  const projectDocument = { ...document, teams: [{ ...document.teams[0], scores: [18, 18, 18] }], individualScores: { [users[2].id]: [18, 18] } };
  check(await teacher.rpc("save_business_poster_project", { p_class_id: classId, p_work_item_id: project.work_item_id, p_revision: project.revision, p_document: projectDocument }));
  await page.reload();
  assert.equal(await cell(columns[4]).count(), 0);
  assert.equal((await put(columns[4], 99)).status(), 409);
  await studentPage.reload();
  await studentPage.getByText("90 / 100", { exact: true }).waitFor();
  await mkdir(artifacts, { recursive: true });
  await page.screenshot({ path: join(artifacts, "missing-assessment-grades.png"), fullPage: true });
  assert.deepEqual(errors, []);
  console.log("PASS: missing test/homework/paper/manual/project grades save and persist, zero/decimals/clear/Escape work, score limits and ownership are enforced, and submitted attempts/completed rubrics supersede entries.");
  console.log(`Artifacts: ${artifacts}`);
} finally {
  if (browser) await browser.close();
  if (assignments.length) {
    check(await admin.from("attempts").delete().in("assignment_id", assignments));
    check(await admin.from("assignments").delete().in("id", assignments));
  }
  if (classId) check(await admin.from("classes").delete().eq("id", classId));
  if (questionId) check(await admin.from("questions").delete().eq("id", questionId));
  for (const user of users) check(await admin.auth.admin.deleteUser(user.id));
}
