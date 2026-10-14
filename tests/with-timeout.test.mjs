import assert from "node:assert/strict";
import test from "node:test";
import { withTimeout } from "../lib/with-timeout.ts";

test("a lost launch response stops waiting and a late response cannot activate it", async () => {
  let resolve;
  let activated = false;
  const operation = new Promise((done) => { resolve = done; });
  await assert.rejects(withTimeout(operation, 5).then(() => { activated = true; }), /timed out/);
  resolve("late attempt");
  await operation;
  assert.equal(activated, false);
});

test("a timely launch preserves its result and an upstream failure remains a failure", async () => {
  assert.equal(await withTimeout(Promise.resolve("attempt"), 100), "attempt");
  await assert.rejects(withTimeout(Promise.reject(new Error("offline")), 100), /offline/);
});
