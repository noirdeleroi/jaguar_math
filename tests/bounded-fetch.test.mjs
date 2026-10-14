import assert from "node:assert/strict";
import test from "node:test";
import { boundedFetch } from "../lib/supabase/bounded-fetch.ts";

test("upstream requests retain caller cancellation and request options", async () => {
  const original = globalThis.fetch;
  const controller = new AbortController();
  let observed;
  globalThis.fetch = async (_input, init) => { observed = init; return new Response("ok"); };
  try {
    await boundedFetch("https://example.test", { method: "POST", body: "answers", signal: controller.signal });
    assert.equal(observed.method, "POST");
    assert.equal(observed.body, "answers");
    assert.equal(observed.signal.aborted, false);
    controller.abort();
    assert.equal(observed.signal.aborted, true);
  } finally { globalThis.fetch = original; }
});

test("timeouts cancel an upstream request even without caller cancellation", async () => {
  const originalFetch = globalThis.fetch;
  const originalTimeout = AbortSignal.timeout;
  const timer = new AbortController();
  AbortSignal.timeout = (ms) => { assert.equal(ms, 10_000); return timer.signal; };
  globalThis.fetch = async (_input, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
  });
  try {
    const request = boundedFetch("https://example.test");
    timer.abort(new DOMException("Timed out", "TimeoutError"));
    await assert.rejects(request, { name: "TimeoutError" });
  } finally { globalThis.fetch = originalFetch; AbortSignal.timeout = originalTimeout; }
});
