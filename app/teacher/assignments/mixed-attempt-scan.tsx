"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CHOICES } from "@/lib/paper-scan-layout";
import { readingConfidence } from "@/lib/paper-scan-confidence";
import { attemptScanEvidence, correctedScanDecisions, type AttemptScan } from "@/lib/paper-scan-attempt";
import { ScanAnswerSnippet } from "./[id]/marking/scan-answer-snippet";
import styles from "./mixed-attempt-scan.module.css";

export default function MixedAttemptScan({ scan, questionId, studentAnswer }: {
  scan: AttemptScan;
  questionId: string;
  studentAnswer: string | null;
}) {
  const router = useRouter();
  const evidence = attemptScanEvidence(scan, questionId);
  const page = evidence?.page;
  const api = `/api/assignments/${scan.assignmentId}/scans`;
  const inspectionUrl = `/teacher/assignments/${scan.assignmentId}/grading${scan.sheetId ? `/${scan.sheetId}` : ""}`;
  const [preview, setPreview] = useState<{ pageId: string; url: string; approximate: boolean } | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [pending, setPending] = useState<{ questionId: string; value: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const zoom = useRef<HTMLDialogElement>(null);
  const pageId = page?.id;

  useEffect(() => {
    if (!pageId) return;
    const controller = new AbortController();
    let objectUrl: string | undefined;
    async function load() {
      try {
        const response = await fetch(`${api}?asset=${pageId}&variant=review-preview`, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error("Scan preview unavailable.");
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setPreview({ pageId: pageId!, url: objectUrl, approximate: response.headers.get("X-Scan-Preview") === "approximate" });
      } catch {
        if (!controller.signal.aborted) setUnavailable(pageId!);
      }
    }
    void load();
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [api, pageId]);

  if (!evidence || !page) return <aside className={styles.panel}><strong>Scanned answer</strong><p>No scan is available for this question.</p><Link href={inspectionUrl}>Open grading →</Link></aside>;
  const image = preview?.pageId === page.id ? preview : null;
  const confidence = readingConfidence(evidence.reading);
  const saved = studentAnswer || ((page.decisions ?? page.readings).find((r) => r.position === evidence.position)?.status === "irregular" ? "invalid" : "blank");
  const selected = pending?.questionId === questionId ? pending.value : saved;
  const disabled = busy || refreshing;

  async function save() {
    if (!page || selected === saved || disabled) return;
    const label = (value: string) => value === "blank" ? "Blank" : value === "invalid" ? "Invalid" : value;
    if (!window.confirm(`Change question ${evidence!.position} from ${label(saved)} to ${label(selected)}? This will recalculate the student's grade and record your correction.`)) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(api, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "review", pageId: page.id, revision: page.revision, reviewAction: "accept",
          decisions: correctedScanDecisions(page, evidence!.position, selected),
          note: `Teacher corrected question ${evidence!.position} from ${label(saved)} to ${label(selected)} in the student result view.`,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "The correction could not be saved.");
      setPending(null);
      setMessage("Answer corrected. Grade updated.");
      startRefresh(() => router.refresh());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The correction could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return <aside className={styles.panel} aria-label={`Scanned answer evidence for question ${evidence.position}`}>
    <div className={styles.heading}><strong>Scanned answer</strong><a href={`${api}?asset=${page.id}&variant=original`} target="_blank" rel="noreferrer">View original scan ↗</a></div>
    <div className={styles.row}>
      <div className={styles.snippet}>{image ? <ScanAnswerSnippet src={image.url} index={evidence.index} position={evidence.position} onEnlarge={() => zoom.current?.showModal()} /> : <p role="status">{unavailable === page.id ? "The snippet could not be loaded. View the original scan or open grading." : "Loading scan snippet…"}</p>}</div>
      <label className={styles.answer}>Student answer<select aria-label={`Scanned answer for question ${evidence.position}`} disabled={disabled || page.status !== "accepted"} value={selected} onChange={(event) => { setPending({ questionId, value: event.target.value }); setError(""); setMessage(""); }}>{CHOICES.map((choice) => <option key={choice} value={choice}>{choice}</option>)}<option value="blank">Blank</option><option value="invalid">Invalid</option></select></label>
      <div className={styles.confidence}><span>Recognition confidence</span><strong>{confidence === null ? "—" : `${confidence}%`}</strong></div>
      {page.status === "accepted" ? <button className="secondary-inline-button" type="button" disabled={disabled || selected === saved} onClick={() => void save()}>{disabled ? "Saving…" : "Save answer change"}</button> : null}
    </div>
    {image?.approximate ? <p className="form-note">Approximate crop: check the printed question number against the original scan.</p> : null}
    {page.status !== "accepted" ? <p>This page needs inspection. <Link href={inspectionUrl}>Review all answers in grading →</Link></p> : <small>Changes require confirmation and update the grade. The original scan is kept.</small>}
    {error ? <p className="notice notice-error" role="alert">{error} <button type="button" onClick={() => startRefresh(() => router.refresh())}>Reload latest answers</button></p> : null}
    {message ? <p role="status">{message}</p> : null}
    <dialog ref={zoom} className={styles.dialog} aria-label={`Scanned answer · Question ${evidence.position}`}><div className={styles.heading}><h3>Scanned answer · Question {evidence.position}</h3><button type="button" onClick={() => zoom.current?.close()}>Close</button></div>{image ? <ScanAnswerSnippet src={image.url} index={evidence.index} position={evidence.position} /> : null}</dialog>
  </aside>;
}
