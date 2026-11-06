import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import {
  classifyBubble,
  homography,
  identifyScan,
  recognizeScan,
} from "../lib/paper-scan-recognition.ts";
import { renderScanPage } from "../lib/paper-scan-render.ts";
import { buildScanSheetsPdf } from "../lib/paper-scan-pdf.ts";
import { buildAssignmentAnswerKeyPdf } from "../lib/assignment-pdf.ts";
import { ScanSourceCache } from "../lib/paper-scan-source-cache.ts";
import {
  pageQuestions,
  parseQrPayload,
  qrPayload,
  mixedQuestionError,
} from "../lib/paper-scan-layout.ts";
import {
  fixtureSheet,
  filledPdf,
  rasterizePdf,
} from "./paper-scan-fixtures.mjs";

test("student question PDF uses numbered versions and contains no key or explanations", async () => {
  const pdf = await buildAssignmentAnswerKeyPdf(
    {
      title: "Confidential answers",
      kind: "paper",
      dueAt: null,
      description: null,
      questions: [
        {
          position: 1,
          variantIndex: 1,
          prompt: "Choose an option.",
          type: "multiple_choice",
          points: 1,
          options: [
            { id: "A", text: "One" },
            { id: "B", text: "Two" },
            { id: "C", text: "Three" },
            { id: "D", text: "Four" },
          ],
          correctAnswer: "C",
          numericTolerance: 0,
          explanation: "SECRET_SOLUTION_DO_NOT_PRINT",
        },
      ],
    },
    { questionsOnly: true, numericVersions: true },
  );
  await renderScanPage(Buffer.from(pdf), 1, "application/pdf");
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({ data: new Uint8Array(pdf) });
  const doc = await task.promise;
  try {
    const page = await doc.getPage(1);
    const content = await page.getTextContent();
    const text = content.items.map((i) => i.str ?? "").join(" ");
    assert.match(text, /Version 1/);
    assert.doesNotMatch(text, /ANSWER KEY|SECRET_SOLUTION/);
    assert.equal(doc.numPages, 1);
  } finally {
    await task.destroy();
  }
});
test("sheet identifiers are opaque, versioned, and bounded", () => {
  const token = "1".repeat(32);
  assert.deepEqual(parseQrPayload(qrPayload(token, 4)), { token, page: 4 });
  for (const text of [
    "JM1:student:1",
    `JM1:${token}:0`,
    `JM1:${token}:5`,
    `JM2:${token}:1`,
    "https://untrusted.test",
  ])
    assert.equal(parseQrPayload(text), null);
  assert.equal(
    mixedQuestionError([[{ type: "numeric", options: null }]])?.includes(
      "A, B, C and D",
    ),
    true,
  );
});
test("private source cache isolates owner keys, expires and stays within memory bounds", () => {
  const cache = new ScanSourceCache(10, 100);
  cache.put("teacher-one/batch/hash", Buffer.alloc(6, 1), 0);
  assert.equal(cache.get("teacher-two/batch/hash", 1), undefined);
  cache.put("teacher-two/batch/hash", Buffer.alloc(6, 2), 2);
  assert.equal(cache.get("teacher-one/batch/hash", 3), undefined);
  assert.equal(cache.get("teacher-two/batch/hash", 4)[0], 2);
  assert.equal(cache.get("teacher-two/batch/hash", 105), undefined);
  cache.put("too-large", Buffer.alloc(11), 106);
  assert.equal(cache.get("too-large", 107), undefined);
});
test("uncertain, blank, erased, crossed and multiple answers never become clear", () => {
  assert.equal(
    classifyBubble([0.99, 0, 0, 0], [1, 0, 0, 0], [0, 0, 0, 0]).choice,
    "A",
  );
  for (const densities of [
    [0, 0, 0, 0],
    [0.6, 0, 0, 0],
    [0.98, 0.12, 0, 0],
    [0.99, 0.8, 0, 0],
    [0.04, 0, 0, 0],
  ])
    assert.equal(
      classifyBubble(densities, [1, 1, 1, 1], [0, 0, 0, 0]).choice,
      null,
    );
  assert.equal(
    classifyBubble([1, 0, 0, 0], [0.3, 0, 0, 0], [0.3, 0, 0, 0]).status,
    "irregular",
  );
});
test("projective alignment recovers perspective coordinates", () => {
  const source = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 200 },
    { x: 0, y: 200 },
  ];
  const target = [
    { x: 17, y: 30 },
    { x: 200, y: 42 },
    { x: 190, y: 380 },
    { x: 35, y: 400 },
  ];
  const map = homography(source, target);
  source.forEach((p, i) =>
    assert.ok(
      Math.hypot(map(p).x - target[i].x, map(p).y - target[i].y) < 1e-7,
    ),
  );
});
test("dynamic sheets paginate 1 through 200 questions without answer keys", async () => {
  const sheets = [fixtureSheet(1), fixtureSheet(61), fixtureSheet(200)];
  const bytes = await buildScanSheetsPdf("Dynamic paper", sheets);
  const doc = await PDFDocument.load(bytes);
  assert.equal(doc.getPageCount(), 7);
  const last = await renderScanPage(Buffer.from(bytes), 7, "application/pdf");
  const found = await identifyScan(last.bytes);
  assert.deepEqual(found.identifier, { token: sheets[2].token, page: 4 });
  assert.equal(pageQuestions(sheets[2].questions, 4).length, 20);
});
test("real generated PDF round trip recognizes every selected letter", async () => {
  const sheet = fixtureSheet(60);
  const pdf = await filledPdf([sheet]);
  const image = await renderScanPage(pdf, 1, "application/pdf");
  const result = await recognizeScan(image.bytes, sheet.questions, sheet.token);
  assert.equal(result.problem, null);
  assert.ok(result.normalized);
  assert.deepEqual(
    result.readings.map((r) => r.choice),
    sheet.questions.map((_, i) => ["A", "B", "C", "D"][i % 4]),
  );
});
test("image-only scanner PDF with embedded compressed JPEG decodes and grades", async () => {
  const sheet = fixtureSheet(30);
  const rasterPdf = await rasterizePdf(await filledPdf([sheet]));
  const image = await renderScanPage(rasterPdf, 1, "application/pdf");
  const result = await recognizeScan(image.bytes, sheet.questions, sheet.token);
  assert.equal(result.problem, null);
  assert.deepEqual(
    result.readings.map((r) => r.choice),
    sheet.questions.map((_, i) => ["A", "B", "C", "D"][i % 4]),
  );
});
test("rotation, small skew, blur, JPEG compression and paper scaling preserve clear answers", async () => {
  const sheet = fixtureSheet(18);
  const image = await renderScanPage(
    await filledPdf([sheet]),
    1,
    "application/pdf",
  );
  for (const angle of [90, 180, 270, 2, -3]) {
    const transformed = await sharp(image.bytes)
      .rotate(angle, { background: "white" })
      .blur(0.4)
      .jpeg({ quality: 80 })
      .toBuffer();
    const result = await recognizeScan(
      transformed,
      sheet.questions,
      sheet.token,
    );
    assert.equal(result.problem, null, `rotation ${angle}: ${result.problem}`);
    assert.deepEqual(
      result.readings.map((r) => r.choice),
      sheet.questions.map((_, i) => ["A", "B", "C", "D"][i % 4]),
      `rotation ${angle}`,
    );
  }
  const scaled = await sharp(image.bytes)
    .resize({ width: 1300 })
    .extend({ top: 30, bottom: 30, left: 20, right: 20, background: "white" })
    .png()
    .toBuffer();
  const result = await recognizeScan(scaled, sheet.questions, sheet.token);
  assert.equal(result.problem, null);
  assert.ok(result.readings.every((r) => r.status === "clear"));
});
test("faint, blank, crossed-out and multiple marks require visual review", async () => {
  const sheet = fixtureSheet(7);
  const pdf = await filledPdf(
    [sheet],
    (i) => (i === 0 ? null : i === 1 ? [0, 1] : i % 4),
    { 2: "faint", 3: "cross", 4: "filled-cross" },
  );
  const image = await renderScanPage(pdf, 1, "application/pdf");
  const result = await recognizeScan(image.bytes, sheet.questions, sheet.token);
  assert.equal(result.problem, null);
  for (let i = 0; i < 5; i++)
    assert.notEqual(result.readings[i].status, "clear", `question ${i + 1}`);
  assert.equal(result.readings[5].choice, "B");
  assert.equal(result.readings[6].choice, "C");
});
test("missing QR, cropped alignment and mismatched identifiers do not guess answers", async () => {
  const sheet = fixtureSheet(6);
  const image = await renderScanPage(
    await filledPdf([sheet]),
    1,
    "application/pdf",
  );
  const mismatch = await recognizeScan(
    image.bytes,
    sheet.questions,
    "f".repeat(32),
  );
  assert.ok(mismatch.problem);
  assert.ok(mismatch.readings.every((r) => r.choice === null));
  const covered = await sharp(image.bytes)
    .composite([
      {
        input: Buffer.from(
          '<svg width="400" height="450"><rect width="400" height="450" fill="white"/></svg>',
        ),
        left: 1050,
        top: 130,
      },
    ])
    .png()
    .toBuffer();
  const noQr = await recognizeScan(covered, sheet.questions, sheet.token);
  assert.ok(noQr.problem);
  assert.ok(noQr.readings.every((r) => r.choice === null));
  const cropped = await sharp(image.bytes)
    .extract({ left: 120, top: 120, width: 1300, height: 1800 })
    .png()
    .toBuffer();
  const noMarkers = await recognizeScan(cropped, sheet.questions, sheet.token);
  assert.ok(noMarkers.problem);
});
