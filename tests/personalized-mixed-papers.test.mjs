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
        /ANSWER KEY|PRIVATE_EXPLANATION|Correct answers/,
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
