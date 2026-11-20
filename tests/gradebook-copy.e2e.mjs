// Opt-in, read-only audit of real gradebooks. Signs in without sending an email;
// only expands topics and copies columns, never edits students or grades.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

if (process.env.RUN_GRADEBOOK_COPY_E2E !== "1") throw new Error("Set RUN_GRADEBOOK_COPY_E2E=1.");
nextEnv.loadEnvConfig(process.cwd());
const base = process.env.GRADEBOOK_BASE_URL ?? "http://localhost:3100";
const official = JSON.parse(readFileSync(new URL("./fixtures/grade-11-official-rosters.json", import.meta.url), "utf8"));
const check = (result) => { if (result.error) throw new Error(result.error.message); return result.data; };
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const classes = check(await admin.from("classes").select("id,name,teacher_id").in("name", Object.keys(official)).eq("academic_year", "2026-27"));
assert.equal(classes.length, 3);
assert.equal(new Set(classes.map((c) => c.teacher_id)).size, 1);
const teacherUser = check(await admin.auth.admin.getUserById(classes[0].teacher_id)).user;
const link = check(await admin.auth.admin.generateLink({ type: "magiclink", email: teacherUser.email }));
const jar = new Map();
const teacher = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
  cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (cs) => cs.forEach((c) => jar.set(c.name, c.value)) },
});
check(await teacher.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token }));
const pw = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser = await (pw.default ?? pw).chromium.launch({ channel: "chrome", headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1100 }, permissions: ["clipboard-read", "clipboard-write"] });
  await context.addCookies([...jar].map(([name, value]) => ({ name, value, url: base })));
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const classroom of classes.sort((a, b) => a.name.localeCompare(b.name))) {
    const roster = check(await admin.from("class_gradebook_students").select("gradebook_name,sort_order,student_id").eq("class_id", classroom.id).order("sort_order"));
    const members = check(await admin.from("class_members").select("student_id").eq("class_id", classroom.id));
    assert.deepEqual(roster.map((r) => r.gradebook_name), official[classroom.name]);
    assert.deepEqual(roster.map((r) => r.sort_order), roster.map((_, i) => i + 1));
    assert.ok(roster.every((r) => members.some((m) => m.student_id === r.student_id)), "every official row is linked to an enrolled student");
    const topic = check(await admin.from("classroom_weeks").select("final_grade_max,final_grade_formula").eq("class_id", classroom.id).eq("label", "T2").single());
    assert.equal(topic.final_grade_max, 20, "T2 final grade is out of 20");
    assert.equal(topic.final_grade_formula, "2*N+max(stars-skulls,0)");
    const posters = check(await admin.from("classroom_grade_columns").select("id").eq("class_id", classroom.id).eq("source", "project").eq("title", "Business Poster Project"));
    assert.equal(posters.length, 1, "one Business Poster column per class");
    if (classroom.name === "11B Math") {
      assert.equal(posters[0].id, "72f88549-0719-4c6f-af53-0bbcbe87cdf3");
    }
    const initialResults = page.waitForResponse((response) => response.url().includes(`/api/classes/${classroom.id}/assignment-results`));
    await page.goto(`${base}/teacher/classes/${classroom.id}`);
    await initialResults;
    const table = page.locator('table[class*="sheetTable"]:not([aria-hidden="true"])');
    await table.waitFor();
    const expand = table.locator('thead button[aria-expanded="false"]');
    while (await expand.count()) await expand.first().click();
    const t2Final = table.getByRole("button", { name: "Select T2 final grade column", exact: true });
    assert.ok((await t2Final.innerText()).includes("Final grade / 20"));
    const copies = table.locator('thead button[class*="copyColumnButton"]');
    let checked = 0, skipped = 0, decimalColumns = 0, ungradedProjects = 0;
    for (const button of await copies.all()) {
      if (await button.isDisabled()) { skipped++; continue; }
      const column = await button.evaluate((el) => {
        const th = el.closest("th");
        const index = th.cellIndex + 1; // Student header spans both header rows.
        const table = th.closest("table");
        const work = /workStatusCell/.test(table.tBodies[0].rows[0].cells[index].className);
        const project = th.textContent.includes("Project /100");
        return {
          label: th.innerText,
          rows: [...table.tBodies[0].rows].map((row) => {
            const cell = row.cells[index];
            const id = row.querySelector('a[href*="/teacher/students/"]').getAttribute("href").split("/").pop();
            const strong = cell.querySelector("strong")?.textContent ?? "";
            const input = cell.querySelector('input[type="number"]');
            let value;
            if (work) value = /^(Done|OK)$/.test(strong) ? "2" : strong === "Late" ? "1" : "0";
            else if (input) value = input.value || "0";
            else {
              // Summaries/projects put score/max in strong; tests/homework use span.
              const raw = [...cell.querySelectorAll("strong,span")].map((e) => e.textContent).find((t) => /^\d+(?:\.\d+)?\s*\/\s*\d/.test(t));
              value = raw ? raw.split("/")[0].trim() : "0";
            }
            return { id, value: value.replace(".", ","), ungradedProject: project && (!input || !input.value) && !/\d/.test(strong) };
          }),
        };
      });
      const expected = roster.map((r) => column.rows.find((row) => row.id === r.student_id).value).join("\n");
      await button.click();
      await button.filter({ hasText: "Copied" }).waitFor();
      // Windows exposes clipboard line endings as CRLF; textarea paste uses LF.
      const copied = (await page.evaluate(() => navigator.clipboard.readText())).replaceAll("\r\n", "\n");
      assert.equal(copied, expected, `${classroom.name}: ${column.label}`);
      assert.equal(copied.split("\n").length, roster.length);
      assert.ok(copied.split("\n").every((value) => /^\d+(?:,\d+)?$/.test(value)), "only numeric grades, including zero for missing entries");
      // Exercise the browser's native paste event in a scratch textarea.
      await page.evaluate(() => {
        const area = document.createElement("textarea");
        area.id = "gradebook-paste-check";
        area.style.cssText = "position:fixed;top:0;left:0;z-index:99999";
        document.body.append(area);
        area.focus();
      });
      await page.keyboard.press("Control+V");
      assert.equal(await page.locator("#gradebook-paste-check").inputValue(), expected);
      await page.locator("#gradebook-paste-check").evaluate((area) => area.remove());
      if (copied.includes(",")) decimalColumns++;
      ungradedProjects += column.rows.filter((row) => row.ungradedProject).length;
      checked++;
    }
    assert.ok(checked > 0);
    console.log(`PASS ${classroom.name}: T2 /20; ${roster.length} official rows; ${checked} columns copied and natively pasted; ${decimalColumns} decimal columns; ${skipped} unconfigured columns disabled; ${ungradedProjects} ungraded project entries copied as zero.`);
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
  check(await teacher.auth.signOut({ scope: "local" }));
}
