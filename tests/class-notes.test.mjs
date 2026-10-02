import assert from "node:assert/strict";
import test from "node:test";
import { CLASSWORK_GRADE_NOTE_LIMIT, normalizeClassworkGradeNote } from "../lib/classroom-classwork-note.ts";
import { CLASS_NOTE_LIMIT, normalizeClassNote } from "../lib/class-notes.ts";

test("class notes trim surrounding whitespace and normalize newlines", () => {
  assert.deepEqual(normalizeClassNote("  Stopped at example 4.\r\nReview factoring next.  "), {
    body: "Stopped at example 4.\nReview factoring next.",
  });
});

test("class notes reject empty and oversized content", () => {
  assert.match(normalizeClassNote("   \n ").error, /Write a note/);
  assert.match(normalizeClassNote("x".repeat(CLASS_NOTE_LIMIT + 1)).error, /280 characters/);
});

test("class notes accept the full compact note limit", () => {
  const body = "x".repeat(CLASS_NOTE_LIMIT);
  assert.deepEqual(normalizeClassNote(body), { body });
});

test("classwork grade notes support multiline notepad text and clearing", () => {
  assert.deepEqual(normalizeClassworkGradeNote("  Needs another example.\r\nCheck again Friday.  "), {
    note: "Needs another example.\nCheck again Friday.",
  });
  assert.deepEqual(normalizeClassworkGradeNote("  \n "), { note: "" });
});

test("classwork grade notes enforce the notepad limit", () => {
  assert.deepEqual(normalizeClassworkGradeNote("x".repeat(CLASSWORK_GRADE_NOTE_LIMIT)), { note: "x".repeat(CLASSWORK_GRADE_NOTE_LIMIT) });
  assert.match(normalizeClassworkGradeNote("x".repeat(CLASSWORK_GRADE_NOTE_LIMIT + 1)).error, /2000 characters/);
});
