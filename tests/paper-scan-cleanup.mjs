// Removes only the synthetic IDs recorded by an opt-in integration run.
import { readFile, unlink } from "node:fs/promises";
import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";
nextEnv.loadEnvConfig(process.cwd());
const path = process.env.PAPER_SCAN_FIXTURE_STATE;
if (!path) throw new Error("Set PAPER_SCAN_FIXTURE_STATE.");
const state = JSON.parse(await readFile(path, "utf8"));
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  { auth: { persistSession: false } },
);
const check = (result) => {
  if (result.error) throw new Error(result.error.message);
  return result.data;
};
const profiles = check(
  await db.from("profiles").select("id,email").in("id", state.users),
);
if (
  profiles.some(
    (p) => !/^jaguar-scan-e2e-[a-f0-9]{8}-.+@example\.test$/.test(p.email),
  )
)
  throw new Error("Refusing cleanup: unexpected profile identity.");
for (const id of state.assignments) {
  const batches = check(
    await db
      .from("paper_scan_batches")
      .select("source_path")
      .eq("assignment_id", id),
  );
  for (const batch of batches) {
    const directory = batch.source_path.split("/").slice(0, -1).join("/");
    const objects = check(
      await db.storage.from("paper-scans").list(directory, { limit: 1000 }),
    );
    if (objects.length)
      check(
        await db.storage
          .from("paper-scans")
          .remove(objects.map((o) => `${directory}/${o.name}`)),
      );
  }
  for (const table of [
    "paper_scan_audit",
    "paper_scan_pages",
    "paper_scan_sheets",
    "paper_scan_batches",
    "attempts",
  ])
    check(await db.from(table).delete().eq("assignment_id", id));
  check(await db.from("assignments").delete().eq("id", id));
}
if (state.questionIds.length)
  check(await db.from("questions").delete().in("id", state.questionIds));
for (const id of state.classIds)
  check(await db.from("classes").delete().eq("id", id));
for (const id of state.users) check(await db.auth.admin.deleteUser(id));
await unlink(path);
console.log(
  "[scan-cleanup] Removed synthetic users, classes, assignments, grades, scans and temporary auth state.",
);
