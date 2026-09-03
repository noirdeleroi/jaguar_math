"use client";

import { useState } from "react";
import AssessmentRunner from "./assessment-runner";
import ExamModeGate, { type ExamAttempt } from "./exam-mode-start";

type Question = { id: string; prompt: string; type: string; options: { id: string; text: string }[] | null; points: number; answer: string; isCorrect: boolean | null; pointsAwarded: number | null };
type ExamMode = { requireFullscreen: boolean; trackFocusExits: boolean; allowedFocusExits: number };

export default function ExamModeAssessment({ assignmentId, initialAttempt, durationMinutes, questions, responsesClosed, examMode, questionDisplayMode, showFeedbackAfterEachQuestion, shuffleQuestions }: { assignmentId: string; initialAttempt?: ExamAttempt; durationMinutes: number | null; questions: Question[]; responsesClosed: boolean; examMode: ExamMode; questionDisplayMode: "one_at_a_time" | "all_at_once"; showFeedbackAfterEachQuestion: boolean; shuffleQuestions: boolean }) {
  const [activeAttempt, setActiveAttempt] = useState<ExamAttempt | undefined>();
  const attempt = activeAttempt ?? initialAttempt;
  const runnerQuestions = attempt && shuffleQuestions ? [...questions].sort((left, right) => `${attempt.id}${left.id}`.localeCompare(`${attempt.id}${right.id}`)) : questions;
  if (activeAttempt && attempt) return <AssessmentRunner attemptId={attempt.id} durationMinutes={durationMinutes} examMode={{ ...examMode, focusViolations: attempt.focusViolations }} questionDisplayMode={questionDisplayMode} questions={runnerQuestions} responsesClosed={responsesClosed} showFeedbackAfterEachQuestion={showFeedbackAfterEachQuestion} startedAt={attempt.startedAt} />;
  return <ExamModeGate allowedFocusExits={examMode.allowedFocusExits} assignmentId={assignmentId} attempt={attempt} onActive={setActiveAttempt} requireFullscreen={examMode.requireFullscreen} />;
}
