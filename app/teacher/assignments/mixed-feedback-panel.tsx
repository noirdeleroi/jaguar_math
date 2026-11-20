"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FeedbackSummary } from "@/lib/mixed-feedback";
import styles from "./mixed-feedback.module.css";

export default function MixedFeedbackPanel({ assignmentId }: { assignmentId: string }) {
  const [summary, setSummary] = useState<FeedbackSummary | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [progress, setProgress] = useState<{ done: number; total: number; sent: number; failed: number } | null>(null);
  const stop = useRef(false), running = useRef(false);
  const endpoint = `/api/assignments/${assignmentId}/feedback`;
  const readSummary = useCallback(async () => {
    const response = await fetch(endpoint, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Feedback could not be loaded.");
    return result as FeedbackSummary;
  }, [endpoint]);
  async function refresh() { const result = await readSummary(); setSummary(result); return result; }
  useEffect(() => {
    let mounted = true;
    void readSummary().then(result => { if (mounted) setSummary(result); }).catch(e => { if (mounted) setError(e instanceof Error ? e.message : "Feedback could not be loaded."); });
    return () => { mounted = false; stop.current = true; };
  }, [readSummary]);
  async function send() {
    if (running.current) return;
    running.current = true; stop.current = false; setBusy(true); setError("");
    try {
      const current = await refresh();
      const next = { done: 0, total: current.ready.length, sent: 0, failed: 0 };
      setProgress({ ...next });
      for (const sheetId of current.ready) {
        if (stop.current) break;
        const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sheetId }), signal: AbortSignal.timeout(75_000) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Email delivery stopped. Refresh to check progress.");
        next.done++;
        if (result.outcome === "sent") next.sent++;
        if (["failed", "uncertain"].includes(result.outcome)) { next.failed++; setError(result.error || "Some emails need another check."); }
        setProgress({ ...next });
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Delivery stopped. Refresh to check progress."); }
    finally {
      await refresh().catch(() => setError("Refresh this page to check the latest delivery status."));
      running.current = false; setBusy(false);
    }
  }
  const count = summary?.ready.length ?? 0;
  return <section className={`teacher-section ${styles.panel}`} aria-label="Student feedback emails">
    <div className={styles.heading}><div><p className="eyebrow">Personal feedback</p><h2>Email marked test feedback</h2>
      <p>Each student gets their score out of 10, their own question paper, their scanned answer sheet, and an answer check showing what to revise.</p></div>
      <span className={styles.badge}>{summary ? `${summary.graded} marked` : "Loading…"}</span></div>
    {summary && <div className={styles.counts}><span><strong>{count}</strong> ready to email</span><span><strong>{summary.sent}</strong> already emailed</span>
      <span>Awaiting scans and needs-attention papers are excluded.</span></div>}
    <p className={styles.note}>Sends to all marked students across this assignment&apos;s classes. Students already emailed are skipped. Keep this page open while sending.</p>
    <div className={styles.actions}>
      <button className="teacher-button" type="button" disabled={busy || !count || !summary?.gmailConnected} onClick={() => void send()}>
        {busy ? `Emailing feedback… ${progress?.done ?? 0}/${progress?.total ?? count}` : `Email feedback to ${count} marked student${count === 1 ? "" : "s"}`}
      </button>
      {busy ? <button className="secondary-inline-button" type="button" onClick={() => { stop.current = true; }}>Pause after this student</button>
        : <button className="secondary-inline-button" type="button" onClick={() => { setError(""); void refresh().catch(e => setError(e.message)); }}>Refresh status</button>}
      {summary?.previewSheetId && <a className="secondary-inline-button" href={`${endpoint}?preview=${summary.previewSheetId}`} target="_blank" rel="noreferrer">Preview a student&apos;s feedback PDF ↗</a>}
    </div>
    <div role="status" aria-live="polite">{progress && <p className={styles.note}>{busy ? "Sending" : "Finished this batch"}: {progress.sent} emailed{progress.failed ? ` · ${progress.failed} need checking` : ""}{!busy && progress.done < progress.total ? ` · ${progress.total - progress.done} not processed` : ""}.</p>}</div>
    {summary && !summary.gmailConnected && <p className="notice notice-error">Connect Google to send feedback from your Gmail account. <a href="/api/google/connect">Connect Google</a></p>}
    {summary && summary.excluded > 0 && <p className={styles.note}>{summary.excluded} marked student(s) need a valid email address.</p>}
    {summary && summary.processing > 0 && <p className={styles.note}>{summary.processing} email(s) are being processed. Refresh shortly to check their status.</p>}
    {summary && summary.uncertain > 0 && <p className="notice notice-error">{summary.uncertain} email(s) have unconfirmed delivery. Check Gmail Sent mail; these are held to prevent duplicate emails.</p>}
    {error && <p className="notice notice-error" role="alert">{error}</p>}
  </section>;
}
