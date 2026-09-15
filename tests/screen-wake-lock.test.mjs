import assert from "node:assert/strict";
import test from "node:test";
import { canKeepScreenAwake, requestScreenWakeLock } from "../app/student/assignments/screen-wake-lock.ts";

test("requests the screen wake lock when the browser supports it", async () => {
  const sentinel = { addEventListener() {}, async release() {} };
  const requested = [];
  const target = { wakeLock: { async request(type) { requested.push(type); return sentinel; } } };
  assert.equal(canKeepScreenAwake(target), true);
  assert.equal(await requestScreenWakeLock(target), sentinel);
  assert.deepEqual(requested, ["screen"]);
});

test("degrades safely when wake lock is unsupported or denied", async () => {
  assert.equal(canKeepScreenAwake({}), false);
  assert.equal(await requestScreenWakeLock({}), null);
  assert.equal(await requestScreenWakeLock({ wakeLock: { async request() { throw new Error("denied"); } } }), null);
});
