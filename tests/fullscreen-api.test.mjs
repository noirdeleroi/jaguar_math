import assert from "node:assert/strict";
import test from "node:test";
import {
  canRequestFullscreen,
  createFullscreenExitTracker,
  getFullscreenElement,
  isFullscreenActive,
  requestAppFullscreen,
  subscribeToFullscreen,
} from "../app/student/assignments/fullscreen-api.ts";
import { canStartExamFromWaitingRoom, resolveExamRunnerAttempt, restoreFullscreenBeforeVerification } from "../app/student/assignments/exam-mode-attempt.ts";

test("keeps a started attempt mounted so its runner can count fullscreen exits", () => {
  const startedAttempt = { id: "attempt-1" };
  assert.equal(resolveExamRunnerAttempt(undefined, startedAttempt), startedAttempt);
});

test("keeps the waiting-room start button locked until teacher release", () => {
  const waiting = { questionsReleased: false, requireFullscreen: true, fullscreenActive: true, waitingRoomViolation: false, starting: false };
  assert.equal(canStartExamFromWaitingRoom(waiting), false);
  assert.equal(canStartExamFromWaitingRoom({ ...waiting, questionsReleased: true }), true);
  assert.equal(canStartExamFromWaitingRoom({ ...waiting, questionsReleased: true, fullscreenActive: false }), false);
});

test("counts every restored exit while deduplicating signals from one exit", () => {
  const tracker = createFullscreenExitTracker();
  let exits = 0;
  for (let incident = 0; incident < 3; incident += 1) {
    if (tracker.beginExit()) exits += 1;
    if (tracker.beginExit()) exits += 1; // blur + visibility + fullscreenchange
    tracker.markRestored();
  }
  assert.equal(exits, 3);
});

test("recognizes both standard and WebKit fullscreen elements", () => {
  const standardElement = {};
  const webkitElement = {};
  assert.equal(getFullscreenElement({ fullscreenElement: standardElement }), standardElement);
  assert.equal(getFullscreenElement({ fullscreenElement: null, webkitFullscreenElement: webkitElement }), webkitElement);
  assert.equal(isFullscreenActive({ fullscreenElement: null, webkitFullscreenElement: null }), false);
});

test("subscribes to and cleans up both fullscreen change events", () => {
  const documentTarget = new EventTarget();
  let calls = 0;
  const unsubscribe = subscribeToFullscreen(() => { calls += 1; }, documentTarget);
  documentTarget.dispatchEvent(new Event("fullscreenchange"));
  documentTarget.dispatchEvent(new Event("webkitfullscreenchange"));
  assert.equal(calls, 2);
  unsubscribe();
  documentTarget.dispatchEvent(new Event("fullscreenchange"));
  assert.equal(calls, 2);
});

test("requests fullscreen through the WebKit fallback used by iPad Safari", async () => {
  const documentTarget = { fullscreenElement: null, webkitFullscreenElement: null };
  const element = {
    ownerDocument: documentTarget,
    webkitRequestFullscreen() { documentTarget.webkitFullscreenElement = element; },
  };
  assert.equal(canRequestFullscreen(element), true);
  assert.equal(await requestAppFullscreen(element), true);
  assert.equal(isFullscreenActive(documentTarget), true);
});

test("restores fullscreen before waiting for network verification", async () => {
  const order = [];
  const recovery = await restoreFullscreenBeforeVerification(
    async () => { order.push("fullscreen"); return true; },
    async () => { order.push("network"); return "verified"; },
  );
  assert.deepEqual(order, ["fullscreen", "network"]);
  assert.deepEqual(recovery, { restored: true, result: "verified" });
});
