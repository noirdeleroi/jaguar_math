import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  buildPersonalizedPapersPdf,
  personalizedPaperMaterial,
} from "../lib/paper-scan-papers.ts";
import { printedScanChoice } from "../lib/paper-scan-layout.ts";
import { scanPageResults } from "../lib/paper-scan-results.ts";
import { fixtureSheet } from "./paper-scan-fixtures.mjs";
import { identifyScan } from "../lib/paper-scan-recognition.ts";
import { renderScanPage } from "../lib/paper-scan-render.ts";
import { splitPdfMath, PdfMathText } from "../lib/pdf-math-text.ts";
import { PDFDocument, StandardFonts } from "pdf-lib";

const demo = JSON.parse(
  readFileSync(
    new URL(
      "../data/assessment-imports/unit-1-extremely-easy-mixed-demo-10q-4v.json",
      import.meta.url,
    ),
  ),
);
const skills = new Set(
  JSON.parse(
    readFileSync(new URL("../data/skills.json", import.meta.url)),
  ).skills.map((s) => s.code),
);
test("the easy demo has ten slots, four number variants and valid distinct MCQ answers", () => {
  assert.equal(demo.question_groups.length, 10);
  demo.question_groups.forEach((group, i) => {
    assert.equal(group.length, 4);
    assert.equal(new Set(group.map((q) => q.prompt)).size, 4);
    group.forEach((q, v) => {
      assert.equal(q.type, "multiple_choice");
      assert.equal(q.difficulty, 1);
      assert.equal(q.points, 1);
      assert.deepEqual(
        q.options.map((o) => o.id),
        ["A", "B", "C", "D"],
      );
      assert.equal(new Set(q.options.map((o) => o.text)).size, 4);
      assert.ok(skills.has(q.skills[0].code));
      // Independently calculate the expected answer for all forty variants.
      const n = v + 2;
      const expected = [
        n + 3,
        2 + 3 * n,
        n,
        v + 4,
        `${n + 3}x`,
        4,
        3,
        2 * n + 1,
        n,
        v + 1,
      ][i];
      assert.equal(
        q.options.find((o) => o.id === q.correct_answer).text,
        `$${expected}$`,
      );
    });
  });
});

test("every option permutation keeps printed choices, paper content and marks aligned", () => {
  const permutations = (a) =>
    a.length
      ? a.flatMap((x, i) =>
          permutations(a.filter((_, j) => i !== j)).map((rest) => [x, ...rest]),
        )
      : [[]];
  for (const order of permutations(["A", "B", "C", "D"])) {
    const sheet = fixtureSheet(1);
    const slot = { ...sheet.questions[0], optionOrder: order, variantIndex: 3 };
    sheet.questions = [slot];
    const questions = new Map([
      [
        slot.questionId,
        {
          id: slot.questionId,
          prompt: "What is 2 + 3?",
          options: ["A", "B", "C", "D"].map((id, i) => ({
            id,
            text: String(4 + i),
          })),
        },
      ],
    ]);
    const keys = new Map([
      [
        slot.questionId,
        { correct_answer: "B", explanation: "PRIVATE_EXPLANATION" },
      ],
    ]);
    const material = personalizedPaperMaterial("Demo", sheet, questions, keys);
    const correct = printedScanChoice(slot, "B");
    assert.equal(
      material.questions[0].options.find((o) => o.id === correct).text,
      "5",
    );
    assert.equal(material.questions[0].correctAnswer, correct);
    const results = scanPageResults(
      [slot],
      [{ position: 1, choice: correct, status: "clear", densities: [] }],
      { [slot.questionId]: "B" },
    );
    assert.equal(results.score, 1);
    assert.equal(results.rows[0].answerKey, correct);
    assert.equal(
      personalizedPaperMaterial("Demo", sheet, questions).questions[0]
        .explanation,
      null,
    );
  }
  assert.equal(printedScanChoice(fixtureSheet(1).questions[0], "B"), "B");
});

test("packets interleave each student's named question paper and QR sheet without solutions", async () => {
  const sheets = [
    fixtureSheet(1, { studentName: "Demo Alice", className: "11A" }),
    fixtureSheet(1, { studentName: "Demo Bruno", className: "11B" }),
  ];
  const questions = new Map(
    sheets.map((s) => [
      s.questions[0].questionId,
      {
        id: s.questions[0].questionId,
        prompt: "Choose five.",
        options: ["A", "B", "C", "D"].map((id, i) => ({
          id,
          text: String(i + 3),
        })),
      },
    ]),
  );
  sheets[0].questions[0].optionOrder = ["B", "C", "A", "D"];
  sheets[1].questions[0].optionOrder = ["D", "A", "C", "B"];
  const bytes = await buildPersonalizedPapersPdf(
    "Tiny test",
    sheets,
    questions,
  );
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({ data: new Uint8Array(bytes) });
  const doc = await task.promise;
  try {
    assert.equal(doc.numPages, 4);
    for (let i = 1; i <= 4; i++) {
      const page = await doc.getPage(i);
      const text = (await page.getTextContent()).items
        .map((x) => x.str ?? "")
        .join(" ");
      const s = sheets[Math.floor((i - 1) / 2)];
      assert.ok(text.includes(s.studentName));
      assert.ok(text.includes(s.className));
      assert.ok(text.includes(s.id.slice(0, 8).toUpperCase()));
      assert.doesNotMatch(
        text,
        /ANSWER KEY|PRIVATE TEACHER KEY|PRIVATE_EXPLANATION|Correct answers/,
      );
      if (i % 2 === 0) {
        const png = await renderScanPage(
          Buffer.from(bytes),
          i,
          "application/pdf",
        );
        assert.deepEqual((await identifyScan(png.bytes)).identifier, {
          token: s.token,
          page: 1,
        });
      }
    }
  } finally {
    await task.destroy();
  }
});

test("math delimiters preserve currency, escaped dollars, and inline/display formulas", () => {
  for (const value of ["A tablet costs $200.", "Pay $90 and $120.", "Prices: $90, $120, and $150.", "Pay \\$20."]) {
    assert.ok(splitPdfMath(value).every((part) => !part.math), value);
  }
  assert.deepEqual(splitPdfMath("Pay $90 and solve $x^2=4$."), [
    { text: "Pay $90 and solve ", math: false },
    { text: "x^2=4", math: true, display: false },
    { text: ".", math: false },
  ]);
  assert.equal(splitPdfMath("$$\\frac{1}{2}$$")[0].display, true);
  assert.equal(splitPdfMath("\\(x+1\\)")[0].math, true);
  assert.equal(splitPdfMath("\\[x+1\\]")[0].display, true);
});

test("the real 10x4 Unit 1 import produces four complete typeset single-page student papers", async () => {
  const exam = JSON.parse(readFileSync(new URL("../data/assessment-imports/unit-1-mathematics-test-10q-4v.json", import.meta.url)));
  const questions = new Map(), keys = new Map();
  for (const [i, group] of exam.question_groups.entries()) for (const [v, q] of group.entries()) {
    const id = `unit1-${i}-${v}`;
    questions.set(id, { id, prompt: q.prompt, options: q.options });
    keys.set(id, { correct_answer: q.correct_answer, explanation: "PRIVATE_EXPLANATION" });
  }
  const sheets = Array.from({ length: 4 }, (_, s) => {
    const sheet = fixtureSheet(10, { studentName: `Layout Student ${s + 1}` });
    sheet.questions.forEach((slot, i) => {
      slot.questionId = `unit1-${i}-${(i + s) % 4}`;
      slot.optionOrder = Array.from({ length: 4 }, (_, o) => "ABCD"[(o + s + i) % 4]);
    });
    return sheet;
  });
  const bytes = await buildPersonalizedPapersPdf("Unit 1 / Mathematics Test", sheets, questions, "questions", keys);
  const { getDocument, OPS } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
  const doc = await task.promise;
  try {
    assert.equal(doc.numPages, 4, "each student's ten questions fit on one A4 page");
    for (let i = 1; i <= 4; i++) {
      const page = await doc.getPage(i);
      const items = (await page.getTextContent()).items.filter((item) => item.str?.trim());
      const content = items.map((item) => item.str).join(" ");
      assert.match(content, new RegExp(`Layout Student ${i}`));
      assert.match(content, /10 questions.*10 points/);
      assert.match(content, /\$(?:90|120|150|200)/, "currency signs survive PDF rendering");
      assert.doesNotMatch(content, /PRIVATE_EXPLANATION|PRIVATE TEACHER KEY|ANSWER KEY|x\^|!=|<=|>=|\(3x \+/);
      assert.equal(items.filter((item) => /^[ABCD]\.$/.test(item.str)).length, 40);
      const numberItems = items.filter((item) => /^(?:[1-9]|10)\.$/.test(item.str));
      assert.deepEqual(numberItems.map((item) => Number.parseInt(item.str)), [1,2,3,4,5,6,7,8,9,10]);
      assert.ok(numberItems.some((item) => item.transform[4] > 297), "questions use the second column");
      for (const item of items) {
        assert.ok(item.transform[4] >= 35 && item.transform[4] + item.width <= 561, `text within horizontal margins: ${item.str}`);
        assert.ok(item.transform[5] >= 24 && item.transform[5] <= 810, `text within vertical margins: ${item.str}`);
      }
      const ops = await page.getOperatorList();
      assert.ok(ops.fnArray.filter((op) => op === OPS.paintImageXObject).length >= 15, "fractions, powers, and inequalities are typeset rather than flattened text");
      const material = personalizedPaperMaterial("Unit 1", sheets[i - 1], questions, keys);
      for (const [q, slot] of material.questions.map((q, n) => [q, sheets[i - 1].questions[n]])) {
        const source = questions.get(slot.questionId);
        assert.equal(q.options.find((o) => o.id === q.correctAnswer).text, source.options.find((o) => o.id === keys.get(source.id).correct_answer).text);
      }
    }
  } finally { await task.destroy(); }
});

test("nested fractions, radicals, and long multiple-choice questions paginate without clipping", async () => {
  const doc = await PDFDocument.create();
  const text = new PdfMathText(doc, await doc.embedFont(StandardFonts.TimesRoman));
  const math = await text.layout("$\\frac{1}{1+\\frac{2}{3}} + \\sqrt{x^2+1} + \\theta + \\infty$", 220);
  assert.ok(math.height > 20);
  await assert.rejects(() => text.layout("$\\notARealMathCommand{x}$", 220));
  const sheet = fixtureSheet(12);
  const questions = new Map(sheet.questions.map((slot, i) => [slot.questionId, {
    id: slot.questionId,
    prompt: `Question scenario ${i + 1}. ` + "A student records measurements and compares the results. ".repeat(9) + "Evaluate $\\frac{3x+1}{4}$.",
    options: ["A", "B", "C", "D"].map((id) => ({ id, text: `This is the complete explanation for option ${id}, which should wrap neatly inside its own question column.` })),
  }]));
  const bytes = await buildPersonalizedPapersPdf("Long-question layout", [sheet], questions, "questions");
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
  const pdf = await task.promise;
  try {
    assert.ok(pdf.numPages > 1);
    let total = 0;
    for (let p = 1; p <= pdf.numPages; p++) {
      const items = (await (await pdf.getPage(p)).getTextContent()).items;
      const content = items.map((item) => item.str ?? "").join(" ");
      const questionNumbers = items.filter((item) => /^\d+\.$/.test(item.str ?? ""));
      total += questionNumbers.length;
      for (const number of questionNumbers) {
        const q = Number.parseInt(number.str);
        assert.ok(content.includes(`Question scenario ${q}.`));
      }
      for (const item of items.filter((item) => item.str?.trim())) {
        assert.ok(item.transform[4] + item.width <= 561, item.str);
        assert.ok(item.transform[5] >= 24, item.str);
      }
      assert.equal(items.filter((item) => item.str === "D.").length, questionNumbers.length, "all four choices stay with their question");
    }
    assert.equal(total, 12);
  } finally { await task.destroy(); }
});
