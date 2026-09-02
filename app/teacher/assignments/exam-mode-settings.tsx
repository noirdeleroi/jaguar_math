"use client";

import { useState } from "react";
import styles from "./exam-mode-settings.module.css";

export default function ExamModeSettings({ initial = {} }: { initial?: { enabled?: boolean; requireFullscreen?: boolean; trackFocusExits?: boolean; allowedFocusExits?: number; violationAction?: "warn" | "auto_submit" } }) {
  const [enabled, setEnabled] = useState(initial.enabled ?? false);
  return <section className={styles.settings}><label className={styles.toggle}><input checked={enabled} name="exam_mode" onChange={(event) => setEnabled(event.target.checked)} type="checkbox" /> Enable Exam Mode</label>{enabled && <div className={styles.fields}><p>Exam Mode can detect leaving the test or exiting fullscreen, but cannot fully lock a student&apos;s device.</p><label><input defaultChecked={initial.requireFullscreen ?? true} name="exam_require_fullscreen" type="checkbox" /> Require fullscreen where supported</label><label><input defaultChecked={initial.trackFocusExits ?? true} name="exam_track_focus_exits" type="checkbox" /> Track focus exits</label><label className={styles.field}>Allowed focus exits<input defaultValue={initial.allowedFocusExits ?? 2} min="0" name="exam_allowed_focus_exits" required type="number" /></label><label className={styles.field}>Violation action<select defaultValue={initial.violationAction ?? "warn"} name="exam_violation_action"><option value="warn">Warn student</option><option value="auto_submit">Auto-submit after the limit is exceeded</option></select></label><p className="form-note">With a limit of 2, the third counted interruption triggers auto-submit.</p></div>}</section>;
}
