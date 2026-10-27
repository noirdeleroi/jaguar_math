"use client";

import { useState } from "react";
import AssessmentRunner from "./assessment-runner";
import ExamModeGate, { type ExamAttempt } from "./exam-mode-start";
import { resolveExamRunnerAttempt } from "./exam-mode-attempt";

type Question = { id: string; prompt: string; type: string; options: { id: string; text: string }[] | null; points: number; answer: string; serverRevision: number; isCorrect: boolean | null; pointsAwarded: number | null };
type ExamMode = { requireFullscreen: boolean; trackFocusExits: boolean; allowedFocusExits: number; violationAction: "warn" | "auto_submit" };

export default function ExamModeAssessment({ allowGraphingCalculator, assignmentId, initialAttempt, expiresAt, durationMinutes, questionsReleased = true, instructions, questions, responsesClosed, examMode, questionDisplayMode, showFeedbackAfterEachQuestion }: { allowGraphingCalculator: boolean; assignmentId: string; initialAttempt?: ExamAttempt; questionsReleased?: boolean; instructions?: string | null; expiresAt: string | null; durationMinutes: number | null; questions: Question[]; responsesClosed: boolean; examMode: ExamMode; questionDisplayMode: "one_at_a_time" | "all_at_once"; showFeedbackAfterEachQuestion: boolean }) {
  const [activeAttempt, setActiveAttempt] = useState<ExamAttempt | undefined>();
  // Once an attempt has started, the runner must stay mounted even after a
  // fullscreen exit. It owns the lock screen and must remain alive long enough
  // to deduplicate the browser signals and record the exit exactly once.
  const attempt = resolveExamRunnerAttempt(activeAttempt, initialAttempt);
  if (attempt) return <AssessmentRunner allowGraphingCalculator={allowGraphingCalculator} attemptId={attempt.id} expiresAt={initialAttempt ? expiresAt : activeAttempt?.expiresAt ?? expiresAt} formCode={attempt.formCode} examMode={{ ...examMode, focusViolations: attempt.focusViolations }} questionDisplayMode={questionDisplayMode} questions={initialAttempt ? questions : activeAttempt?.questions ?? questions} responsesClosed={responsesClosed} showFeedbackAfterEachQuestion={showFeedbackAfterEachQuestion} />;
  return <ExamModeGate questionsReleased={questionsReleased} instructions={instructions} allowedFocusExits={examMode.allowedFocusExits} assignmentId={assignmentId} attempt={initialAttempt} durationMinutes={durationMinutes} onActive={setActiveAttempt} requireFullscreen={examMode.requireFullscreen} violationAction={examMode.violationAction} />;
}
