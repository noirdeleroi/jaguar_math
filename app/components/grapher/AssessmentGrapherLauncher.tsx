"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./grapher.module.css";

const JaguarGrapher = dynamic(() => import("./JaguarGrapher"), {
  ssr: false,
  loading: () => <div className={styles.loading} role="status">Opening Jaguar Grapher…</div>,
});

export default function AssessmentGrapherLauncher({ attemptId, disabled = false }: { attemptId: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const portalTarget = typeof document === "undefined" ? null : document.body;
  const visible = open && !disabled;

  useEffect(() => {
    document.body.classList.toggle("assessment-grapher-open", visible);

    return () => document.body.classList.remove("assessment-grapher-open");
  }, [visible]);

  return <>
    <span className={styles.launcher}>
      <button
        aria-controls="jaguar-assessment-grapher"
        aria-expanded={visible}
        className={styles.launchButton}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        title="Open the built-in graphing calculator"
        type="button"
      >
        <span aria-hidden="true" className={styles.launchIcon}>⌁⌁</span>
        {visible ? "Hide grapher" : "Grapher"}
      </button>
    </span>
    {portalTarget && visible && createPortal(
      <div className={styles.floatingShell} id="jaguar-assessment-grapher">
        <JaguarGrapher onRequestClose={() => setOpen(false)} storageKey={`jaguar:grapher:attempt:${attemptId}:v1`} />
      </div>,
      portalTarget,
    )}
  </>;
}
