"use client";

import { useState } from "react";
import AssessmentRunner from "./assessment-runner";
import ExamModeGate, { type ExamAttempt } from "./exam-mode-start";

type Question = { id: string; prompt: string; type: string; options: { id: string; text: string }[] | null; points: number; answer: string };
type ExamMode = { requireFullscreen: boolean; trackFocusExits: boolean; allowedFocusExits: number };

export default function ExamModeAssessment({ assignmentId, initialAttempt, durationMinutes, questions, responsesClosed, examMode, shuffleQuestions }: { assignmentId: string; initialAttempt?: ExamAttempt; durationMinutes: number | null; questions: Question[]; responsesClosed: boolean; examMode: ExamMode; shuffleQuestions: boolean }) {
  const [activeAttempt, setActiveAttempt] = useState<ExamAttempt | undefined>();
  const attempt = activeAttempt ?? initialAttempt;
  const runnerQuestions = attempt && shuffleQuestions ? [...questions].sort((left, right) => `${attempt.id}${left.id}`.localeCompare(`${attempt.id}${right.id}`)) : questions;
  if (activeAttempt && attempt) return <AssessmentRunner attemptId={attempt.id} durationMinutes={durationMinutes} examMode={{ ...examMode, focusViolations: attempt.focusViolations }} questions={runnerQuestions} responsesClosed={responsesClosed} startedAt={attempt.startedAt} />;
  return <ExamModeGate allowedFocusExits={examMode.allowedFocusExits} assignmentId={assignmentId} attempt={attempt} onActive={setActiveAttempt} requireFullscreen={examMode.requireFullscreen} />;
}
