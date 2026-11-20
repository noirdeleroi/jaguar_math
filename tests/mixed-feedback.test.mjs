import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import { fixtureSheet, filledPdf } from "./paper-scan-fixtures.mjs";
import { renderScanPage } from "../lib/paper-scan-render.ts";
import { feedbackRows, feedbackScore, finalFeedbackGrade, validFeedbackEmail } from "../lib/mixed-feedback.ts";
import { buildFeedbackPdf } from "../lib/mixed-feedback-pdf.ts";
import { feedbackEmailContent, feedbackMime, sendFeedbackEmail, FeedbackSendError } from "../lib/mixed-feedback-email.ts";
import { deliverFeedback } from "../lib/mixed-feedback-delivery.ts";

function fixture(count = 10) {
  const sheet = fixtureSheet(count);
  sheet.questions = sheet.questions.map(q => ({ ...q, optionOrder: ["C", "A", "D", "B"] }));
  const questions = new Map(sheet.questions.map(q => [q.questionId, { id: q.questionId, prompt: `Question ${q.position}: solve $x+2=5$.`, options: ["A", "B", "C", "D"].map((id, i) => ({ id, text: `$${i + 1}$` })) }]));
  const keys = new Map(sheet.questions.map(q => [q.questionId, { correct_answer: "C", explanation: "PRIVATE_TEACHER_EXPLANATION" }]));
  const responses = sheet.questions.map(q => ({ question_id: q.questionId, student_answer: q.position <= 6 ? "C" : q.position === 7 ? null : "D", is_correct: q.position <= 6, points_awarded: q.position <= 6 ? 1 : 0 }));
  const grade = { id: "attempt", status: "submitted", score: Math.min(6, count), max_score: count };
  return { title: "Unit 1 Test", sheet, questions, keys, responses, grade };
}

test("only complete final grades with every accepted page can receive feedback", () => {
  const f = fixture(61), page = { status: "accepted", sheet_page: 1, image_path: "one.png" }, second = { ...page, sheet_page: 2 };
  assert.equal(finalFeedbackGrade(f.sheet.questions, [page, second], f.grade), true);
  for (const pages of [[], [page], [page, page], [page, { ...second, status: "review" }], [page, { ...second, image_path: "" }]])
    assert.equal(finalFeedbackGrade(f.sheet.questions, pages, f.grade), false);
  for (const grade of [undefined, { ...f.grade, status: "in_progress" }, { ...f.grade, score: null }, { ...f.grade, max_score: 0 }])
    assert.equal(finalFeedbackGrade(f.sheet.questions, [page, second], grade), false);
});

test("feedback maps every shuffled answer order to the student's printed letters", () => {
  const permutations = xs => xs.length ? xs.flatMap((x, i) => permutations(xs.filter((_, j) => i !== j)).map(rest => [x, ...rest])) : [[]];
  for (const order of permutations(["A", "B", "C", "D"])) {
    const f = fixture(); f.sheet.questions.forEach(q => { q.optionOrder = order; });
    const rows = feedbackRows(f.sheet, f.grade, f.responses, f.keys);
    assert.equal(rows[0].correct, "ABCD"[order.indexOf("C")]);
    assert.equal(rows[0].selected, rows[0].correct);
    assert.equal(rows[6].selected, "Blank / invalid");
    assert.equal(rows[7].selected, "ABCD"[order.indexOf("D")]);
    assert.deepEqual(feedbackScore(rows), { correct: 6, total: 10, score: 6, max: 10, outOfTen: 6 });
  }
});

test("incomplete, duplicate, inconsistent or changed marks fail before feedback can be sent", () => {
  const f = fixture();
  for (const responses of [f.responses.slice(1), [...f.responses.slice(1), f.responses[1]], f.responses.map((r, i) => i ? r : { ...r, is_correct: null }), f.responses.map((r, i) => i ? r : { ...r, points_awarded: 0 })])
    assert.throws(() => feedbackRows(f.sheet, f.grade, responses, f.keys));
  assert.throws(() => feedbackRows(f.sheet, { ...f.grade, score: 7 }, f.responses, f.keys));
  assert.throws(() => feedbackRows(f.sheet, f.grade, f.responses, new Map()));
  const weighted = feedbackRows(f.sheet, f.grade, f.responses, f.keys).map((r, i) => ({ ...r, points: i === 0 ? 3 : r.points, maxPoints: i === 0 ? 3 : r.maxPoints }));
  assert.equal(feedbackScore(weighted).outOfTen, 6.7);
});

test("one private PDF includes the results, exact question paper, and original scan", async () => {
  const f = fixture(), rows = feedbackRows(f.sheet, f.grade, f.responses, f.keys);
  const scans = [(await renderScanPage(await filledPdf([f.sheet]), 1, "application/pdf")).bytes];
  const bytes = await buildFeedbackPdf({ ...f, rows, scans });
  const doc = await PDFDocument.load(bytes);
  assert.equal(doc.getPageCount(), 4);
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({ data: new Uint8Array(bytes) });
  try {
    const pdf = await task.promise, text = [];
    for (let n = 1; n <= pdf.numPages; n++) text.push((await (await pdf.getPage(n)).getTextContent()).items.map(x => x.str ?? "").join(" "));
    assert.match(text[0], /6\/10/); assert.match(text[0], /7, 8, 9, 10/);
    assert.match(text[0], /Blank \/ invalid/); assert.match(text[1], /Question 1:/);
    assert.match(text.at(-1), /YOUR SCANNED ANSWER SHEET/);
    assert.ok(!text.join(" ").includes("PRIVATE_TEACHER_EXPLANATION"));
  } finally { await task.destroy(); }
  await assert.rejects(buildFeedbackPdf({ ...f, rows, scans: [] }));
});

test("HTML is escaped, MIME has a private PDF attachment, and recipients cannot inject headers", () => {
  const f = fixture(), input = { recipient: "student@example.test", name: "<Alice>", title: "<script>Unit 1</script>", rows: feedbackRows(f.sheet, f.grade, f.responses, f.keys), pdf: Buffer.from("%PDF-test") };
  const { html, text } = feedbackEmailContent(input);
  assert.ok(html.includes("&lt;script&gt;")); assert.ok(!html.includes("<script>")); assert.match(text, /6\/10/);
  const mime = feedbackMime(input);
  assert.match(mime, /Content-Type: multipart\/mixed/); assert.match(mime, /Content-Type: multipart\/alternative/);
  assert.match(mime, /Content-Disposition: attachment; filename="your-test-feedback.pdf"/);
  assert.ok(mime.includes(input.pdf.toString("base64")));
  for (const email of ["", "bad", "a@example.test\r\nBcc: other@example.test", "a@example.test\n"]) {
    assert.equal(validFeedbackEmail(email), false);
    assert.throws(() => feedbackMime({ ...input, recipient: email }));
  }
});

test("Gmail receipts, rejected requests and uncertain network failures are distinguished", async () => {
  const f = fixture(), input = { recipient: "student@example.test", name: "Student", title: f.title, rows: feedbackRows(f.sheet, f.grade, f.responses, f.keys), pdf: Buffer.from("%PDF-test") };
  let calls = 0;
  const id = await sendFeedbackEmail("test-token", input, async (url, options) => {
    calls++; assert.match(url, /gmail.*messages\/send/); assert.equal(options.headers.Authorization, "Bearer test-token");
    assert.match(Buffer.from(JSON.parse(options.body).raw, "base64url").toString(), /To: student@example.test/);
    return Response.json({ id: "receipt" });
  });
  assert.equal(id, "receipt"); assert.equal(calls, 1);
  for (const status of [400, 401, 403, 429, 500, 503]) await assert.rejects(sendFeedbackEmail("x", input, async () => Response.json({}, { status })), e => e instanceof FeedbackSendError && e.uncertain === (status >= 500));
  await assert.rejects(sendFeedbackEmail("x", input, async () => { throw new Error("timeout"); }), e => e.uncertain);
  await assert.rejects(sendFeedbackEmail("x", input, async () => Response.json({})), e => e.uncertain);
});

test("delivery records receipts, prevents stale sends, and holds uncertain outcomes", async () => {
  const events = [];
  const ops = { prepare: async () => "pdf", begin: async () => true, send: async () => { events.push("send"); return "receipt"; }, finish: async (...args) => { events.push(args); } };
  assert.equal((await deliverFeedback(ops)).outcome, "sent"); assert.deepEqual(events, ["send", ["sent", "receipt", null]]);
  events.length = 0;
  assert.equal((await deliverFeedback({ ...ops, begin: async () => false })).outcome, "skipped"); assert.deepEqual(events, []);
  for (const [phase, error, outcome] of [["prepare", new Error("scan missing"), "failed"], ["send", new FeedbackSendError("rejected", false), "failed"], ["send", new FeedbackSendError("timeout", true), "uncertain"]]) {
    events.length = 0;
    assert.equal((await deliverFeedback({ ...ops, [phase]: async () => { throw error; } })).outcome, outcome);
    assert.equal(events.at(-1)[0], outcome);
  }
  let sent = 0;
  const result = await deliverFeedback({ ...ops, send: async () => { sent++; return "receipt"; }, finish: async () => { throw new Error("DB disconnected"); } });
  assert.equal(result.outcome, "uncertain"); assert.equal(sent, 1);
});
