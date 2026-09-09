"use client";

import { useState, useSyncExternalStore } from "react";
import AssessmentRunner from "./assessment-runner";
import ExamModeGate, { type ExamAttempt } from "./exam-mode-start";

type Question = { id: string; prompt: string; type: string; options: { id: string; text: string }[] | null; points: number; answer: string; isCorrect: boolean | null; pointsAwarded: number | null };
type ExamMode = { requireFullscreen: boolean; trackFocusExits: boolean; allowedFocusExits: number; violationAction: "warn" | "auto_submit" };

export default function ExamModeAssessment({ assignmentId, initialAttempt, expiresAt, questions, responsesClosed, examMode, questionDisplayMode, showFeedbackAfterEachQuestion }: { assignmentId: string; initialAttempt?: ExamAttempt; expiresAt: string | null; questions: Question[]; responsesClosed: boolean; examMode: ExamMode; questionDisplayMode: "one_at_a_time" | "all_at_once"; showFeedbackAfterEachQuestion: boolean }) {
  const [activeAttempt, setActiveAttempt] = useState<ExamAttempt | undefined>();
  const fullscreenActive = useSyncExternalStore(subscribeToFullscreen, () => Boolean(document.fullscreenElement), () => false);
  const securedInitialAttempt = initialAttempt && (!examMode.requireFullscreen || fullscreenActive) ? initialAttempt : undefined;
  const attempt = activeAttempt ?? securedInitialAttempt;
  if (attempt) return <AssessmentRunner attemptId={attempt.id} expiresAt={expiresAt} formCode={attempt.formCode} examMode={{ ...examMode, focusViolations: attempt.focusViolations }} questionDisplayMode={questionDisplayMode} questions={questions} responsesClosed={responsesClosed} showFeedbackAfterEachQuestion={showFeedbackAfterEachQuestion} />;
  return <ExamModeGate allowedFocusExits={examMode.allowedFocusExits} assignmentId={assignmentId} attempt={initialAttempt} onActive={setActiveAttempt} requireFullscreen={examMode.requireFullscreen} violationAction={examMode.violationAction} />;
}

function subscribeToFullscreen(callback: () => void) {
  document.addEventListener("fullscreenchange", callback);
  return () => document.removeEventListener("fullscreenchange", callback);
}
