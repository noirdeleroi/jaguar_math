"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { selectPaperVersionForAnswerEntry, startOrContinueAssignment } from "../actions";
import { flushExamActivityQueue, sendExamActivity } from "./exam-activity-client";
import { canRequestFullscreen, createFullscreenExitTracker, isFullscreenActive, requestAppFullscreen, subscribeToFullscreen } from "./fullscreen-api";
import styles from "./paper-session.module.css";

export type PaperSessionState = {
  serverNow: string;
  writingStartedAt: string | null;
  writingEndsAt: string | null;
  writingPausedAt: string | null;
  answersReleasedAt: string | null;
  answerEndsAt: string | null;
  answerDurationSeconds: number;
  paperVersionCount: number;
  paperVersionConfirmed: boolean;
  attemptId: string | null;
  attemptStatus: string | null;
  formCode: string | null;
  focusViolations: number;
};

type StatusResponse = PaperSessionState & { assignmentStatus: "published" | "closed" };

const millisecondsLeft = (endsAt: string | null, serverOffset: number) => endsAt ? Math.max(0, new Date(endsAt).getTime() - (Date.now() + serverOffset)) : 0;
const clock = (milliseconds: number) => {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
};

export default function PaperAssessmentGate({ assignmentId, durationMinutes, initialSession }: { assignmentId: string; durationMinutes: number; initialSession: PaperSessionState }) {
  const router = useRouter();
  const [session, setSession] = useState(initialSession);
  const [attemptId, setAttemptId] = useState(initialSession.attemptId);
  const [waitingRoomOpen, setWaitingRoomOpen] = useState(false);
  const [fullscreenBlocked, setFullscreenBlocked] = useState(false);
  const [joining, setJoining] = useState(false);
  const [selectingVersion, setSelectingVersion] = useState(false);
  const [notice, setNotice] = useState("");
  const [paperVersion, setPaperVersion] = useState(() => initialSession.paperVersionCount === 1 ? "1" : "");
  const [online, setOnline] = useState(true);
  const [focusViolations, setFocusViolations] = useState(initialSession.focusViolations);
  const [serverOffset, setServerOffset] = useState(() => new Date(initialSession.serverNow).getTime() - Date.now());
  const [, setTick] = useState(0);
  const restoreButtonRef = useRef<HTMLButtonElement>(null);
  const exitTracker = useRef(createFullscreenExitTracker());
  const fullscreenActive = useSyncExternalStore(subscribeToFullscreen, () => isFullscreenActive(), () => false);
  const storageKey = `jaguar-paper-waiting-room:${assignmentId}`;

  const applyActivity = useCallback((result: Awaited<ReturnType<typeof sendExamActivity>> | null) => {
    if (!result || "error" in result) return;
    setFocusViolations((current) => Math.max(current, result.focusViolations));
  }, []);

  const recordExit = useCallback((keepalive = false) => {
    if (!attemptId || !exitTracker.current.beginExit()) return;
    setFullscreenBlocked(true);
    setNotice("Fullscreen exit recorded. Return to fullscreen to keep waiting securely.");
    void sendExamActivity(attemptId, "fullscreen_exited", undefined, keepalive).then(applyActivity);
  }, [applyActivity, attemptId]);

  const joinWaitingRoom = async () => {
    if (joining) return;
    setJoining(true); setNotice("");
    try {
      if (!isFullscreenActive()) {
        if (!canRequestFullscreen() || !(await requestAppFullscreen())) throw new Error("fullscreen");
      }
      const result = await startOrContinueAssignment(assignmentId);
      if ("error" in result) { setNotice("The secure paper waiting room is not available yet. Ask your teacher for help."); return; }
      setAttemptId(result.attemptId);
      try { sessionStorage.setItem(storageKey, "armed"); } catch { /* In-memory state still protects this visit. */ }
      setWaitingRoomOpen(true);
      exitTracker.current.markRestored();
      applyActivity(await sendExamActivity(result.attemptId, "fullscreen_restored"));
      router.refresh();
    } catch {
      setNotice("Fullscreen could not open. Close browser prompts and try again.");
    } finally { setJoining(false); }
  };

  const restoreFullscreen = async () => {
    if (joining || !attemptId) return;
    setJoining(true); setNotice("");
    try {
      if (!canRequestFullscreen() || !(await requestAppFullscreen())) throw new Error("fullscreen");
      exitTracker.current.markRestored();
      const queued = await flushExamActivityQueue(attemptId); applyActivity(queued);
      const restored = await sendExamActivity(attemptId, "fullscreen_restored"); applyActivity(restored);
      if (isFullscreenActive()) setFullscreenBlocked(false);
    } catch { setNotice("Fullscreen could not be restored. Try again to continue."); }
    finally { setJoining(false); }
  };

  const confirmPaperVersion = async () => {
    if (selectingVersion) return;
    const selectedVersion = Number(paperVersion);
    if (!Number.isInteger(selectedVersion) || selectedVersion < 1 || selectedVersion > session.paperVersionCount) {
      setNotice(`Enter the version number printed on your paper (1–${session.paperVersionCount}).`);
      return;
    }
    setSelectingVersion(true); setNotice("");
    const result = await selectPaperVersionForAnswerEntry(assignmentId, selectedVersion);
    if ("error" in result) { setNotice(result.error ?? "That paper version is not available."); setSelectingVersion(false); return; }
    setAttemptId(result.attemptId);
    setSession((current) => ({ ...current, attemptId: result.attemptId, formCode: result.formCode, paperVersionConfirmed: true }));
    router.refresh();
  };

  useEffect(() => {
    try {
      if (!attemptId || sessionStorage.getItem(storageKey) !== "armed") return;
      const timer = window.setTimeout(() => setWaitingRoomOpen(true), 0);
      return () => window.clearTimeout(timer);
    } catch { /* A fresh click can reopen the room. */ }
  }, [attemptId, storageKey]);

  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync(); window.addEventListener("online", sync); window.addEventListener("offline", sync);
    return () => { window.removeEventListener("online", sync); window.removeEventListener("offline", sync); };
  }, []);

  useEffect(() => {
    if (!waitingRoomOpen || !attemptId) return;
    const fullscreen = () => { if (!isFullscreenActive()) recordExit(); };
    const visibility = () => { if (document.visibilityState === "hidden") recordExit(true); };
    const blur = () => { if (document.visibilityState === "visible" && !isFullscreenActive()) recordExit(true); };
    const pageHide = () => recordExit(true);
    if (!isFullscreenActive()) window.setTimeout(recordExit, 0);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("blur", blur);
    window.addEventListener("pagehide", pageHide);
    const unsubscribe = subscribeToFullscreen(fullscreen);
    return () => { document.removeEventListener("visibilitychange", visibility); window.removeEventListener("blur", blur); window.removeEventListener("pagehide", pageHide); unsubscribe(); };
  }, [attemptId, recordExit, waitingRoomOpen]);

  useEffect(() => {
    if (!waitingRoomOpen) return;
    let active = true;
    const refresh = async () => {
      if (!navigator.onLine || document.visibilityState !== "visible") return;
      try {
        const response = await fetch(`/api/paper-session-status?assignmentId=${encodeURIComponent(assignmentId)}`, { cache: "no-store", credentials: "same-origin" });
        if (!response.ok) return;
        const state = await response.json() as StatusResponse;
        if (!active) return;
        setServerOffset(new Date(state.serverNow).getTime() - Date.now());
        setSession(state);
        setFocusViolations((current) => Math.max(current, state.focusViolations));
        if (state.assignmentStatus === "closed" || state.attemptStatus === "submitted" || state.answersReleasedAt) router.refresh();
      } catch { /* The visible timer continues from its last server synchronization. */ }
    };
    const timer = window.setInterval(() => void refresh(), 2_000);
    window.addEventListener("online", refresh);
    void refresh();
    return () => { active = false; window.clearInterval(timer); window.removeEventListener("online", refresh); };
  }, [assignmentId, router, waitingRoomOpen]);

  useEffect(() => {
    if (!waitingRoomOpen) return;
    const timer = window.setInterval(() => setTick((value) => value + 1), 250);
    return () => window.clearInterval(timer);
  }, [waitingRoomOpen]);

  useEffect(() => {
    if (!fullscreenBlocked) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.setTimeout(() => restoreButtonRef.current?.focus(), 0);
    return () => { document.body.style.overflow = previousOverflow; };
  }, [fullscreenBlocked]);

  const writingLeft = session.writingPausedAt && session.writingEndsAt
    ? Math.max(0, new Date(session.writingEndsAt).getTime() - new Date(session.writingPausedAt).getTime())
    : millisecondsLeft(session.writingEndsAt, serverOffset);
  const writingPaused = Boolean(session.writingStartedAt && session.writingPausedAt && writingLeft > 0);
  const writing = Boolean(session.writingStartedAt && !writingPaused && writingLeft > 0);
  const writingEnded = Boolean(session.writingStartedAt && !writingPaused && writingLeft === 0);
  const version = session.formCode?.replace(/^Version\s+/i, "") ?? "—";

  if (!waitingRoomOpen) return <section className={styles.entry}><p className="eyebrow">Paper test · Secure waiting room</p><h2>Enter fullscreen before the test begins.</h2><p>Your synchronized class timer will appear inside the waiting room. You will enter the version printed on your paper when the final answer page opens.</p><button className="teacher-button" disabled={joining} onClick={() => void joinWaitingRoom()} type="button">{joining ? "Opening waiting room…" : "Enter fullscreen waiting room"} <span aria-hidden="true">→</span></button>{notice && <p className="notice notice-error" role="status">{notice}</p>}</section>;

  if (session.answersReleasedAt && !session.paperVersionConfirmed) return <section aria-live="polite" className={styles.secureShell}><div className={styles.topline}><span>Jaguar Math · Paper answer entry</span><span className={online ? styles.online : styles.offline}>{online ? "Connected" : "Offline · reconnect to continue"}</span></div><div className={styles.versionStage}><p className="eyebrow">Final answer page · Step 1 of 2</p><h1>Enter your paper version.</h1><p className={styles.lead}>Find the version number printed on your test. Jaguar will load that version&apos;s answer sheet and mark it with the matching answer key.</p><form className={styles.versionForm} onSubmit={(event) => { event.preventDefault(); void confirmPaperVersion(); }}><label htmlFor={`paper-version-${assignmentId}`}>Version number <small>Printed on your test · 1–{session.paperVersionCount}</small></label><input autoFocus autoComplete="off" id={`paper-version-${assignmentId}`} inputMode="numeric" max={session.paperVersionCount} min={1} name="paper_version" onChange={(event) => setPaperVersion(event.target.value)} pattern="[0-9]*" required type="number" value={paperVersion} /><button className="teacher-button" disabled={selectingVersion} type="submit">{selectingVersion ? "Loading answer sheet…" : "Continue to all answers"} <span aria-hidden="true">→</span></button></form>{notice && <p className={styles.versionError} role="alert">{notice}</p>}<p className={styles.focusNote}>Next: enter every answer in order. Fullscreen exits recorded: <strong>{focusViolations}</strong></p></div>{fullscreenBlocked || !fullscreenActive ? <section className={styles.blockOverlay} role="alert"><span aria-hidden="true">!</span><p className="eyebrow">Fullscreen exit recorded</p><h2>Return to fullscreen now.</h2><p>Version selection and answer entry are locked while fullscreen is off.</p><button className="teacher-button" disabled={joining} onClick={() => void restoreFullscreen()} ref={restoreButtonRef} type="button">{joining ? "Restoring…" : "Return to fullscreen"}</button>{notice && <small>{notice}</small>}</section> : null}</section>;

  return <section aria-live="polite" className={styles.secureShell}><div className={styles.topline}><span>Jaguar Math · Paper test</span><span className={online ? styles.online : styles.offline}>{online ? "Connected" : writingPaused ? "Offline · timer remains paused" : "Offline · timer continues"}</span></div><div className={styles.waitingCard}><p className="eyebrow">Secure paper waiting room</p><h1>{writingPaused ? "Writing is paused." : writing ? "Work on your printed test." : writingEnded ? "Pens down." : "Waiting for your teacher."}</h1><p className={styles.lead}>{writingPaused ? "Stop writing. Your teacher has paused the class timer; it will continue from the same time when resumed." : writing ? "Answer on paper only. The online answer sheet stays locked until writing time ends." : writingEnded ? "Stop writing and keep this page open. Your teacher will release the answer-entry window next." : "Stay in fullscreen. The class timer will start here for everyone at the same time."}</p><div className={styles.sessionGrid}><article><span>{writingPaused ? "Writing time paused" : writing ? "Writing time left" : writingEnded ? "Writing time" : "Writing time"}</span><strong>{writing || writingPaused ? clock(writingLeft) : writingEnded ? "00:00" : `${durationMinutes} min`}</strong></article><article><span>Paper version</span><strong>{session.paperVersionConfirmed ? `Version ${version}` : "Enter with answers"}</strong></article><article><span>Answer entry</span><strong>{session.answerDurationSeconds} sec</strong></article></div><div className={`${styles.phaseStatus} ${writingEnded || writingPaused ? styles.ready : ""}`}><i aria-hidden="true" /><div><strong>{writingPaused ? "Timer paused · stop writing" : writing ? "Writing timer is running" : writingEnded ? "Waiting for answer entry" : "Waiting for the teacher to start"}</strong><span>This page updates automatically. Do not leave fullscreen or refresh.</span></div></div><p className={styles.focusNote}>Fullscreen exits recorded: <strong>{focusViolations}</strong></p></div>{fullscreenBlocked || !fullscreenActive ? <section className={styles.blockOverlay} role="alert"><span aria-hidden="true">!</span><p className="eyebrow">Fullscreen exit recorded</p><h2>Return to fullscreen now.</h2><p>The secure waiting room is locked because fullscreen was exited. Your teacher can see the recorded interruption.</p><button className="teacher-button" disabled={joining} onClick={() => void restoreFullscreen()} ref={restoreButtonRef} type="button">{joining ? "Restoring…" : "Return to fullscreen"}</button>{notice && <small>{notice}</small>}</section> : null}</section>;
}
