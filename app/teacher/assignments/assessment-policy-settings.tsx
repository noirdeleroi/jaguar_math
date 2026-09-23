"use client";

import { useState } from "react";
import ExamModeSettings from "./exam-mode-settings";
import styles from "./assessment-policy-settings.module.css";

export type AssignmentKind = "homework" | "test" | "paper";
type StoredAssignmentKind = AssignmentKind | "quiz";

export type AssessmentPolicyInitial = {
  kind?: StoredAssignmentKind;
  durationMinutes?: number | null;
  paperAnswerDurationSeconds?: number;
  maxAttempts?: number;
  questionDisplayMode?: "one_at_a_time" | "all_at_once";
  showScoreAfterSubmit?: boolean;
  showAnswersAfterSubmit?: boolean;
  showFeedbackAfterEachQuestion?: boolean;
  shuffleQuestions?: boolean;
  shuffleOptions?: boolean;
  examMode?: boolean;
  examRequireFullscreen?: boolean;
  examTrackFocusExits?: boolean;
  examAllowedFocusExits?: number;
  examViolationAction?: "warn" | "auto_submit";
  teacherControlledQuestionRelease?: boolean;
};

type Policy = Required<Omit<AssessmentPolicyInitial, "durationMinutes" | "kind">> & { kind: AssignmentKind; durationMinutes: number | null };

const PRESETS: Record<AssignmentKind, Policy> = {
  homework: {
    kind: "homework", durationMinutes: null, paperAnswerDurationSeconds: 90, maxAttempts: 3, questionDisplayMode: "all_at_once",
    showScoreAfterSubmit: true, showAnswersAfterSubmit: true, showFeedbackAfterEachQuestion: true,
    shuffleQuestions: false, shuffleOptions: false, examMode: false, examRequireFullscreen: false,
    examTrackFocusExits: false, examAllowedFocusExits: 2, examViolationAction: "warn", teacherControlledQuestionRelease: false,
  },
  test: {
    kind: "test", durationMinutes: 60, paperAnswerDurationSeconds: 90, maxAttempts: 1, questionDisplayMode: "one_at_a_time",
    showScoreAfterSubmit: false, showAnswersAfterSubmit: false, showFeedbackAfterEachQuestion: false,
    shuffleQuestions: true, shuffleOptions: true, examMode: true, examRequireFullscreen: true,
    examTrackFocusExits: true, examAllowedFocusExits: 1, examViolationAction: "warn", teacherControlledQuestionRelease: true,
  },
  paper: {
    kind: "paper", durationMinutes: 60, paperAnswerDurationSeconds: 90, maxAttempts: 1, questionDisplayMode: "all_at_once",
    showScoreAfterSubmit: false, showAnswersAfterSubmit: false, showFeedbackAfterEachQuestion: false,
    shuffleQuestions: false, shuffleOptions: false, examMode: false, examRequireFullscreen: false,
    examTrackFocusExits: false, examAllowedFocusExits: 0, examViolationAction: "warn", teacherControlledQuestionRelease: true,
  },
};

const COPY: Record<AssignmentKind, { eyebrow: string; title: string; description: string; note: string }> = {
  homework: { eyebrow: "Learning mode", title: "Homework", description: "Practice with support, retries, and immediate learning feedback.", note: "Students can learn while they work. Browser monitoring is disabled." },
  test: { eyebrow: "Secure mode", title: "Test", description: "A timed, one-attempt assessment with Exam Mode and teacher-controlled results.", note: "Security-critical delivery settings are enforced. You decide separately when students may see results." },
  paper: { eyebrow: "Paper mode", title: "Paper test", description: "Students solve a printed version, then enter answers in a short synchronized window.", note: "Jaguar runs the shared writing timer in fullscreen, assigns a paper version, autosaves answer entry, and keeps results private until you release them." },
};

function normalizedInitial(initial: AssessmentPolicyInitial): Policy {
  const kind = initial.kind === "test" || initial.kind === "paper" ? initial.kind : "homework";
  return { ...PRESETS[kind], ...initial, kind } as Policy;
}

export default function AssessmentPolicySettings({ initial = {}, onKindChange, questionReleaseLocked = false }: { initial?: AssessmentPolicyInitial; onKindChange?: (kind: AssignmentKind) => void; questionReleaseLocked?: boolean }) {
  const [policy, setPolicy] = useState<Policy>(() => normalizedInitial(initial));
  const [presetVersion, setPresetVersion] = useState(0);
  const secure = policy.kind === "test";
  const test = policy.kind === "test";
  const paper = policy.kind === "paper";
  const assessment = test || paper;
  const resultVisibility = policy.showAnswersAfterSubmit ? "full_review" : policy.showScoreAfterSubmit ? "score_only" : "private";
  const chooseKind = (kind: AssignmentKind) => { setPolicy(PRESETS[kind]); setPresetVersion((value) => value + 1); onKindChange?.(kind); };
  const set = <K extends keyof Policy>(key: K, value: Policy[K]) => setPolicy((current) => ({ ...current, [key]: value }));

  return <div className={styles.wrapper}>
    <fieldset className={styles.kindPicker}>
      <legend>Choose how students will use this work</legend>
      <div className={styles.kindGrid}>{(["homework", "test", "paper"] as AssignmentKind[]).map((kind) => <label className={policy.kind === kind ? styles.activeKind : ""} key={kind}>
        <input checked={policy.kind === kind} name="kind" onChange={() => chooseKind(kind)} type="radio" value={kind} />
        <span>{COPY[kind].eyebrow}</span><strong>{COPY[kind].title}</strong><small>{COPY[kind].description}</small>
      </label>)}</div>
    </fieldset>

    <section className={`${styles.policySummary} ${styles[policy.kind]}`} aria-live="polite">
      <div><span>{COPY[policy.kind].eyebrow}</span><strong>{COPY[policy.kind].title} policy</strong></div><p>{COPY[policy.kind].note}</p>
    </section>

    <div className="assessment-fields">
      <label>{paper ? "Writing time in minutes" : "Duration in minutes"}<input min="1" name="duration_minutes" onChange={(event) => set("durationMinutes", event.target.value ? Number(event.target.value) : null)} placeholder={policy.kind === "homework" ? "No timer" : undefined} required={secure || paper} type="number" value={policy.durationMinutes ?? ""} />{paper && <small className={styles.lockedLabel}>One synchronized timer for the whole class</small>}</label>
      {paper && <label>Answer-entry time in seconds<input max="3600" min="30" name="paper_answer_duration_seconds" onChange={(event) => set("paperAnswerDurationSeconds", Number(event.target.value))} required type="number" value={policy.paperAnswerDurationSeconds} /><small className={styles.lockedLabel}>90 seconds by default</small></label>}
      <label>Maximum attempts{assessment && <small className={styles.lockedLabel}>Locked for assessments</small>}<input disabled={assessment} min="1" name={assessment ? undefined : "max_attempts"} onChange={(event) => set("maxAttempts", Math.max(1, Number(event.target.value)))} required type="number" value={policy.maxAttempts} />{assessment && <input name="max_attempts" type="hidden" value="1" />}</label>
      <label>Question display{assessment && <small className={styles.lockedLabel}>Locked for this mode</small>}<select disabled={assessment} name={assessment ? undefined : "question_display_mode"} onChange={(event) => set("questionDisplayMode", event.target.value as Policy["questionDisplayMode"])} value={policy.questionDisplayMode}><option value="one_at_a_time">One question at a time</option><option value="all_at_once">All questions on one page</option></select>{assessment && <input name="question_display_mode" type="hidden" value={policy.questionDisplayMode} />}</label>
    </div>

    <div className={styles.policyGroups}>
      <section><h3>Student feedback</h3><p>{policy.kind === "homework" ? "Help students learn during practice." : "Keep answer information protected during assessment."}</p>
        <div className="assignment-toggles">
          {policy.kind === "homework" ? <>
            <PolicyToggle checked={policy.showScoreAfterSubmit} label="Show score after submit" name="show_score_after_submit" onChange={(value) => set("showScoreAfterSubmit", value)} />
            <PolicyToggle checked={policy.showAnswersAfterSubmit} label="Show answer review after submit" name="show_answers_after_submit" onChange={(value) => { set("showAnswersAfterSubmit", value); if (value) set("showScoreAfterSubmit", true); }} />
          </> : <label className={styles.resultVisibility}>What students see after submitting
            <select name="student_result_visibility" onChange={(event) => { const value = event.target.value; setPolicy((current) => ({ ...current, showScoreAfterSubmit: value !== "private", showAnswersAfterSubmit: value === "full_review" })); }} value={resultVisibility}>
              <option value="private">Confirmation only — reveal nothing</option>
              <option value="score_only">Score only — keep questions private</option>
              <option value="full_review">Full review — reveal all</option>
            </select>
            <small>{resultVisibility === "private" ? "Students see only that the assessment was submitted." : resultVisibility === "score_only" ? "Students see their score, but no questions, answers, or correctness." : "Students see questions, their answers, correct answers, score, and improvement guidance."}</small>
          </label>}
          <PolicyToggle checked={policy.showFeedbackAfterEachQuestion} disabled={assessment} label={policy.kind === "homework" ? "Show correct or incorrect after each saved answer" : "Immediate correctness is disabled for assessments"} name="show_feedback_after_each_question" onChange={(value) => set("showFeedbackAfterEachQuestion", value)} />
        </div>
      </section>
      <section><h3>Form variation</h3><p>Each attempt receives a stable form code and server-saved order.</p>
        <div className="assignment-toggles">
          <PolicyToggle checked={policy.shuffleQuestions} disabled={assessment} label={paper ? "Question order follows the printed paper" : "Shuffle question order"} name="shuffle_questions" onChange={(value) => set("shuffleQuestions", value)} />
          <PolicyToggle checked={policy.shuffleOptions} disabled={assessment} label={paper ? "Choice letters follow the printed paper" : "Shuffle multiple-choice options"} name="shuffle_options" onChange={(value) => set("shuffleOptions", value)} />
        </div>
      </section>
    </div>

    {policy.kind === "homework" ? <section className={styles.homeworkGuard}><strong>No Exam Mode for homework</strong><p>Homework is for practice. Students may leave the page and use learning resources without being flagged.</p></section> : paper ? <section className={styles.homeworkGuard}><strong>Secure paper workflow</strong><p>Students remain in fullscreen for writing and answer entry. Fullscreen exits are recorded, printed questions stay hidden, and answers autosave one numbered field at a time.</p></section> : <ExamModeSettings forcedEnabled={secure} initial={{ enabled: policy.examMode, requireFullscreen: policy.examRequireFullscreen, trackFocusExits: policy.examTrackFocusExits, allowedFocusExits: policy.examAllowedFocusExits, violationAction: policy.examViolationAction }} key={`${policy.kind}-${presetVersion}`} />}
    {assessment && <section className={styles.releaseSetting}><div><strong>Teacher-controlled {paper ? "writing and answer" : "question"} release</strong>{(questionReleaseLocked || paper) && <small className={styles.lockedLabel}>Required for {paper ? "paper tests" : "published tests"}</small>}<p>{paper ? "Students enter the fullscreen waiting room first. You start the writing timer, then open the short answer-entry window after writing ends." : "Students can enter fullscreen and read the instructions, but their timer and questions stay locked until you release the test."}</p></div><label><input checked={policy.teacherControlledQuestionRelease} disabled={questionReleaseLocked || paper} name={questionReleaseLocked || paper ? undefined : "teacher_controlled_question_release"} onChange={(event) => set("teacherControlledQuestionRelease", event.target.checked)} type="checkbox" /> Wait for me to release the {paper ? "paper test" : "questions"}{(questionReleaseLocked || paper) && policy.teacherControlledQuestionRelease && <input name="teacher_controlled_question_release" type="hidden" value="on" />}</label></section>}
  </div>;
}

function PolicyToggle({ checked, disabled, label, name, onChange }: { checked: boolean; disabled?: boolean; label: string; name: string; onChange: (value: boolean) => void }) {
  return <label className={disabled ? styles.lockedToggle : ""}><input checked={checked} disabled={disabled} name={disabled ? undefined : name} onChange={(event) => onChange(event.target.checked)} type="checkbox" /> {label}{disabled && checked && <input name={name} type="hidden" value="on" />}</label>;
}
