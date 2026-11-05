// Opt-in browser/API verification. Uses existing student IDs in temporary classes,
// creates no student accounts, sends no email, and deletes the test classes afterward.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

if (process.env.RUN_LINKED_PROJECT_E2E !== "1") throw new Error("Set RUN_LINKED_PROJECT_E2E=1 to authorize temporary linked-database test classes.");
const require = createRequire(import.meta.url);
const { chromium, expect: baseExpect } = require(process.env.PLAYWRIGHT_MODULE || "@playwright/test");
const expect = baseExpect.configure({ timeout: 20000 });
const baseURL = process.env.PROJECT_TEST_BASE_URL || "http://localhost:3100";
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const fixtures = [];
let browser;
function checked(result) { if (result.error) throw new Error(result.error.message); return result.data; }

async function fixture(sourceName) {
  const source = checked(await admin.from("classes").select("id,teacher_id,grade_level,academic_year").eq("name", sourceName).single());
  const members = checked(await admin.from("class_members").select("student_id,nickname,nickname_is_custom").eq("class_id", source.id));
  const id = randomUUID();
  checked(await admin.from("classes").insert({ id, name: `Poster verification ${randomUUID()}`, teacher_id: source.teacher_id, grade_level: source.grade_level, academic_year: source.academic_year }));
  fixtures.push(id);
  checked(await admin.from("class_members").insert(members.map((member) => ({ ...member, class_id: id }))));
  return { id, teacherId: source.teacher_id, members };
}

try {
  const first = await fixture("12B Math");
  const second = await fixture("12A Math");
  const teacher = checked(await admin.from("profiles").select("email").eq("id", first.teacherId).single());
  // generateLink returns a token without sending a message to the teacher.
  const link = checked(await admin.auth.admin.generateLink({ type: "magiclink", email: teacher.email }));
  const sessionCookies = [];
  const sessionClient = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: { getAll: () => [], setAll: (cookies) => sessionCookies.push(...cookies) },
  });
  checked(await sessionClient.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" }));
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await context.addCookies(sessionCookies.map((cookie) => ({ name: cookie.name, value: cookie.value, url: baseURL, sameSite: "Lax" })));
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(`${baseURL}/teacher/classes/${first.id}`);
  await page.getByRole("button", { name: "＋ HW / CW", exact: true }).click();
  await page.getByLabel("Work type", { exact: true }).selectOption("project");
  await page.getByRole("button", { name: /^Add to T/ }).click();
  const dialog = page.getByRole("dialog", { name: "Business Poster Project", exact: true });
  await expect(dialog.getByText("1 unresolved student.", { exact: false })).toBeVisible();
  let row = checked(await admin.from("classroom_projects").select("work_item_id,column_id,revision,document").eq("class_id", first.id).single());
  assert.equal(row.document.teams.flatMap((team) => team.members).filter((member) => member.studentId).length, 19);
  assert.equal(row.document.teams[4].members[0].label, "Luciana Duque");
  console.log("PASS: +HW/CW project creation and 19 confident existing-roster matches");

  await dialog.getByRole("button", { name: "Edit teams", exact: true }).click();
  const angelina = checked(await admin.from("profiles").select("id").in("id", first.members.map((member) => member.student_id)).ilike("full_name", "Angelina%").single());
  await dialog.getByLabel("Group 5 member 2", { exact: true }).selectOption(angelina.id);
  await dialog.getByRole("button", { name: "Grade Project", exact: true }).click();
  const groupComment = "Strong business idea.\nExplain the intersection more clearly.";
  await dialog.locator("summary").filter({ hasText: /^Team comment/ }).click();
  await dialog.getByLabel("Group 1 team comment", { exact: true }).fill(groupComment);
  await dialog.getByRole("button", { name: "Group 2", exact: true }).click();
  await expect(dialog.getByLabel("Group 2 team comment", { exact: true })).toHaveValue("");
  await dialog.getByLabel("Group 2 team comment", { exact: true }).fill("Use larger graph labels.");
  await dialog.getByRole("button", { name: "Group 1", exact: true }).click();
  await expect(dialog.getByLabel("Group 1 team comment", { exact: true })).toHaveValue(groupComment);
  await dialog.locator("summary").filter({ hasText: /^Team comment/ }).click();
  const teamLabels = ["Mathematical Correctness & Completeness", "Mathematical Presentation", "Creativity & Poster Presentation"];
  for (const [index, score] of [18, 17, 19].entries()) await dialog.getByLabel(`Group 1 ${teamLabels[index]}`, { exact: true }).fill(String(score));
  await expect(dialog.getByText("Team subtotal: 54/60", { exact: true })).toBeVisible();
  const names = ["Samantha Tirado Rincón", "Samuel Andrés López Cortés", "Lorenzo González", "Tomás Castaño Romero"];
  const personal = [[20, 20], [15, 18], [12, 14], [18, 16]];
  for (const [index, name] of names.entries()) {
    await dialog.getByLabel(`${name} Understanding`, { exact: true }).fill(String(personal[index][0]));
    await dialog.getByLabel(`${name} Participation`, { exact: true }).fill(String(personal[index][1]));
    await expect(dialog.getByLabel(`${name} final grade`, { exact: true })).toHaveText(`${[94, 87, 80, 88][index]}/100`);
  }
  await dialog.getByRole("button", { name: "Group 2", exact: true }).click();
  await dialog.getByRole("button", { name: "Group 1", exact: true }).click();
  await expect(dialog.getByLabel(`Group 1 ${teamLabels[0]}`, { exact: true })).toHaveValue("18");
  await dialog.getByRole("button", { name: "Save project grades", exact: true }).click();
  await expect(dialog.getByText("Saved. Completed individual grades are now in Class Manager.", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).overflowY)).not.toBe("hidden");
  for (const index of names.keys()) await expect(page.getByRole("button", { name: `Business Poster Project grade for ${first.members.find((member) => member.student_id === row.document.teams[0].members[index].studentId).nickname}`, exact: true }).first()).toContainText(`${[94, 87, 80, 88][index]}/100`);
  console.log("PASS: shared team scores, different individual totals, unsaved group navigation, and Class Manager propagation");

  await page.reload();
  await page.getByRole("button", { name: "Open Business Poster Project", exact: true }).first().click();
  await dialog.getByRole("button", { name: "Grade Project", exact: true }).click();
  await expect(dialog.getByLabel(`${names[0]} final grade`, { exact: true })).toHaveText("94/100");
  await dialog.locator("summary").filter({ hasText: /^Team comment/ }).click();
  await expect(dialog.getByLabel("Group 1 team comment", { exact: true })).toHaveValue(groupComment);
  await dialog.getByRole("button", { name: "Group 2", exact: true }).click();
  await expect(dialog.getByLabel("Group 2 team comment", { exact: true })).toHaveValue("Use larger graph labels.");
  await dialog.getByRole("button", { name: "Group 1", exact: true }).click();
  await dialog.locator("summary").filter({ hasText: /^Team comment/ }).click();
  console.log("PASS: separate team comments survive group navigation, saving, and reopening without changing grades");
  await dialog.getByLabel(`Group 1 ${teamLabels[0]}`, { exact: true }).fill("20");
  for (const [index, name] of names.entries()) await expect(dialog.getByLabel(`${name} final grade`, { exact: true })).toHaveText(`${[96, 89, 82, 90][index]}/100`);
  await dialog.getByLabel(`${names[0]} Understanding`, { exact: true }).fill("10");
  await expect(dialog.getByLabel(`${names[0]} final grade`, { exact: true })).toHaveText("86/100");
  await expect(dialog.getByLabel(`${names[1]} final grade`, { exact: true })).toHaveText("89/100");
  await dialog.getByLabel(`${names[0]} Understanding`, { exact: true }).fill("");
  await expect(dialog.getByLabel(`${names[0]} final grade`, { exact: true })).toHaveText("Ungraded");
  await dialog.getByLabel(`${names[0]} Understanding`, { exact: true }).fill("0");
  await expect(dialog.getByLabel(`${names[0]} final grade`, { exact: true })).toHaveText("76/100");
  await dialog.getByLabel(`Group 1 ${teamLabels[0]}`, { exact: true }).fill("21");
  assert.ok(Number(await dialog.getByLabel(`Group 1 ${teamLabels[0]}`, { exact: true }).inputValue()) <= 20);
  await dialog.getByLabel(`Group 1 ${teamLabels[0]}`, { exact: true }).fill("20");
  await dialog.getByRole("button", { name: "Save project grades", exact: true }).click();
  await expect(dialog.getByText("Saved. Completed individual grades are now in Class Manager.", { exact: true })).toBeVisible();
  console.log("PASS: reopening restores data; shared/individual edits, zero, blank, and score boundaries");

  row = checked(await admin.from("classroom_projects").select("work_item_id,column_id,revision,document").eq("class_id", first.id).single());
  const payload = { revision: row.revision, document: row.document };
  const crossRead = await context.request.get(`${baseURL}/api/classes/${second.id}/projects/${row.work_item_id}`);
  const crossWrite = await context.request.put(`${baseURL}/api/classes/${second.id}/projects/${row.work_item_id}`, { data: payload });
  assert.equal(crossRead.status(), 404);
  assert.equal(crossWrite.status(), 400); // Its roster cannot validate first class members.
  const stale = await context.request.put(`${baseURL}/api/classes/${first.id}/projects/${row.work_item_id}`, { data: { ...payload, revision: row.revision - 1 } });
  assert.equal(stale.status(), 409, await stale.text());
  const invalid = structuredClone(payload); invalid.document.teams[0].scores[0] = 21;
  assert.equal((await context.request.put(`${baseURL}/api/classes/${first.id}/projects/${row.work_item_id}`, { data: invalid })).status(), 400);
  assert.equal((await context.request.put(`${baseURL}/api/classes/${first.id}/grade-columns/${row.column_id}/grades/${row.document.teams[0].members[0].studentId}`, { data: { score: 99 } })).status(), 400);
  console.log("PASS: live API class isolation, stale saves, range validation, and rejection of conflicting manual project grades");

  // Delay a save to verify that rapid edits are captured together and locked during persistence.
  await dialog.getByLabel(`${names[0]} Understanding`, { exact: true }).fill("11");
  await dialog.getByLabel(`${names[0]} Participation`, { exact: true }).fill("12");
  let releaseSave;
  const gate = new Promise((resolve) => { releaseSave = resolve; });
  await page.route(`**/api/classes/${first.id}/projects/${row.work_item_id}`, async (route) => {
    if (route.request().method() === "PUT") await gate;
    await route.continue();
  });
  await dialog.getByRole("button", { name: "Save project grades", exact: true }).click();
  await expect(dialog.getByLabel(`${names[0]} Understanding`, { exact: true })).toBeDisabled();
  releaseSave();
  await expect(dialog.getByText("Saved. Completed individual grades are now in Class Manager.", { exact: true })).toBeVisible();
  await page.unroute(`**/api/classes/${first.id}/projects/${row.work_item_id}`);
  const stored = checked(await admin.from("classroom_projects").select("document").eq("class_id", first.id).single());
  assert.deepEqual(stored.document.individualScores[row.document.teams[0].members[0].studentId], [11, 12]);
  console.log("PASS: rapid individual edits persist together and inputs lock during a save");

  const latest = checked(await admin.from("classroom_projects").select("revision,document").eq("class_id", first.id).single());
  assert.equal((await context.request.put(`${baseURL}/api/classes/${first.id}/projects/${row.work_item_id}`, { data: latest })).status(), 200);
  await dialog.getByLabel(`${names[0]} Understanding`, { exact: true }).fill("13");
  await dialog.getByRole("button", { name: "Save project grades", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("changed in another session");
  await expect(dialog.getByRole("button", { name: "Save project grades", exact: true })).toBeDisabled();
  page.once("dialog", (confirmation) => confirmation.accept());
  await dialog.getByRole("button", { name: "Reload saved project", exact: true }).click();
  await expect(dialog.getByLabel(`${names[0]} Understanding`, { exact: true })).toHaveValue("11");
  await expect(dialog.getByLabel(`${names[0]} final grade`, { exact: true })).toHaveText("79/100");
  console.log("PASS: concurrent-session conflict feedback protects saved scores and reload restores the current revision");

  await page.setViewportSize({ width: 1366, height: 768 });
  const lastStudentRow = await dialog.getByLabel(`${names[3]} final grade`, { exact: true }).boundingBox();
  const saveFooter = await dialog.locator("footer").boundingBox();
  assert.ok(lastStudentRow && saveFooter && lastStudentRow.y + lastStudentRow.height < saveFooter.y, "All four students must fit above the save controls on a laptop");
  if (process.env.PROJECT_TEST_SCREENSHOT) await page.screenshot({ path: process.env.PROJECT_TEST_SCREENSHOT.replace(/\.png$/, "-laptop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  const bounds = await dialog.boundingBox();
  assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 391);
  await expect(dialog.getByRole("button", { name: "Save project grades", exact: true })).toBeVisible();
  if (process.env.PROJECT_TEST_SCREENSHOT) await page.screenshot({ path: process.env.PROJECT_TEST_SCREENSHOT });
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await page.setViewportSize({ width: 1366, height: 900 });

  // Exercise the existing creation/status sync workflow through the same +HW/CW control.
  for (const kind of ["homework", "classwork"]) {
    await page.getByRole("button", { name: "＋ HW / CW", exact: true }).click();
    await page.getByLabel("Work type", { exact: true }).selectOption(kind);
    await page.getByLabel("Work title", { exact: true }).fill(`Regression ${kind}`);
    await page.getByRole("button", { name: /^Add to T/ }).click();
    await expect.poll(async () => checked(await admin.from("classroom_work_items").select("id").eq("class_id", first.id).eq("title", `Regression ${kind}`)).length).toBe(1);
  }
  const work = checked(await admin.from("classroom_work_items").select("id").eq("class_id", first.id).eq("title", "Regression homework").single());
  const statusButton = page.getByRole("button", { name: "Edit Regression homework column", exact: true }).first();
  await expect(statusButton).toBeVisible();
  assert.equal(checked(await admin.from("classroom_work_statuses").select("student_id").eq("work_item_id", work.id)).length, first.members.length);
  await page.getByRole("button", { name: "＋ Test / grade", exact: true }).click();
  await page.getByLabel("Test name", { exact: true }).fill("Regression manual grade");
  await page.getByLabel("Maximum score", { exact: true }).fill("20");
  await page.getByRole("button", { name: "Add test", exact: true }).click();
  const gradeInput = page.getByLabel("Regression manual grade grade for Samantha", { exact: true }).first();
  await gradeInput.fill("17"); await gradeInput.press("Tab");
  const manualColumn = checked(await admin.from("classroom_grade_columns").select("id").eq("class_id", first.id).eq("title", "Regression manual grade").single());
  await expect.poll(async () => checked(await admin.from("classroom_manual_grades").select("score").eq("column_id", manualColumn.id))[0]?.score).toBe(17);
  const otherWeek = checked(await admin.from("classroom_weeks").select("label").eq("class_id", second.id).order("sort_order").limit(1).single());
  const otherCreated = await context.request.post(`${baseURL}/api/classes/${second.id}/projects`, { data: { weekLabel: otherWeek.label, activityDate: "2026-11-04", useSuppliedTeams: true } });
  assert.equal(otherCreated.status(), 200);
  assert.deepEqual((await otherCreated.json()).project.document.teams, []);
  await page.getByRole("button", { name: "Open Business Poster Project", exact: true }).first().click();
  await dialog.getByRole("button", { name: "Grade Project", exact: true }).click();
  await expect(dialog.getByLabel(`${names[0]} final grade`, { exact: true })).toHaveText("79/100");
  console.log("PASS: mobile dialog, existing HW/CW and manual grading, other-class empty teams, saved grades preserved");
  await dialog.getByRole("button", { name: "Group 2", exact: true }).click();
  await dialog.locator("summary").filter({ hasText: /^Team comment/ }).click();
  await dialog.getByLabel("Group 2 team comment", { exact: true }).fill("");
  await dialog.getByRole("button", { name: "Save project grades", exact: true }).click();
  await expect(dialog.getByText("Saved. Completed individual grades are now in Class Manager.", { exact: true })).toBeVisible();
  const commentsSaved = checked(await admin.from("classroom_projects").select("document").eq("class_id", first.id).single());
  assert.equal(commentsSaved.document.teams[0].comment, groupComment);
  assert.equal(commentsSaved.document.teams[1].comment, "");
  console.log("PASS: clearing one team's comment preserves the other team's comment and all scores");
  assert.deepEqual(pageErrors, []);
  console.log("PASS: no browser runtime errors");
} finally {
  await browser?.close();
  for (const id of fixtures.reverse()) checked(await admin.from("classes").delete().eq("id", id));
  console.log("Temporary verification classes removed.");
}
