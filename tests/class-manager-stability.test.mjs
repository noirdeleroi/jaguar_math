import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const classPage = readFileSync(new URL("../app/teacher/classes/[id]/page.tsx", import.meta.url), "utf8");
const classroom = readFileSync(new URL("../app/teacher/classes/[id]/stars/star-classroom.tsx", import.meta.url), "utf8");
const gradebookStyles = readFileSync(new URL("../app/teacher/classes/[id]/stars/class-gradebook.module.css", import.meta.url), "utf8");

test("star saves preserve the teacher's open non-current topic", () => {
  const flushQueue = classroom.slice(classroom.indexOf("const flushQueue"), classroom.indexOf("useEffect(() =>", classroom.indexOf("const flushQueue")));

  assert.match(classPage, /<StarClassroom[\s\S]*?key=\{id\}/);
  assert.doesNotMatch(classPage, /key=\{`[^`]*(?:eventIds|skullEventIds|workItems)/);
  assert.doesNotMatch(flushQueue, /router\.refresh\(\)/);
  assert.match(classroom, /setSelectedWeek\(\(current\) => availableWeeks\.has\(current\) \? current : fallbackWeek\)/);
  assert.match(classroom, /new Set\(\[\.\.\.current\]\.filter\(\(weekLabel\) => availableWeeks\.has\(weekLabel\)\)\)/);
});

test("the frozen spreadsheet header forwards topic clicks to the live header", () => {
  assert.match(gradebookStyles, /\.frozenSheetHeader button,[\s\S]*?pointer-events:\s*auto/);
  assert.match(classroom, /frozenHeader\.addEventListener\("click", activateSourceControl\)/);
  assert.match(classroom, /sourceControl\.click\(\)/);
  assert.match(classroom, /frozenHeader\.removeEventListener\("click", activateSourceControl\)/);
});

test("classwork grade buttons adjust student grades by one percentage point", () => {
  assert.match(classroom, /Quick ±1%/);
  assert.match(classroom, /changeClassworkGrade\(week, student\.id, -1\)/);
  assert.match(classroom, /changeClassworkGrade\(week, student\.id, 1\)/);
  assert.match(classroom, /change classwork grades by 1%/);
  assert.doesNotMatch(classroom, /classwork grade by 5 percent/);
});
