import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { projectColumnGrades, projectGrades, suppliedProjectTeams, sumProjectScores, validateProjectDocument } from "../lib/business-poster-project.ts";

const ids = Array.from({ length: 4 }, randomUUID);
function document() {
  return { rubricVersion: 1, teams: [{ id: randomUUID(), name: "Group 1", scores: [18, 17, 19], members: ids.map((studentId, index) => ({ studentId, label: `Student ${index + 1}` })) }], individualScores: Object.fromEntries(ids.map((id, index) => [id, [[20, 20], [15, 18], [12, 14], [18, 16]][index]])) };
}

test("shared and individual scores produce the four requested example totals", () => {
  const grades = projectGrades(document());
  assert.deepEqual(ids.map((id) => grades[id].score), [94, 87, 80, 88]);
  assert.ok(Object.values(grades).every((grade) => grade.maxScore === 100 && grade.attemptId === null));
});
test("team edits recalculate everyone; individual edits affect one student only", () => {
  const draft = document();
  draft.teams[0].scores[0] = 20;
  assert.deepEqual(ids.map((id) => projectGrades(draft)[id].score), [96, 89, 82, 90]);
  draft.individualScores[ids[0]][0] = 10;
  assert.deepEqual(ids.map((id) => projectGrades(draft)[id].score), [86, 89, 82, 90]);
});
test("blank team or individual criteria stay ungraded while zero is valid", () => {
  const draft = document();
  draft.teams[0].scores[0] = null;
  assert.deepEqual(projectGrades(draft), {});
  draft.teams[0].scores = [0, 0, 0];
  draft.individualScores[ids[0]] = [0, 0];
  draft.individualScores[ids[1]] = [null, 0];
  delete draft.individualScores[ids[2]];
  const grades = projectGrades(draft);
  assert.equal(grades[ids[0]].score, 0);
  assert.equal(grades[ids[1]], undefined);
  assert.equal(grades[ids[2]], undefined);
  assert.equal(sumProjectScores([0, null, 0]), null);
});
test("decimal points are preserved and grade percentages follow existing integer rounding", () => {
  const draft = document();
  draft.teams[0].scores = [0.1, 0.2, 18.5];
  assert.equal(sumProjectScores(draft.teams[0].scores), 18.8);
  assert.equal(projectGrades(draft)[ids[0]].score, 58.8);
  assert.equal(projectGrades(draft)[ids[0]].percent, 59);
});
test("gradebook average excludes unfinished grades and includes a completed zero", () => {
  const draft = document();
  draft.teams[0].scores = [0, 0, 0];
  draft.individualScores = { [ids[0]]: [0, 0], [ids[1]]: [10, 10] };
  const result = projectColumnGrades({ document: draft });
  assert.equal(result.average, 10);
  assert.equal(Object.keys(result.scores).length, 2);
});
test("reopening serialized data preserves teams, zero scores, blanks, and totals", () => {
  const draft = document();
  draft.individualScores[ids[0]] = [0, null];
  const restored = JSON.parse(JSON.stringify(draft));
  assert.deepEqual(restored, draft);
  validateProjectDocument(restored, new Set(ids));
  assert.deepEqual(projectGrades(restored), projectGrades(draft));
});
test("moving a student uses their individual scores and their new team's shared scores", () => {
  const draft = document();
  draft.teams.push({ id: randomUUID(), name: "Group 2", scores: [10, 10, 10], members: [draft.teams[0].members.shift()] });
  validateProjectDocument(draft, new Set(ids));
  assert.equal(projectGrades(draft)[ids[0]].score, 70);
  assert.equal(projectGrades(draft)[ids[1]].score, 87);
});
test("server validation rejects invalid scores, duplicates, and students outside this class", () => {
  for (const invalid of [-1, 20.1, NaN, Infinity, "10", undefined]) {
    const draft = document(); draft.teams[0].scores[0] = invalid;
    assert.throws(() => validateProjectDocument(draft, new Set(ids)));
  }
  const duplicate = document(); duplicate.teams[0].members[1].studentId = ids[0];
  assert.throws(() => validateProjectDocument(duplicate, new Set(ids)), /one team/);
  assert.throws(() => validateProjectDocument(document(), new Set(ids.slice(1))), /class roster/);
  assert.deepEqual(projectGrades(document(), new Set()), {});
});

const names = ["Samantha Tirado Rincón", "Samuel Andrés López Cortés", "Lorenzo González", "Tomás Castaño Romero", "Josue Rada Cano", "Tyrique Trevaughn Mcfarlane", "Samuel Andres Montoya Burgos", "Martín Pérez Marín", "Santiago Giraldo Vargas", "Salomón Londoño López", "Simon Diaz Alzate", "Andrés Felipe Cabra Nava", "Paulina Pérez Quiceno", "Santiago Escobar Avendaño", "Juliana Jiménez Cano", "Antonia Ruiz Palma", "Luciana Duque Pérez", "Angelina Meredith Kruichak Ramirez", "Mariana Lozada Florez", "Gabriela Moreno Duque"];
const roster = names.map((fullName) => ({ id: randomUUID(), fullName, aliases: [fullName] }));
test("provided groups match 12B's longer names and accents using existing IDs; spelling ambiguity stays unresolved", () => {
  const result = suppliedProjectTeams(roster);
  assert.equal(result.teams.length, 5);
  const members = result.teams.flatMap((team) => team.members);
  assert.equal(members.filter((member) => member.studentId).length, 19);
  assert.equal(members.find((member) => member.label === "Luciana Duque").studentId, roster[16].id);
  assert.equal(members.find((member) => member.label === "Angelina Kruichack").studentId, null);
  assert.equal(new Set(members.flatMap((member) => member.studentId ? [member.studentId] : [])).size, 19);
  assert.equal(projectGrades(result)[roster[0].id], undefined);
  validateProjectDocument(result, new Set(roster.map((student) => student.id)));
});
test("supplied groups are not seeded into unrelated rosters, including Luciana Ferrucho's class", () => {
  assert.equal(suppliedProjectTeams([{ id: randomUUID(), fullName: "Luciana Ferrucho Diaz", aliases: ["Luciana", "Luciana Ferrucho Diaz"] }]), null);
  assert.equal(suppliedProjectTeams([]), null);
});
test("ambiguous aliases never assign the same student twice or guess a roster match", () => {
  const result = suppliedProjectTeams([...roster, { id: randomUUID(), fullName: "Samuel Lopez", aliases: ["Samuel Lopez"] }]);
  assert.equal(result.teams[0].members[1].studentId, null);
});
