import assert from "node:assert/strict";
import test from "node:test";
import { flushExamActivityQueue, sendExamActivity } from "../app/student/assignments/exam-activity-client.ts";

function createStorage() {
  const entries = new Map();
  return {
    getItem: (key) => entries.get(key) ?? null,
    removeItem: (key) => entries.delete(key),
    setItem: (key, value) => entries.set(key, value),
  };
}

test("persists an exit before starting its network request", async () => {
  const storage = createStorage();
  const previous = { fetch: globalThis.fetch, localStorage: globalThis.localStorage, window: globalThis.window };
  globalThis.localStorage = storage;
  globalThis.window = globalThis;
  globalThis.fetch = async () => {
    const queued = JSON.parse(storage.getItem("jaguar-exam-events:attempt-1"));
    assert.equal(queued.length, 1);
    assert.equal(queued[0].eventType, "fullscreen_exited");
    throw new Error("offline");
  };
  try {
    const result = await sendExamActivity("attempt-1", "fullscreen_exited", undefined, true);
    assert.match(result.error, /queued/i);
    assert.equal(JSON.parse(storage.getItem("jaguar-exam-events:attempt-1")).length, 1);
  } finally {
    globalThis.fetch = previous.fetch;
    globalThis.localStorage = previous.localStorage;
    globalThis.window = previous.window;
  }
});

test("queues the latest answer snapshot with a violation", async () => {
  const storage = createStorage();
  const previous = { fetch: globalThis.fetch, localStorage: globalThis.localStorage, window: globalThis.window };
  globalThis.localStorage = storage;
  globalThis.window = globalThis;
  globalThis.fetch = async () => { throw new Error("offline"); };
  const responses = [{ questionId: "question-1", answer: "42", revision: 123 }];
  try {
    await sendExamActivity("attempt-snapshot", "fullscreen_exited", undefined, true, responses);
    const [queued] = JSON.parse(storage.getItem("jaguar-exam-events:attempt-snapshot"));
    assert.deepEqual(queued.responses, responses);
    assert.equal(Number.isNaN(new Date(queued.clientOccurredAt).getTime()), false);
  } finally {
    globalThis.fetch = previous.fetch;
    globalThis.localStorage = previous.localStorage;
    globalThis.window = previous.window;
  }
});

test("concurrent acknowledgements remove only their own queued event", async () => {
  const storage = createStorage();
  const pending = [];
  const previous = { fetch: globalThis.fetch, localStorage: globalThis.localStorage, window: globalThis.window };
  globalThis.localStorage = storage;
  globalThis.window = globalThis;
  globalThis.fetch = (_url, init) => new Promise((resolve) => pending.push({ body: JSON.parse(init.body), resolve }));
  try {
    const first = sendExamActivity("attempt-2", "fullscreen_exited");
    const second = sendExamActivity("attempt-2", "fullscreen_restored");
    assert.equal(JSON.parse(storage.getItem("jaguar-exam-events:attempt-2")).length, 2);

    pending[1].resolve(Response.json({ focusViolations: 1, autoSubmitted: false }));
    await second;
    const afterSecond = JSON.parse(storage.getItem("jaguar-exam-events:attempt-2"));
    assert.equal(afterSecond.length, 1);
    assert.equal(afterSecond[0].eventId, pending[0].body.eventId);

    pending[0].resolve(Response.json({ focusViolations: 1, autoSubmitted: false }));
    await first;
    assert.equal(storage.getItem("jaguar-exam-events:attempt-2"), null);
  } finally {
    globalThis.fetch = previous.fetch;
    globalThis.localStorage = previous.localStorage;
    globalThis.window = previous.window;
  }
});

test("routine offline churn cannot evict a queued violation snapshot", async () => {
  const storage = createStorage();
  const previous = { fetch: globalThis.fetch, localStorage: globalThis.localStorage, window: globalThis.window };
  globalThis.localStorage = storage;
  globalThis.window = globalThis;
  globalThis.fetch = async () => { throw new Error("offline"); };
  try {
    const responses = [{ questionId: "question-1", answer: "final", revision: 999 }];
    await sendExamActivity("attempt-churn", "fullscreen_exited", undefined, true, responses);
    for (let index = 0; index < 100; index += 1) await sendExamActivity("attempt-churn", "window_focus");
    const queued = JSON.parse(storage.getItem("jaguar-exam-events:attempt-churn"));
    assert.equal(queued.length, 2);
    assert.deepEqual(queued.find((event) => event.eventType === "fullscreen_exited").responses, responses);
  } finally {
    globalThis.fetch = previous.fetch;
    globalThis.localStorage = previous.localStorage;
    globalThis.window = previous.window;
  }
});

test("concurrent reconnect signals share one queue flush", async () => {
  const storage = createStorage();
  const previous = { fetch: globalThis.fetch, localStorage: globalThis.localStorage, window: globalThis.window };
  globalThis.localStorage = storage;
  globalThis.window = globalThis;
  globalThis.fetch = async () => { throw new Error("offline"); };
  try {
    await sendExamActivity("attempt-reconnect", "fullscreen_exited");
    let requests = 0;
    globalThis.fetch = async () => {
      requests += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return Response.json({ focusViolations: 1, autoSubmitted: false });
    };
    const [first, second] = await Promise.all([flushExamActivityQueue("attempt-reconnect"), flushExamActivityQueue("attempt-reconnect")]);
    assert.deepEqual(first, second);
    assert.equal(requests, 1);
    assert.equal(storage.getItem("jaguar-exam-events:attempt-reconnect"), null);
  } finally {
    globalThis.fetch = previous.fetch;
    globalThis.localStorage = previous.localStorage;
    globalThis.window = previous.window;
  }
});
