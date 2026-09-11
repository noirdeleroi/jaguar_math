import assert from "node:assert/strict";
import test from "node:test";
import { landingRotation, normalizeDegrees, winnerIndexAtRotation } from "../lib/student-randomizer.ts";

test("normalizes positive and negative rotations", () => {
  assert.equal(normalizeDegrees(450), 90);
  assert.equal(normalizeDegrees(-90), 270);
});

test("lands the pointer on every requested participant", () => {
  for (const participantCount of [1, 2, 8, 17, 31]) {
    for (let winnerIndex = 0; winnerIndex < participantCount; winnerIndex += 1) {
      const landing = landingRotation(137.5, winnerIndex, participantCount, 6);
      assert.equal(winnerIndexAtRotation(landing, participantCount), winnerIndex);
      assert.ok(landing > 137.5 + 5 * 360);
    }
  }
});

test("rejects an invalid winner", () => {
  assert.throws(() => landingRotation(0, 3, 3, 6), /winnerIndex/);
});
