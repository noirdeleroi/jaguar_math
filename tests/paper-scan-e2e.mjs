// Opt-in integration test against a running build and its configured Supabase.
// Creates isolated synthetic teacher/student accounts, then removes its records.
// Never uses a real roster, assignment, or grade. No credentials are logged.
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { PDFDocument } from "pdf-lib";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  filledPdf,
  fixtureSheet,
  rasterizePdf,
} from "./paper-scan-fixtures.mjs";

if (process.env.RUN_PAPER_SCAN_E2E !== "1")
  throw new Error(
    "Set RUN_PAPER_SCAN_E2E=1 to run the isolated integration test.",
  );
nextEnv.loadEnvConfig(process.cwd());
const base = process.env.PAPER_SCAN_BASE_URL ?? "http://localhost:3000";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const runId = randomUUID().slice(0, 8);
const password = randomUUID() + "Aa1!";
const users = [];
const assignments = [];
const classIds = [];
const questionIds = new Set();
const artifacts = join(tmpdir(), `jaguar-paper-scan-${runId}`);
let teacher;
let outsider;
let student;
let workspace;
let assignmentId;
let succeeded = false;
const check = (result, label) => {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
};
const log = (message) => console.log(`[scan-e2e] ${message}`);
async function makeUser(index, role = "student") {
  const email = `jaguar-scan-e2e-${runId}-${index}@example.test`;
  const data = check(
    await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: `Scan Test Student ${String(index).padStart(2, "0")}`,
      },
    }),
    "Create synthetic account",
  );
  const id = data.user.id;
  users.push(id);
  check(
    await admin
      .from("profiles")
      .update({
        role,
        full_name:
          role === "teacher"
            ? "Isolated Scan Test Teacher"
            : `Scan Test Student ${String(index).padStart(2, "0")}`,
        must_change_password: false,
      })
      .eq("id", id),
    "Configure test profile",
  );
  return { id, email };
}
async function session(user) {
  const jar = new Map();
  const client = createServerClient(url, key, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => cookies.forEach((c) => jar.set(c.name, c.value)),
    },
  });
  check(
    await client.auth.signInWithPassword({ email: user.email, password }),
    "Sign in test account",
  );
  return {
    client,
    cookie: () =>
      [...jar].map(([name, value]) => `${name}=${value}`).join("; "),
  };
}
async function request(path, body, auth = teacher) {
  return fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: {
      Cookie: auth?.cookie() ?? "",
      Origin: base,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    redirect: "manual",
  });
}
const api = (id = assignmentId) => `/api/assignments/${id}/scans`;
async function post(body, id = assignmentId) {
  const response = await request(api(id), body);
  const value = await response.json();
  assert.equal(
    response.status,
    200,
    JSON.stringify({
      action: body.action,
      status: response.status,
      error: value.error,
    }),
  );
  return value;
}
async function getWorkspace(id = assignmentId) {
  const response = await request(api(id));
  const value = await response.json();
  assert.equal(response.status, 200, value.error);
  return value;
}
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
async function createAssessment(count = 12, versions = 2) {
  const skill = check(
    await teacher.client.from("skills").select("code").limit(1),
    "Read test skill",
  )[0].code;
  const groups = Array.from({ length: count }, (_, i) =>
    Array.from({ length: versions }, (_, v) => ({
      prompt: `Synthetic question ${i + 1}, version ${v + 1}. Select the stated answer.`,
      type: "multiple_choice",
      options: ["A", "B", "C", "D"].map((id) => ({ id, text: `Option ${id}` })),
      correct_answer: ["A", "B", "C", "D"][(i + v) % 4],
      difficulty: 2,
      points: 1,
      numeric_tolerance: 0,
      skills: [{ code: skill, weight: 1, is_primary: true }],
    })),
  );
  const id = check(
    await teacher.client.rpc("create_paper_assignment_draft_ready", {
      p_title: `Scan E2E ${runId} - ${count} questions`,
      p_description:
        "Synthetic integration fixture; never a real student grade.",
      p_kind: "paper",
      p_due_at: null,
      p_duration_minutes: 60,
      p_max_attempts: 1,
      p_show_score_after_submit: false,
      p_show_answers_after_submit: false,
      p_shuffle_questions: false,
      p_shuffle_options: false,
      p_class_ids: classIds,
      p_questions: groups,
      p_exam_mode: false,
      p_exam_require_fullscreen: false,
      p_exam_track_focus_exits: false,
      p_exam_allowed_focus_exits: 0,
      p_exam_violation_action: "warn",
      p_question_display_mode: "all_at_once",
      p_show_feedback_after_each_question: false,
    }),
    "Import JSON question versions",
  );
  assignments.push(id);
  const ids = check(
    await admin
      .from("assignment_questions")
      .select("question_id")
      .eq("assignment_id", id),
    "Read fixture questions",
  );
  ids.forEach((q) => questionIds.add(q.question_id));
  const variants = check(
    await admin
      .from("assignment_question_variants")
      .select("question_id")
      .eq("assignment_id", id),
    "Read fixture variants",
  );
  variants.forEach((q) => questionIds.add(q.question_id));
  check(
    await teacher.client
      .from("assignments")
      .update({ paper_scan_enabled: true, include_in_class_manager: true })
      .eq("id", id),
    "Select Mixed Test mode",
  );
  // Exercise the transactional draft settings path before locking the paper.
  check(
    await teacher.client.rpc("update_owned_mixed_draft", {
      p_assignment_id: id,
      p_settings: {
        title: `Scan E2E ${runId} - ${count} questions`,
        description: "Isolated fixture",
        kind: "paper",
        paper_scan_enabled: true,
        due_at: null,
        duration_minutes: 60,
        paper_answer_duration_seconds: 90,
        max_attempts: 1,
        show_score_after_submit: false,
        show_answers_after_submit: false,
        shuffle_questions: false,
        shuffle_options: false,
        class_ids: classIds,
        exam_mode: false,
        exam_require_fullscreen: false,
        exam_track_focus_exits: false,
        exam_allowed_focus_exits: 0,
        exam_violation_action: "warn",
        question_display_mode: "all_at_once",
        show_feedback_after_each_question: false,
        include_in_class_manager: true,
        allow_graphing_calculator: false,
        teacher_controlled_question_release: true,
      },
    }),
    "Update Mixed Test draft",
  );
  check(
    await teacher.client.rpc("publish_owned_assignment", {
      p_assignment_id: id,
    }),
    "Publish Mixed Test",
  );
  return id;
}
async function upload(
  bytes,
  name,
  id = assignmentId,
  mime = "application/pdf",
) {
  const registered = await post(
    {
      action: "register",
      name,
      size: bytes.length,
      hash: createHash("sha256").update(bytes).digest("hex"),
      mime,
    },
    id,
  );
  if (registered.uploadUrl) {
    const response = await fetch(registered.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": mime, "x-upsert": "false" },
      body: bytes,
    });
    assert.equal(
      response.ok,
      true,
      `Private storage upload ${response.status}: ${await response.text()}`,
    );
    await post({ action: "uploaded", batchId: registered.batchId }, id);
  }
  return registered;
}
async function finish(batchId, id = assignmentId) {
  let result;
  do {
    result = await post({ action: "process", batchId }, id);
    if (result.processed % 10 === 0)
      log(`Processed ${result.processed}/${result.total} pages`);
  } while (!result.done);
}
function correctIndex(index, sheet) {
  return (index + sheet.version - 1) % 4;
}
async function cleanup() {
  log("Removing isolated fixtures and private scan files");
  const failures = [];
  for (const id of assignments) {
    const batches = check(
      await admin
        .from("paper_scan_batches")
        .select("source_path")
        .eq("assignment_id", id),
      "Find test storage",
    );
    for (const b of batches) {
      const directory = b.source_path.split("/").slice(0, -1).join("/");
      const objects = check(
        await admin.storage
          .from("paper-scans")
          .list(directory, { limit: 1000 }),
        "List test scan files",
      );
      if (objects.length)
        check(
          await admin.storage
            .from("paper-scans")
            .remove(objects.map((o) => `${directory}/${o.name}`)),
          "Remove test scans",
        );
    }
    for (const table of [
      "paper_scan_audit",
      "paper_scan_pages",
      "paper_scan_sheets",
      "paper_scan_batches",
      "attempts",
    ]) {
      const result = await admin.from(table).delete().eq("assignment_id", id);
      if (result.error) failures.push(`${table}: ${result.error.message}`);
    }
    const result = await admin.from("assignments").delete().eq("id", id);
    if (result.error) failures.push(`assignment: ${result.error.message}`);
  }
  if (questionIds.size) {
    const result = await admin
      .from("questions")
      .delete()
      .in("id", [...questionIds]);
    if (result.error) failures.push(`questions: ${result.error.message}`);
  }
  for (const id of classIds) {
    const result = await admin.from("classes").delete().eq("id", id);
    if (result.error) failures.push(`class: ${result.error.message}`);
  }
  for (const id of users) {
    const result = await admin.auth.admin.deleteUser(id);
    if (result.error) failures.push(`test account: ${result.error.message}`);
  }
  if (failures.length)
    throw new Error(`Fixture cleanup failed: ${failures.join("; ")}`);
}
try {
  await mkdir(artifacts, { recursive: true });
  log(
    "Creating isolated teacher and 50 synthetic students across five classes",
  );
  teacher = await session(await makeUser("teacher", "teacher"));
  outsider = await session(await makeUser("outsider", "teacher"));
  const students = [];
  for (let i = 0; i < 50; i += 5)
    students.push(
      ...(await Promise.all(
        Array.from({ length: Math.min(5, 50 - i) }, (_, j) => makeUser(i + j)),
      )),
    );
  student = await session(students[0]);
  const owner = check(await teacher.client.auth.getUser(), "Read test identity")
    .user.id;
  for (let i = 0; i < 5; i++) {
    const classroom = check(
      await teacher.client
        .from("classes")
        .insert({
          teacher_id: owner,
          name: `OMR E2E ${["11A", "11B", "11C", "12A", "12B"][i]} ${runId}`,
          grade_level: i < 3 ? 11 : 12,
          academic_year: "2026",
        })
        .select("id")
        .single(),
      "Create isolated class",
    );
    classIds.push(classroom.id);
    check(
      await teacher.client
        .from("class_members")
        .insert(
          students
            .slice(i * 10, (i + 1) * 10)
            .map((s) => ({ class_id: classroom.id, student_id: s.id })),
        ),
      "Attach test roster",
    );
  }
  assignmentId = await createAssessment();
  workspace = await getWorkspace();
  assert.equal(workspace.sheets.length, 50);
  assert.equal(workspace.grades.length, 0);
  assert.equal(
    check(
      await teacher.client
        .from("classroom_grade_columns")
        .select("id")
        .eq("assignment_id", assignmentId),
      "Gradebook columns",
    ).length,
    5,
  );
  for (const [suffix, count] of [
    ["", 50],
    [`?classId=${classIds[0]}`, 10],
    [`?studentId=${students[0].id}`, 1],
  ]) {
    const response = await request(
      `/api/assignments/${assignmentId}/answer-sheets.pdf${suffix}`,
    );
    assert.equal(response.status, 200);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal((await PDFDocument.load(bytes)).getPageCount(), count);
    if (!suffix)
      await writeFile(join(artifacts, "sample-personalized-sheets.pdf"), bytes);
  }
  const questionPaper = await request(
    `/api/assignments/${assignmentId}/answer-key.pdf?questionsOnly=1`,
  );
  assert.equal(questionPaper.status, 200);
  await writeFile(
    join(artifacts, "student-question-papers.pdf"),
    Buffer.from(await questionPaper.arrayBuffer()),
  );
  log(
    "Confirmed print scopes, JSON versions, five gradebook columns and 50 pending grades",
  );
  assert.equal((await request(api(), null, outsider)).status, 404);
  assert.equal((await request(api(), null, student)).status, 403);
  assert.equal(
    check(
      await student.client.from("paper_scan_sheets").select("id"),
      "Student RLS",
    ).length,
    0,
  );
  assert.ok(
    (
      await student.client.rpc("review_scan_page", {
        p_page_id: randomUUID(),
        p_teacher_id: owner,
        p_revision: 1,
        p_action: "reject",
        p_decisions: [],
        p_note: "Forbidden",
      })
    ).error,
  );
  assert.ok(
    (
      await student.client.rpc("start_my_paper_attempt", {
        p_assignment_id: assignmentId,
        p_version: 1,
      })
    ).error,
  );
  const sheets = workspace.sheets.map(asSheet);
  const single = await filledPdf([sheets[0]], correctIndex);
  const first = await upload(single, "single-student.pdf");
  await finish(first.batchId);
  workspace = await getWorkspace();
  assert.equal(
    workspace.grades.filter((g) => g.status === "submitted").length,
    1,
  );
  assert.equal(workspace.grades[0].score, 12);
  log("One uploaded paper graded; 49 students still pending");
  const partial = await filledPdf(sheets.slice(1, 12), correctIndex, {
    2: "faint",
  });
  const second = await upload(partial, "partial-classes.pdf");
  // All partial sheets carry one ambiguous answer, preserving partial grading.
  await post({ action: "process", batchId: second.batchId });
  const saved = check(
    await admin
      .from("paper_scan_batches")
      .select("next_page,status")
      .eq("id", second.batchId)
      .single(),
    "Saved batch cursor",
  );
  assert.equal(saved.next_page, 2);
  const claimed = check(
    await admin.rpc("claim_scan_batch", {
      p_batch_id: second.batchId,
      p_teacher_id: owner,
    }),
    "Claim interrupted worker",
  );
  assert.ok(claimed.lease);
  assert.equal(
    (await request(api(), { action: "process", batchId: second.batchId }))
      .status,
    409,
  );
  check(
    await admin
      .from("paper_scan_batches")
      .update({ lease_until: new Date(Date.now() - 1000).toISOString() })
      .eq("id", second.batchId),
    "Simulate expired processing lease",
  );
  await finish(second.batchId);
  workspace = await getWorkspace();
  assert.equal(
    workspace.grades.filter((g) => g.status === "submitted").length,
    1,
  );
  assert.equal(workspace.pages.filter((p) => p.status === "review").length, 11);
  const flagged = workspace.pages.find((p) => p.status === "review");
  const flaggedSheet = sheets.find((s) => s.id === flagged.sheet_id);
  const decisions = flagged.readings.map((r) => ({
    ...r,
    choice: ["A", "B", "C", "D"][correctIndex(r.position - 1, flaggedSheet)],
    status: "clear",
    resolved: true,
  }));
  await post({
    action: "review",
    pageId: flagged.id,
    revision: flagged.revision,
    reviewAction: "accept",
    decisions,
    note: "Synthetic faint mark confirmed against original",
  });
  assert.equal(
    (
      await request(api(), {
        action: "review",
        pageId: flagged.id,
        revision: flagged.revision,
        reviewAction: "accept",
        decisions,
        note: "Stale review must fail",
      })
    ).status,
    409,
  );
  workspace = await getWorkspace();
  assert.equal(
    workspace.grades.filter((g) => g.status === "submitted").length,
    2,
  );
  log(
    "Interrupted upload resumed; uncertain marks withheld; manual review finalized one student atomically",
  );
  const full = await rasterizePdf(
    await filledPdf(sheets, (i, s) =>
      i === 0 ? (correctIndex(i, s) + 1) % 4 : correctIndex(i, s),
    ),
  );
  await writeFile(join(artifacts, "synthetic-50-page-scans.pdf"), full);
  const batch50 = await upload(full, "fifty-students-five-classes.pdf");
  const races = await Promise.all([
    request(api(), { action: "process", batchId: batch50.batchId }),
    request(api(), { action: "process", batchId: batch50.batchId }),
  ]);
  assert.deepEqual(races.map((r) => r.status).sort(), [200, 409]);
  await finish(batch50.batchId);
  workspace = await getWorkspace();
  assert.equal(
    workspace.pages.filter((p) => p.status === "duplicate").length,
    12,
  );
  assert.equal(
    workspace.grades.filter((g) => g.status === "submitted").length,
    40,
  );
  for (const page of workspace.pages.filter((p) => p.status === "review")) {
    const s = sheets.find((s) => s.id === page.sheet_id);
    const decisions = page.readings.map((r) => ({
      ...r,
      choice: ["A", "B", "C", "D"][correctIndex(r.position - 1, s)],
      status: "clear",
      resolved: true,
    }));
    await post({
      action: "review",
      pageId: page.id,
      revision: page.revision,
      reviewAction: "accept",
      decisions,
      note: "Synthetic ambiguity resolved",
    });
  }
  workspace = await getWorkspace();
  assert.equal(
    workspace.grades.filter((g) => g.status === "submitted").length,
    50,
  );
  assert.equal(
    workspace.grades.filter((g) => Number(g.score) === 11).length,
    38,
  );
  const repeat = await upload(full, "same-file-repeated.pdf");
  assert.equal(repeat.duplicate, true);
  await finish(repeat.batchId);
  assert.equal((await getWorkspace()).pages.length, 62);
  log(
    "50-page mixed-class batch processed; 12 duplicate pages retained without replacing grades; correct and incorrect answers verified",
  );
  let accepted = workspace.pages.find((p) => p.status === "accepted");
  await post({
    action: "review",
    pageId: accepted.id,
    revision: accepted.revision,
    reviewAction: "reopen",
    decisions: [],
    note: "Synthetic re-review",
  });
  workspace = await getWorkspace();
  assert.equal(
    workspace.grades.filter((g) => g.status === "submitted").length,
    49,
  );
  check(
    await teacher.client.rpc("close_owned_assignment", {
      p_assignment_id: assignmentId,
    }),
    "Close while review is pending",
  );
  workspace = await getWorkspace();
  assert.equal(
    workspace.grades.filter((g) => g.status === "submitted").length,
    49,
  );
  const csv = await request(
    `/api/assignments/${assignmentId}/scan-results.csv`,
  );
  assert.equal(csv.status, 200);
  assert.match(await csv.text(), /needs review/);
  accepted = workspace.pages.find((p) => p.id === accepted.id);
  await post({
    action: "review",
    pageId: accepted.id,
    revision: accepted.revision,
    reviewAction: "reject",
    decisions: [],
    note: "Rejecting for synthetic replacement",
  });
  const unknownSheet = fixtureSheet(12);
  const unknown = await upload(
    await filledPdf([unknownSheet]),
    "foreign-identifier.pdf",
  );
  await finish(unknown.batchId);
  workspace = await getWorkspace();
  const unidentified = workspace.pages.find((p) => p.status === "unidentified");
  assert.ok(unidentified);
  const target = sheets.find((s) => s.id === accepted.sheet_id);
  const manual = target.questions.map((q) => ({
    position: q.position,
    choice: ["A", "B", "C", "D"][correctIndex(q.position - 1, target)],
    status: "clear",
    resolved: true,
    densities: [],
  }));
  await post({
    action: "review",
    pageId: unidentified.id,
    revision: unidentified.revision,
    reviewAction: "identify",
    sheetId: target.id,
    sheetPage: 1,
    decisions: manual,
    note: "Synthetic identifier recovery, verified printed student and all answers",
  });
  workspace = await getWorkspace();
  assert.equal(
    workspace.grades.filter((g) => g.status === "submitted").length,
    50,
  );
  assert.ok(workspace.audit.some((a) => a.event === "manual_identify"));
  assert.ok(workspace.audit.some((a) => a.event === "grade_withheld"));
  log(
    "Reopen, withheld grade, close-with-pending, rejection, manual identity recovery and audit verified",
  );
  const multiId = await createAssessment(61, 1);
  let multi = await getWorkspace(multiId);
  const multiSheet = asSheet(multi.sheets[0]);
  const multiBatch = await upload(
    await filledPdf([multiSheet], correctIndex),
    "two-page-student.pdf",
    multiId,
  );
  const page1 = await post(
    { action: "process", batchId: multiBatch.batchId },
    multiId,
  );
  assert.equal(page1.done, false);
  multi = await getWorkspace(multiId);
  assert.equal(multi.grades.length, 0);
  await finish(multiBatch.batchId, multiId);
  multi = await getWorkspace(multiId);
  assert.equal(multi.grades.length, 1);
  assert.equal(multi.grades[0].score, 61);
  const manager = await request(`/teacher/classes/${multiSheet.classId}`);
  assert.equal(manager.status, 200);
  assert.match(await manager.text(), /Scan E2E/);
  log(
    "61-question two-page sheet withheld until both pages; class manager route verified",
  );
  if (process.env.PAPER_SCAN_KEEP_FIXTURES === "1") {
    log(
      `Synthetic fixtures retained for visual QA. Assessment: ${assignmentId}`,
    );
    await writeFile(
      join(artifacts, "fixture-state.json"),
      JSON.stringify({
        assignmentId,
        assignments,
        classIds,
        users,
        questionIds: [...questionIds],
        teacherCookie: teacher.cookie(),
        studentCookie: student.cookie(),
      }),
    );
  }
  log(`PASS - synthetic integration complete. PDF artifacts: ${artifacts}`);
  succeeded = true;
} finally {
  if (!succeeded || process.env.PAPER_SCAN_KEEP_FIXTURES !== "1")
    await cleanup();
}
