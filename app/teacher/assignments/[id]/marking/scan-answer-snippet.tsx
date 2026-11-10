"use client";
import { scanSnippetRect } from "@/lib/paper-scan-layout";
import styles from "./scan-marking.module.css";

export function ScanAnswerSnippet({
  src,
  index,
  position,
  onEnlarge,
}: {
  src: string;
  index: number;
  position: number;
  onEnlarge?: () => void;
}) {
  const rect = scanSnippetRect(index);
  const picture = (
    <svg
      role="img"
      aria-label={`Scanned answer for question ${position}`}
      viewBox={`${rect.x} ${rect.y} ${rect.width} ${rect.height}`}
      className={styles.answerSnippet}
    >
      <image href={src} x="0" y="0" width="1191" height="1684" />
    </svg>
  );
  return onEnlarge ? (
    <button
      type="button"
      className={styles.snippetButton}
      aria-label={`Enlarge scan for question ${position}`}
      onClick={onEnlarge}
    >
      {picture}
      <span>Enlarge</span>
    </button>
  ) : (
    picture
  );
}
