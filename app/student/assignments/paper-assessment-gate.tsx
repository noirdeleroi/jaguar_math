"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { startOrContinueAssignment } from "../actions";
import { flushExamActivityQueue, sendExamActivity } from "./exam-activity-client";
import { canRequestFullscreen, createFullscreenExitTracker, isFullscreenActive, requestAppFullscreen, subscribeToFullscreen } from "./fullscreen-api";
import styles from "./paper-session.module.css";

export type PaperSessionState = {
  serverNow: string;
  writingStartedAt: string | null;
  writingEndsAt: string | null;
  answersReleasedAt: string | null;
  answerEndsAt: string | null;
  answerDurationSeconds: number;
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
  const [notice, setNotice] = useState("");
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

  const writingLeft = millisecondsLeft(session.writingEndsAt, serverOffset);
  const writing = Boolean(session.writingStartedAt && writingLeft > 0);
  const writingEnded = Boolean(session.writingStartedAt && writingLeft === 0);
  const version = session.formCode?.replace(/^Version\s+/i, "") ?? "—";

  if (!waitingRoomOpen) return <section className={styles.entry}><p className="eyebrow">Paper test · Secure waiting room</p><h2>Enter fullscreen before the test begins.</h2><p>Your assigned paper version and the synchronized class timer will appear inside the waiting room. Leaving fullscreen is recorded.</p><button className="teacher-button" disabled={joining} onClick={() => void joinWaitingRoom()} type="button">{joining ? "Opening waiting room…" : "Enter fullscreen waiting room"} <span aria-hidden="true">→</span></button>{notice && <p className="notice notice-error" role="status">{notice}</p>}</section>;

  return <section aria-live="polite" className={styles.secureShell}><div className={styles.topline}><span>Jaguar Math · Paper test</span><span className={online ? styles.online : styles.offline}>{online ? "Connected" : "Offline · timer continues"}</span></div><div className={styles.waitingCard}><p className="eyebrow">Secure paper waiting room</p><h1>{writing ? "Work on your printed test." : writingEnded ? "Pens down." : "Waiting for your teacher."}</h1><p className={styles.lead}>{writing ? "Answer on paper only. The online answer sheet stays locked until writing time ends." : writingEnded ? "Stop writing and keep this page open. Your teacher will release the answer-entry window next." : "Stay in fullscreen. The class timer will start here for everyone at the same time."}</p><div className={styles.sessionGrid}><article><span>{writing ? "Writing time left" : writingEnded ? "Writing time" : "Writing time"}</span><strong>{writing ? clock(writingLeft) : writingEnded ? "00:00" : `${durationMinutes} min`}</strong></article><article><span>Assigned paper</span><strong>Version {version}</strong></article><article><span>Answer entry</span><strong>{session.answerDurationSeconds} sec</strong></article></div><div className={`${styles.phaseStatus} ${writingEnded ? styles.ready : ""}`}><i aria-hidden="true" /><div><strong>{writing ? "Writing timer is running" : writingEnded ? "Waiting for answer entry" : "Waiting for the teacher to start"}</strong><span>This page updates automatically. Do not leave fullscreen or refresh.</span></div></div><p className={styles.focusNote}>Fullscreen exits recorded: <strong>{focusViolations}</strong></p></div>{fullscreenBlocked || !fullscreenActive ? <section className={styles.blockOverlay} role="alert"><span aria-hidden="true">!</span><p className="eyebrow">Fullscreen exit recorded</p><h2>Return to fullscreen now.</h2><p>The secure waiting room is locked because fullscreen was exited. Your teacher can see the recorded interruption.</p><button className="teacher-button" disabled={joining} onClick={() => void restoreFullscreen()} ref={restoreButtonRef} type="button">{joining ? "Restoring…" : "Return to fullscreen"}</button>{notice && <small>{notice}</small>}</section> : null}</section>;
}
