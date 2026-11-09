"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { GradingRoster } from "./grading-roster";
import {
  averageConfidence,
  readingConfidence,
} from "@/lib/paper-scan-confidence";
import {
  bubblePosition,
  CHOICES,
  pageQuestions,
  QUESTIONS_PER_PAGE,
  printedScanChoice,
  scanPaperLabel,
  type BubbleReading,
  type ScanQuestion,
} from "@/lib/paper-scan-layout";
import type { PageRow, ScanWorkspace, SheetRow } from "@/lib/paper-scan-types";
import styles from "./scan-marking.module.css";
import { scanPageResults } from "@/lib/paper-scan-results";

type Decision = BubbleReading & { resolved: boolean };
type Filter = "all" | "pending" | "graded" | "review";
const empty: ScanWorkspace = {
  sheets: [],
  batches: [],
  pages: [],
  grades: [],
  keys: {},
  audit: [],
};
export default function ScanMarkingWorkspace({
  assignmentId,
  archived,
  view = "setup",
  initialSheetId,
}: {
  assignmentId: string;
  archived: boolean;
  view?: "setup" | "grading";
  initialSheetId?: string;
}) {
  const api = `/api/assignments/${assignmentId}/scans`;
  const papers = `/api/assignments/${assignmentId}/papers.pdf`;
  const [data, setData] = useState<ScanWorkspace>(empty);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [classId, setClassId] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const running = useRef(false);
  const pause = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const load = useCallback(async () => {
    const response = await fetch(api, { cache: "no-store" });
    const value = await response.json();
    if (!response.ok)
      throw new Error(value.error ?? "Workspace could not be loaded.");
    setData(value);
    setLoaded(true);
    return value as ScanWorkspace;
  }, [api]);
  useEffect(() => {
    if (view !== "grading" || initialSheetId) return;
    let inFlight = false;
    const timer = window.setInterval(async () => {
      if (inFlight || document.visibilityState !== "visible") return;
      inFlight = true;
      try {
        await load();
      } catch {
        /* Keep the last loaded roster during a network interruption. */
      } finally {
        inFlight = false;
      }
    }, 10000);
    return () => window.clearInterval(timer);
  }, [view, initialSheetId, load]);
  const mutate = useCallback(
    async (body: Record<string, unknown>) => {
      const response = await fetch(api, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error ?? "Scan action failed.");
      return value;
    },
    [api],
  );
  useEffect(() => {
    const controller = new AbortController();
    fetch(api, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const value = await response.json();
        if (!response.ok)
          throw new Error(value.error ?? "Workspace could not be loaded.");
        if (!controller.signal.aborted) {
          setData(value);
          setLoaded(true);
        }
      })
      .catch((e: Error) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => {
      controller.abort();
      pause.current = true;
    };
  }, [api]);
  const processBatch = async (batchId: string) => {
    let done = false;
    while (!done && !pause.current) {
      const result = await mutate({ action: "process", batchId });
      done = result.done;
      setProgress(
        `Recognized page ${result.processed ?? ""} of ${result.total ?? ""}`,
      );
      await load();
    }
  };
  const run = async (work: () => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    pause.current = false;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
      setNotice(
        pause.current
          ? "Paused. Completed pages are saved; resume whenever you are ready."
          : "Batch finished. Finalized grades are saved in class management; flagged papers are ready for review.",
      );
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Processing stopped. Your completed pages are saved.",
      );
    } finally {
      running.current = false;
      setBusy(false);
      setProgress("");
      await load().catch(() => {});
    }
  };
  const upload = (files: File[]) =>
    run(async () => {
      for (const file of files) {
        if (pause.current) break;
        const ext = file.name.split(".").pop()?.toLowerCase();
        const mime =
          ext === "pdf"
            ? "application/pdf"
            : ext === "png"
              ? "image/png"
              : ["jpg", "jpeg"].includes(ext ?? "")
                ? "image/jpeg"
                : "";
        if (!mime || file.size > 50 * 1024 * 1024)
          throw new Error(
            `${file.name}: choose a PDF, PNG or JPEG up to 50 MB.`,
          );
        setProgress(`Uploading ${file.name}`);
        const bytes = await file.arrayBuffer();
        const digest = await crypto.subtle.digest("SHA-256", bytes);
        const hash = [...new Uint8Array(digest)]
          .map((n) => n.toString(16).padStart(2, "0"))
          .join("");
        const registered = await mutate({
          action: "register",
          name: file.name,
          size: file.size,
          hash,
          mime,
        });
        if (registered.uploadUrl) {
          const uploaded = await fetch(registered.uploadUrl, {
            method: "PUT",
            headers: {
              "Content-Type": mime,
              "x-upsert": "false",
              "cache-control": "max-age=0",
            },
            body: file,
          });
          if (!uploaded.ok && uploaded.status !== 409) {
            const value = await uploaded.json().catch(() => ({}));
            // An earlier interrupted upload may have finished before the tab closed.
            if (value.error !== "Duplicate" && value.statusCode !== "409")
              throw new Error(
                `${file.name}: upload failed. Select the file again to retry.`,
              );
          }
          await mutate({ action: "uploaded", batchId: registered.batchId });
        }
        await processBatch(registered.batchId);
      }
    });
  const sheetStatus = (sheet: SheetRow): Filter => {
    const grade = data.grades.find(
      (g) => g.id === sheet.attempt_id && g.status === "submitted",
    );
    if (grade) return "graded";
    return data.pages.some(
      (p) => p.sheet_id === sheet.id && p.status === "review",
    )
      ? "review"
      : "pending";
  };
  const counts = { graded: 0, pending: 0, review: 0 };
  for (const sheet of data.sheets)
    counts[sheetStatus(sheet) as keyof typeof counts]++;
  const inactive = data.pages.filter((p) =>
    ["rejected", "duplicate"].includes(p.status),
  ).length;
  const unidentified = data.pages.filter((p) => p.status === "unidentified");
  const availablePages = data.pages.filter(
    (p) => !initialSheetId || p.sheet_id === initialSheetId,
  );
  const selectedId =
    selected ??
    availablePages.find((p) => p.status === "review")?.id ??
    availablePages.find((p) => p.status === "accepted")?.id ??
    availablePages[0]?.id;
  const selectedPage = data.pages.find((p) => p.id === selectedId);
  const detailSheet = data.sheets.find((sheet) => sheet.id === initialSheetId);
  const detailPages = availablePages
    .filter((p) => ["accepted", "review"].includes(p.status))
    .sort((a, b) => (a.sheet_page ?? 0) - (b.sheet_page ?? 0));
  const ordered = [...data.sheets].sort(
    (a, b) =>
      a.class_name.localeCompare(b.class_name) ||
      a.student_name.localeCompare(b.student_name),
  );
  const nextSheet =
    ordered[
      (ordered.findIndex((s) => s.id === initialSheetId) + 1) % ordered.length
    ];
  const confidence = averageConfidence(
    data.pages
      .filter((p) => ["accepted", "review"].includes(p.status))
      .flatMap((p) => p.readings),
  );
  let checked = 0,
    agreed = 0;
  for (const page of data.pages)
    if (page.decisions)
      for (const reading of page.readings) {
        const detected = reading.choice ?? reading.candidateChoice ?? null;
        const decision = page.decisions.find(
          (r) => r.position === reading.position,
        );
        if (
          !decision ||
          (!detected && reading.status !== "blank") ||
          !(
            decision.reviewed ||
            (decision.reviewed === undefined &&
              !reading.resolved &&
              reading.status !== "clear")
          )
        )
          continue;
        checked++;
        if (decision.choice === detected) agreed++;
      }
  const oldScans = data.pages.filter(
    (p) =>
      p.status === "review" &&
      p.decisions === null &&
      !p.problem &&
      p.algorithm !== "jm-omr-1.2" &&
      !data.audit.some(
        (a) => a.page_id === p.id && a.event.startsWith("manual_"),
      ),
  );
  const pdf = `/api/assignments/${assignmentId}/answer-sheets.pdf`;
  return (
    <div className={styles.workspace}>
      {!loaded && <p role="status">Loading student papers…</p>}
      <nav className={styles.flowNav} aria-label="Mixed Test workflow">
        <Link
          href={`/teacher/assignments/${assignmentId}/marking`}
          aria-current={view === "setup" ? "page" : undefined}
        >
          1 · Print & upload
        </Link>
        <Link
          href={`/teacher/assignments/${assignmentId}/grading`}
          aria-current={view === "grading" ? "page" : undefined}
        >
          2 · Grades & confidence
        </Link>
      </nav>
      {error && (
        <p className="notice notice-error" role="alert">
          {error}{" "}
          <button
            onClick={() => {
              setError("");
              load().catch((e: Error) => setError(e.message));
            }}
            type="button"
          >
            Refresh
          </button>
        </p>
      )}
      {notice && (
        <p className="notice notice-success" role="status">
          {notice}
        </p>
      )}
      {archived && (
        <p className="notice">
          This assessment is archived. Restore it to upload or review papers.
        </p>
      )}
      {view === "grading" && !initialSheetId && (
        <>
          <section aria-label="Marking progress" className={styles.metrics}>
            {(
              [
                ["graded", counts.graded, "Graded"],
                ["pending", counts.pending, "Awaiting scans"],
                ["review", counts.review, "Needs attention"],
              ] as const
            ).map(([key, count, label]) => (
              <button
                aria-pressed={filter === key}
                key={key}
                onClick={() => setFilter(filter === key ? "all" : key)}
              >
                <strong>{count}</strong>
                <span>{label}</span>
              </button>
            ))}
            <div>
              <strong>{confidence === null ? "—" : confidence + "%"}</strong>
              <span>Recognition confidence</span>
            </div>
            <div>
              <strong>
                {checked ? Math.round((agreed / checked) * 100) + "%" : "—"}
              </strong>
              <span>Teacher agreement · {checked} checked answers</span>
            </div>
          </section>
        </>
      )}
      {view === "setup" && (
        <>
          <section className={`teacher-section ${styles.printUpload}`}>
            <div>
              <p className="eyebrow">1 · Print your test</p>
              <h2>Individual question papers & QR sheets</h2>
              <label>
                Print for class
                <select
                  value={classId}
                  onChange={(e) => setClassId(e.target.value)}
                >
                  <option value="">All classes</option>
                  {[
                    ...new Map(
                      data.sheets.map((s) => [s.class_id, s.class_name]),
                    ).entries(),
                  ].map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              {classId && (
                <a
                  className="secondary-inline-button"
                  href={`${papers}?classId=${classId}`}
                >
                  Download class packets
                </a>
              )}
              <p>
                Each new paper mixes question variants and shuffles A/B/C/D for
                that student. Download packets to print each student&apos;s
                named question paper followed by their matching QR answer sheet.
                Print at 100%, single-sided. Scan only the answer sheets at
                200–300 dpi with all four squares visible.
              </p>
              <div className={styles.actions}>
                <a className="teacher-button" href={papers}>
                  Download all student packets
                </a>
                <a
                  className="secondary-inline-button"
                  href={`${papers}?kind=questions`}
                >
                  Student question papers
                </a>
                <a className="secondary-inline-button" href={pdf}>
                  Answer sheets only
                </a>
                <a className={styles.textLink} href={`${papers}?kind=key`}>
                  Teacher key (private)
                </a>
              </div>
              <small>
                Student PDFs contain no solutions. Names, classes and paper IDs
                match on both parts. Reprints keep the same questions and
                choices.
              </small>
            </div>
            <div>
              <p className="eyebrow">2 · Scan & upload</p>
              <h2>Mark a batch, any size</h2>
              <p>
                PDFs, PNGs or JPEGs. Select several files or drop them here. Up
                to 50 MB and 200 pages per file; classes can be mixed.
              </p>
              <div
                className={styles.dropzone}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (!busy && !archived)
                    void upload(Array.from(e.dataTransfer.files));
                }}
              >
                <input
                  ref={input}
                  aria-label="Upload scanned answer sheets"
                  accept=".pdf,.png,.jpg,.jpeg"
                  disabled={busy || archived}
                  multiple
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? []);
                    e.target.value = "";
                    if (files.length) void upload(files);
                  }}
                  type="file"
                />
                <span>
                  Original files and grading decisions are preserved privately.
                </span>
              </div>
              {busy && (
                <div role="status">
                  <p>{progress || "Processing…"}</p>
                  <button
                    className="secondary-inline-button"
                    onClick={() => {
                      pause.current = true;
                      setProgress("Pausing after the current page…");
                    }}
                  >
                    Pause after this page
                  </button>
                </div>
              )}
              <small>
                Keep this page open during processing. Closing it is safe:
                resume unfinished batches below.
              </small>
            </div>
          </section>
          <div className={styles.gradingCallout}>
            <strong>
              {counts.graded} graded · {counts.review} need attention ·{" "}
              {counts.pending} awaiting scans
            </strong>
            <Link
              className="teacher-button"
              href={`/teacher/assignments/${assignmentId}/grading`}
            >
              Open grading dashboard →
            </Link>
          </div>
        </>
      )}
      {view === "grading" && !initialSheetId && (
        <>
          <GradingRoster
            data={data}
            assignmentId={assignmentId}
            classId={classId}
            setClassId={setClassId}
            filter={filter}
            setFilter={setFilter}
          />
          {oldScans.length > 0 && (
            <section className="teacher-section">
              <h2>Earlier scans awaiting grading</h2>
              <p>
                Apply updated recognition to saved scans. Teacher corrections
                and grade holds are preserved.
              </p>
              <button
                className="teacher-button"
                disabled={busy || archived}
                onClick={() =>
                  run(async () => {
                    for (const page of oldScans) {
                      if (pause.current) break;
                      setProgress("Regrading saved scans…");
                      await mutate({
                        action: "reprocess",
                        pageId: page.id,
                        revision: page.revision,
                      });
                      await load();
                    }
                  })
                }
              >
                Automatically grade saved scans ({oldScans.length})
              </button>
            </section>
          )}
          {unidentified.length > 0 && (
            <section className="teacher-section">
              <h2>Student identification needed</h2>
              <p>{unidentified.length} pages have no readable student QR.</p>
              {unidentified.map((p) => (
                <button
                  className="secondary-inline-button"
                  key={p.id}
                  onClick={() => setSelected(p.id)}
                >
                  Source page {p.source_page} · Identify student
                </button>
              ))}
            </section>
          )}
        </>
      )}
      {view === "grading" && initialSheetId && (
        <div className={styles.actions}>
          <Link
            className="secondary-inline-button"
            href={`/teacher/assignments/${assignmentId}/grading`}
          >
            All students
          </Link>
          {nextSheet && nextSheet.id !== initialSheetId && (
            <Link
              className="secondary-inline-button"
              href={`/teacher/assignments/${assignmentId}/grading/${nextSheet.id}`}
            >
              Next student →
            </Link>
          )}
          {detailPages.map((p) => (
            <button
              className="secondary-inline-button"
              aria-pressed={selectedId === p.id}
              onClick={() => setSelected(p.id)}
              key={p.id}
            >
              Page {p.sheet_page} ·{" "}
              {p.status === "accepted" ? "Graded" : "Needs attention"}
            </button>
          ))}
        </div>
      )}
      {view === "grading" &&
        (initialSheetId || selectedPage?.status === "unidentified") && (
          <div>
            <section className={`teacher-section ${styles.review}`}>
              <p className="eyebrow">Student answers · inspect or edit</p>
              {selectedPage ? (
                <PaperReview
                  key={`${selectedPage.id}-${selectedPage.revision}`}
                  page={selectedPage}
                  data={data}
                  api={api}
                  disabled={archived}
                  retry={async () => {
                    await mutate({
                      action: "reprocess",
                      pageId: selectedPage.id,
                      revision: selectedPage.revision,
                    });
                    await load();
                  }}
                  save={async (payload) => {
                    await mutate({ action: "review", ...payload });
                    await load();
                    setNotice(
                      "Review saved. The student's grade is updated only when every required page is accepted.",
                    );
                  }}
                />
              ) : (
                <div className={styles.emptyReview}>
                  <h2>{detailSheet?.student_name ?? "Ready to review"}</h2>
                  <p>
                    Choose a student&apos;s page to see the original scan,
                    recognized answers, and any choices that need attention.
                  </p>
                  <p>
                    Clear single marks and blanks grade automatically. Only
                    genuinely ambiguous marks, unreadable identities or
                    alignment failures need attention.
                  </p>
                </div>
              )}
            </section>
          </div>
        )}
      {view === "setup" && (
        <>
          <section className="teacher-section">
            <div className="section-row">
              <div>
                <p className="eyebrow">Saved processing state</p>
                <h2>Uploads & retries</h2>
              </div>
              <div className={styles.actions}>
                <a
                  className="secondary-inline-button"
                  href={`/api/assignments/${assignmentId}/scan-results.csv`}
                >
                  Export detailed results
                </a>
                <a
                  className="secondary-inline-button"
                  href={`/teacher/assignments/${assignmentId}/results.csv`}
                >
                  Export grades
                </a>
              </div>
            </div>
            {!data.batches.length && (
              <p>
                Upload your first completed paper to begin. Other students stay
                pending.
              </p>
            )}
            <div className={styles.batches}>
              {data.batches.map((b) => (
                <article key={b.id}>
                  <div>
                    <strong>{b.file_name}</strong>
                    <small>
                      {b.status} · {b.next_page - 1}
                      {b.page_count ? ` / ${b.page_count}` : ""} pages processed
                      {b.duplicate_uploads
                        ? ` · ${b.duplicate_uploads} repeat upload(s)`
                        : ""}
                    </small>
                    {b.error && <p role="alert">{b.error}</p>}
                    {b.status === "uploading" && (
                      <p>
                        Upload interrupted: choose the same file again to
                        finish.
                      </p>
                    )}
                  </div>
                  <div className={styles.actions}>
                    {!["uploading", "complete"].includes(b.status) && (
                      <button
                        className="teacher-button"
                        disabled={busy || archived}
                        onClick={() => run(() => processBatch(b.id))}
                      >
                        Resume / retry
                      </button>
                    )}
                    <a
                      className={styles.textLink}
                      href={`${api}?asset=${b.id}&variant=source`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Original file
                    </a>
                  </div>
                </article>
              ))}
            </div>
            {inactive > 0 && (
              <details>
                <summary>Rejected and duplicate scans ({inactive})</summary>
                <div className={styles.actions}>
                  {data.pages
                    .filter((p) => ["rejected", "duplicate"].includes(p.status))
                    .map((p) => (
                      <button
                        className="secondary-inline-button"
                        key={p.id}
                        onClick={() => setSelected(p.id)}
                      >
                        {p.status} · source page {p.source_page}
                      </button>
                    ))}
                </div>
              </details>
            )}
          </section>
        </>
      )}
      {view === "grading" && !initialSheetId && (
        <details className="teacher-section">
          <summary>Class statistics & audit history</summary>
          <ScanStatistics data={data} classId={classId} />
          <section className="teacher-section">
            <h2>Audit history</h2>
            <a className="secondary-inline-button" href={`${api}?audit=1`}>
              Export complete audit history
            </a>
            <p className="form-note">
              Latest 100 events. The complete history is retained with the
              original scans.
            </p>
            <div className={styles.audit}>
              {data.audit.map((a) => (
                <div key={a.id}>
                  <time>{new Date(a.created_at).toLocaleString()}</time>
                  <strong>
                    {a.event === "recognized"
                      ? a.detail.status === "unidentified"
                        ? "Identification failed"
                        : "Scan processed"
                      : a.event.replaceAll("_", " ")}
                  </strong>
                  <span>
                    {data.sheets.find((s) => s.id === a.sheet_id)
                      ?.student_name ?? "Unidentified scan"}
                  </span>
                  {typeof a.detail.note === "string" && (
                    <small>{a.detail.note}</small>
                  )}
                </div>
              ))}
            </div>
          </section>
        </details>
      )}
    </div>
  );
}

function PaperReview({
  page,
  data,
  api,
  disabled,
  save,
  retry,
}: {
  page: PageRow;
  data: ScanWorkspace;
  api: string;
  disabled: boolean;
  save: (payload: Record<string, unknown>) => Promise<void>;
  retry: () => Promise<void>;
}) {
  const originalSheet = data.sheets.find((s) => s.id === page.sheet_id);
  const [sheetId, setSheetId] = useState(originalSheet?.id ?? "");
  const [sheetPage, setSheetPage] = useState(page.sheet_page ?? 1);
  const sheet = data.sheets.find((s) => s.id === sheetId);
  const questions = sheet ? pageQuestions(sheet.questions, sheetPage) : [];
  const unidentified = ["unidentified", "rejected", "duplicate"].includes(
    page.status,
  );
  const initial = page.decisions ?? page.readings;
  const [decisions, setDecisions] = useState<Decision[]>(() =>
    initial.map((r) => ({
      ...r,
      resolved: Boolean(r.resolved || (!page.problem && r.status === "clear")),
    })),
  );
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [images, setImages] = useState({ original: "", aligned: "" });
  const [showOriginal, setShowOriginal] = useState(false);
  const [showAll, setShowAll] = useState(true);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const urls: string[] = [];
    async function image(variant: string) {
      const response = await fetch(
        `${api}?asset=${page.id}&variant=${variant}`,
        { signal: controller.signal, cache: "no-store" },
      );
      if (!response.ok) throw new Error("Scan preview could not be loaded.");
      const url = URL.createObjectURL(await response.blob());
      urls.push(url);
      return url;
    }
    Promise.all([
      image("original"),
      page.normalized_path ? image("aligned") : Promise.resolve(""),
    ])
      .then(([original, aligned]) => {
        if (!controller.signal.aborted) setImages({ original, aligned });
      })
      .catch((e: Error) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => {
      controller.abort();
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [api, page.id, page.normalized_path]);
  const reset = (nextSheet: string, nextPage: number) => {
    setDirty(true);
    setSheetId(nextSheet);
    setSheetPage(nextPage);
    const s = data.sheets.find((s) => s.id === nextSheet);
    setDecisions(
      s
        ? pageQuestions(s.questions, nextPage).map((q) => ({
            position: q.position,
            choice: null,
            status: "unreadable",
            densities: [],
            resolved: false,
          }))
        : [],
    );
    setShowAll(true);
  };
  const decide = (position: number, choice: string) => {
    setDirty(true);
    setDecisions((current) =>
      current.map((r) =>
        r.position === position
          ? {
              ...r,
              choice: CHOICES.includes(choice as (typeof CHOICES)[number])
                ? (choice as (typeof CHOICES)[number])
                : null,
              status:
                choice === "blank"
                  ? "blank"
                  : choice === "invalid"
                    ? "irregular"
                    : "clear",
              resolved: true,
              reviewed: true,
            }
          : r,
      ),
    );
  };
  const remaining = questions.filter(
    (q) => !decisions.find((r) => r.position === q.position)?.resolved,
  ).length;
  const results = scanPageResults(
    questions,
    decisions,
    data.keys,
    page.status !== "accepted" && Boolean(page.problem),
  );
  const confirmDetected = () => {
    setDirty(true);
    setDecisions((current) =>
      current.map((r) =>
        r.resolved
          ? r
          : r.candidateChoice
            ? {
                ...r,
                choice: r.candidateChoice,
                status: "clear",
                resolved: true,
                reviewed: true,
              }
            : r.status === "blank"
              ? { ...r, choice: null, resolved: true, reviewed: true }
              : r,
      ),
    );
    if (!note.trim())
      setNote(
        "Confirmed detected choices and blanks against the original scan.",
      );
    setShowAll(true);
  };
  const perform = async (action: string) => {
    setBusy(true);
    setError("");
    try {
      await save({
        pageId: page.id,
        revision: page.revision,
        reviewAction: action,
        decisions,
        note:
          note.trim() ||
          (action === "reject"
            ? "Teacher rejected this scan."
            : action === "reopen"
              ? "Teacher reopened this paper for review."
              : "Teacher saved answer corrections."),
        sheetId: sheetId || null,
        sheetPage,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Review could not be saved.");
    } finally {
      setBusy(false);
    }
  };
  const visibleQuestions =
    showAll || unidentified
      ? questions
      : questions.filter(
          (q) =>
            page.readings.find((r) => r.position === q.position)?.status !==
              "clear" || page.problem,
        );
  return (
    <div className={styles.paperReview}>
      <h2>{sheet?.student_name ?? "Identify this paper"}</h2>
      <p>
        {sheet
          ? `${sheet.class_name} · ${scanPaperLabel(sheet)} · Page ${sheetPage}`
          : `Source page ${page.source_page}`}{" "}
        ·{" "}
        <strong>
          {page.status === "accepted"
            ? "Graded"
            : page.status === "review"
              ? "Needs attention"
              : page.status === "unidentified"
                ? "Identify student"
                : page.status}
        </strong>
      </p>
      {page.problem && <p className={styles.problem}>{page.problem}</p>}
      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}
      {sheet && (
        <section
          className={styles.markingResults}
          aria-label="Question marking results"
        >
          <div>
            <h3>
              {dirty
                ? "Unsaved answer changes"
                : page.status === "accepted" && results.unresolved === 0
                  ? "Marked results"
                  : "Provisional marking results"}
            </h3>
            <strong className={styles.resultScore}>
              {results.score} / {results.maxScore}
            </strong>
            <p>
              {results.correct} correct · {results.incorrect} incorrect ·{" "}
              {results.blank} blank
              {results.unresolved > 0
                ? ` · ${results.unresolved} need confirmation`
                : ""}
            </p>
          </div>
          {results.unresolved > 0 && (
            <p>
              Only these ambiguous answers need attention. Choose an answer
              below and save to finish grading. Clear marks and blanks are
              already resolved.
            </p>
          )}
          <div className={styles.resultTableScroll}>
            <table className={styles.resultTable}>
              <thead>
                <tr>
                  <th>Question</th>
                  <th>Student answer</th>
                  <th>Recognition confidence</th>
                  <th>Correct answer</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {results.rows.map((r) => (
                  <tr
                    key={r.position}
                    className={
                      r.comparison === "correct"
                        ? styles.resultCorrect
                        : r.comparison === "incorrect"
                          ? styles.resultIncorrect
                          : styles.resultPending
                    }
                  >
                    <th scope="row">{r.position}</th>
                    <td>
                      <select
                        aria-label={`Answer for question ${r.position}`}
                        disabled={disabled || busy}
                        value={
                          decisions.find((d) => d.position === r.position)
                            ?.resolved
                            ? (decisions.find((d) => d.position === r.position)
                                ?.choice ??
                              (r.status === "irregular" ? "invalid" : "blank"))
                            : ""
                        }
                        onChange={(e) => decide(r.position, e.target.value)}
                      >
                        <option value="" disabled>
                          {r.choice
                            ? `Possible ${r.choice}`
                            : "Needs attention"}
                        </option>
                        {CHOICES.map((choice) => (
                          <option key={choice} value={choice}>
                            {choice}
                          </option>
                        ))}
                        <option value="blank">Blank</option>
                        <option value="invalid">Invalid</option>
                      </select>
                    </td>
                    <td>
                      {readingConfidence(
                        page.readings.find((d) => d.position === r.position),
                      ) === null
                        ? "—"
                        : `${readingConfidence(page.readings.find((d) => d.position === r.position))}%`}
                    </td>
                    <td>{r.answerKey}</td>
                    <td>
                      {r.comparison === "correct"
                        ? `${r.resolved ? "✓ Correct" : "Likely correct"}`
                        : r.comparison === "incorrect"
                          ? `${r.resolved ? "✕ Incorrect" : "Likely incorrect"}`
                          : r.comparison === "blank"
                            ? "Blank · 0 pts"
                            : "Needs review"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {remaining > 0 && (
            <button
              className="secondary-inline-button"
              disabled={disabled || busy}
              onClick={confirmDetected}
            >
              Confirm detected answers & blanks
            </button>
          )}
          <small>
            Confidence estimates the clarity of the scanned mark. You can change
            any answer; the original scan is kept.
          </small>
          {!unidentified && (
            <div className={styles.saveBar}>
              <span>
                {dirty
                  ? "Changes are not saved yet"
                  : page.status === "accepted"
                    ? page.decisions
                      ? "Teacher-reviewed grade saved"
                      : "Grade saved automatically"
                    : `${remaining} answers need attention`}
              </span>
              <button
                className="teacher-button"
                disabled={disabled || busy || remaining > 0 || !dirty}
                onClick={() => perform("accept")}
              >
                {busy ? "Saving…" : "Save changes"}
              </button>
            </div>
          )}
        </section>
      )}
      {page.decisions === null &&
        ["unidentified", "review"].includes(page.status) && (
          <button
            className="secondary-inline-button"
            disabled={disabled || busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await retry();
              } catch (e) {
                setError(
                  e instanceof Error ? e.message : "Recognition retry failed.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            Retry automatic recognition
          </button>
        )}
      {unidentified && (
        <div className={styles.identity}>
          <label>
            Printed student identity
            <select value={sheetId} onChange={(e) => reset(e.target.value, 1)}>
              <option value="">Choose the exact printed student</option>
              {data.sheets.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.class_name} · {s.student_name} · {s.student_code} · V
                  {s.version}
                </option>
              ))}
            </select>
          </label>
          {sheet && (
            <label>
              Printed page number
              <select
                value={sheetPage}
                onChange={(e) => reset(sheet.id, Number(e.target.value))}
              >
                {Array.from(
                  {
                    length: Math.ceil(
                      sheet.questions.length / QUESTIONS_PER_PAGE,
                    ),
                  },
                  (_, i) => (
                    <option key={i} value={i + 1}>
                      {i + 1}
                    </option>
                  ),
                )}
              </select>
            </label>
          )}
          <p>
            Verify the printed name, class, version and page. Assigning manually
            requires a decision for every answer. Reject an existing active scan
            before replacing it.
          </p>
        </div>
      )}
      <details className={styles.scanInspection}>
        <summary>Inspect original scan & individual marks</summary>
        <div className={styles.actions}>
          <button
            className="secondary-inline-button"
            onClick={() => setShowOriginal(!showOriginal)}
          >
            {showOriginal ? "Show aligned sheet" : "Show original scan"}
          </button>
          <a
            className={styles.textLink}
            href={`${api}?asset=${page.id}&variant=original`}
            target="_blank"
            rel="noreferrer"
          >
            Open full resolution
          </a>
        </div>
        <div className={styles.fullScan}>
          {images.original ? (
            <Image
              unoptimized
              width={1191}
              height={1684}
              alt={`Scanned answer sheet for ${sheet?.student_name ?? "unidentified student"}`}
              src={
                !showOriginal && images.aligned
                  ? images.aligned
                  : images.original
              }
            />
          ) : (
            <p role="status">Loading original scan…</p>
          )}
        </div>
        {sheet && (
          <>
            <div className="section-row">
              <h3>
                {remaining
                  ? `${remaining} answers need a decision`
                  : "All answers resolved"}
              </h3>
              <button
                className="secondary-inline-button"
                onClick={() => setShowAll(!showAll)}
              >
                {showAll ? "Flagged only" : "Show all answers"}
              </button>
            </div>
            <div className={styles.answerList}>
              {visibleQuestions.map((q) => {
                const answer = decisions.find((r) => r.position === q.position);
                const reading = page.readings.find(
                  (r) => r.position === q.position,
                );
                const key = printedScanChoice(q, data.keys[q.questionId]);
                const index = questions.findIndex(
                  (x) => x.position === q.position,
                );
                const point = bubblePosition(index, 0);
                return (
                  <article
                    className={
                      answer?.resolved
                        ? styles.resolvedAnswer
                        : styles.flaggedAnswer
                    }
                    key={q.position}
                  >
                    <div>
                      <strong>Question {q.position}</strong>
                      <small>
                        Detected:{" "}
                        {reading?.choice ??
                          reading?.candidateChoice ??
                          reading?.status ??
                          "unreadable"}
                        {readingConfidence(reading) !== null
                          ? ` · Recognition confidence ${readingConfidence(reading)}%`
                          : ""}
                      </small>
                      {images.aligned && !unidentified && (
                        <div
                          aria-label={`Scanned bubbles for question ${q.position}`}
                          className={styles.crop}
                          style={{
                            backgroundImage: `url("${images.aligned}")`,
                            backgroundPosition: `${-(point.x - 16) * 2}px ${-(point.y - 12) * 2}px`,
                          }}
                        />
                      )}
                    </div>
                    <div className={styles.choiceButtons}>
                      {[...CHOICES, "blank", "invalid"].map((choice) => (
                        <button
                          aria-label={`Question ${q.position}: ${choice}`}
                          aria-pressed={Boolean(
                            answer?.resolved &&
                            (choice === answer.choice ||
                              (choice === "blank" &&
                                answer.status === "blank") ||
                              (choice === "invalid" &&
                                answer.status === "irregular")),
                          )}
                          disabled={disabled || busy}
                          key={choice}
                          onClick={() => decide(q.position, choice)}
                        >
                          {choice}
                        </button>
                      ))}
                    </div>
                    <small>
                      {answer?.resolved
                        ? answer.choice
                          ? `${answer.choice === key ? "Correct" : `Incorrect · key ${key}`} · ${answer.choice === key ? q.points : 0}/${q.points} pts`
                          : `Blank / invalid · 0/${q.points} pts`
                        : "Awaiting your interpretation"}
                    </small>
                  </article>
                );
              })}
            </div>
          </>
        )}
        <label>
          Review reason (optional)
          <input
            maxLength={1000}
            placeholder="e.g. Q7: erased B, clearly shaded C"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        <div className={styles.actions}>
          <button
            className="teacher-button"
            disabled={
              disabled || busy || !sheet || remaining > 0 || !decisions.length
            }
            onClick={() => perform(unidentified ? "identify" : "accept")}
          >
            {busy ? "Saving…" : "Save review & recalculate"}
          </button>
          <button
            className="secondary-inline-button"
            disabled={disabled || busy}
            onClick={() => perform("reject")}
          >
            Reject scan
          </button>
          {page.status === "accepted" && (
            <button
              className="secondary-inline-button"
              disabled={disabled || busy}
              onClick={() => perform("reopen")}
            >
              Reopen & withhold grade
            </button>
          )}
        </div>
        <small>
          Every page must be accepted before a grade is finalized. Reopening or
          rejecting a graded page removes that grade until review is complete.
        </small>
      </details>
    </div>
  );
}

function ScanStatistics({
  data,
  classId,
}: {
  data: ScanWorkspace;
  classId: string;
}) {
  const finalized = data.sheets.filter(
    (s) =>
      (!classId || s.class_id === classId) &&
      data.grades.some(
        (g) => g.id === s.attempt_id && g.status === "submitted",
      ),
  );
  const stats = new Map<number, { correct: number; count: number }>();
  const classes = new Map<string, { count: number; total: number }>();
  for (const sheet of finalized) {
    const grade = data.grades.find((g) => g.id === sheet.attempt_id)!;
    const c = classes.get(sheet.class_name) ?? { count: 0, total: 0 };
    c.count++;
    c.total += (Number(grade.score) / Number(grade.max_score)) * 100;
    classes.set(sheet.class_name, c);
    for (const page of data.pages.filter(
      (p) => p.sheet_id === sheet.id && p.status === "accepted",
    ))
      for (const reading of page.decisions ?? page.readings) {
        const question: ScanQuestion | undefined = sheet.questions.find(
          (q) => q.position === reading.position,
        );
        if (!question) continue;
        const value = stats.get(question.position) ?? { correct: 0, count: 0 };
        value.count++;
        if (
          reading.choice ===
          printedScanChoice(question, data.keys[question.questionId])
        )
          value.correct++;
        stats.set(question.position, value);
      }
  }
  return (
    <section className={`teacher-section ${styles.statistics}`}>
      <p className="eyebrow">Finalized papers only</p>
      <h2>Class & question insights</h2>
      {!finalized.length ? (
        <p>
          Statistics appear as papers are finalized. Pending and unresolved
          papers are excluded.
        </p>
      ) : (
        <>
          <div className={styles.classStats}>
            {[...classes].map(([name, value]) => (
              <div key={name}>
                <strong>{name}</strong>
                <span>
                  {value.count} graded · {Math.round(value.total / value.count)}
                  % average
                </span>
              </div>
            ))}
          </div>
          <div className={styles.questionStats}>
            {[...stats]
              .sort((a, b) => a[0] - b[0])
              .map(([position, value]) => (
                <div key={position}>
                  <strong>Q{position}</strong>
                  <meter min={0} max={value.count} value={value.correct} />
                  <span>
                    {value.correct}/{value.count} correct
                  </span>
                </div>
              ))}
          </div>
        </>
      )}
    </section>
  );
}
