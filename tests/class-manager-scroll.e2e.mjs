// Read-only browser regression against an existing class/project. No grades or teams are edited.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

if (process.env.RUN_LINKED_PROJECT_E2E !== "1") throw new Error("Set RUN_LINKED_PROJECT_E2E=1 to use the linked class for browser verification.");
const require = createRequire(import.meta.url);
const { chromium, expect: baseExpect } = require(process.env.PLAYWRIGHT_MODULE || "@playwright/test");
const expect = baseExpect.configure({ timeout: 10000 });
const baseURL = process.env.PROJECT_TEST_BASE_URL || "http://localhost:3100";
const className = process.env.PROJECT_TEST_CLASS_NAME || "12B Math";
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
function checked(result) { if (result.error) throw new Error(result.error.message); return result.data; }

const classroom = checked(await admin.from("classes").select("id,teacher_id").eq("name", className).single());
const teacher = checked(await admin.from("profiles").select("email").eq("id", classroom.teacher_id).single());
const link = checked(await admin.auth.admin.generateLink({ type: "magiclink", email: teacher.email }));
const cookies = [];
const auth = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: { getAll: () => [], setAll: (values) => cookies.push(...values) } });
checked(await auth.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" }));
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  await context.addCookies(cookies.map((cookie) => ({ name: cookie.name, value: cookie.value, url: baseURL, sameSite: "Lax" })));
  const page = await context.newPage();
  const mutations = [];
  page.on("request", (request) => { if (request.url().includes("/api/classes/") && ["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) mutations.push(request.url()); });
  await page.goto(`${baseURL}/teacher/classes/${classroom.id}`);
  const project = page.getByRole("button", { name: "Open Business Poster Project", exact: true }).first();
  await expect(project).toBeVisible();

  async function expectPageToScroll() {
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).overflowY)).not.toBe("hidden");
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    assert.ok(await page.evaluate(() => document.documentElement.scrollHeight > innerHeight), "The roster must extend below the viewport");
    await page.mouse.move(8, 400);
    await page.mouse.wheel(0, 450);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    await page.evaluate(() => window.scrollTo(0, 0));
  }

  await expectPageToScroll();
  for (const close of ["footer", "button", "escape", "footer", "escape"]) {
    await project.click();
    const dialog = page.getByRole("dialog", { name: "Business Poster Project", exact: true });
    await expect(dialog).toBeVisible();
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).overflowY)).toBe("hidden");
    if (close === "footer") await dialog.getByRole("button", { name: "Close", exact: true }).click();
    else if (close === "button") await dialog.getByRole("button", { name: "Close project", exact: true }).click();
    else await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expectPageToScroll();
    console.log(`PASS: page scrollbar and mouse-wheel scrolling restored after ${close} close`);
  }
  await page.getByRole("button", { name: "＋ HW / CW", exact: true }).click();
  await page.getByRole("button", { name: "Close popup", exact: true }).click();
  await expectPageToScroll();
  await project.click();
  await page.getByRole("dialog", { name: "Business Poster Project", exact: true }).getByRole("button", { name: "Close project", exact: true }).click();
  await expectPageToScroll();
  assert.deepEqual(mutations, []);
  console.log("PASS: switching between HW/CW and project overlays preserves scrolling without editing class data");
} finally {
  await browser.close();
}
