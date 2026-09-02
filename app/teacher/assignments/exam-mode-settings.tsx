"use client";

import { useState } from "react";
import styles from "./exam-mode-settings.module.css";

export default function ExamModeSettings({ initial = {} }: { initial?: { enabled?: boolean; requireFullscreen?: boolean; trackFocusExits?: boolean; allowedFocusExits?: number; violationAction?: "warn" | "auto_submit" } }) {
  const [enabled, setEnabled] = useState(initial.enabled ?? false);
  return <section aria-labelledby="exam-mode-heading" className={styles.settings}><div className={styles.heading}><h3 id="exam-mode-heading">Exam Mode</h3><label className={styles.toggle}><input checked={enabled} name="exam_mode" onChange={(event) => setEnabled(event.target.checked)} type="checkbox" /> Enable</label></div>{enabled && <div className={styles.fields}><p>Exam Mode can detect leaving the test or exiting fullscreen, but cannot fully lock a student&apos;s device.</p><label><input defaultChecked={initial.requireFullscreen ?? true} name="exam_require_fullscreen" type="checkbox" /> Require fullscreen where supported</label><label><input defaultChecked={initial.trackFocusExits ?? true} name="exam_track_focus_exits" type="checkbox" /> Track focus exits</label><label className={styles.field}>Allowed focus exits<input defaultValue={initial.allowedFocusExits ?? 2} min="0" name="exam_allowed_focus_exits" required type="number" /></label><label className={styles.field}>Violation action<select defaultValue={initial.violationAction ?? "warn"} name="exam_violation_action"><option value="warn">Warn</option><option value="auto_submit">Auto-submit</option></select></label><p className="form-note">With a limit of 2, the third counted interruption triggers auto-submit.</p></div>}</section>;
}
