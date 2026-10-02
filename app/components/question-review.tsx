import type { ReactNode } from "react";
import MathText from "./math-text";
import { attemptReviewLabel, attemptReviewState } from "@/lib/attempt-review";

type Option = { id: string; text: string };

export default function QuestionReview({ number, prompt, type, options, studentAnswer, earnedPoints, points, isCorrect, correctAnswer, explanation, footer, showPoints = true }: { number: number; prompt: string; type: string; options: Option[] | null; studentAnswer: string | null; earnedPoints: number | null; points: number; isCorrect: boolean | null; correctAnswer?: string; explanation?: string | null; footer?: ReactNode; showPoints?: boolean }) {
  const selectedOption = type === "multiple_choice" ? options?.find((option) => option.id === studentAnswer) : undefined;
  const correctOption = correctAnswer && type === "multiple_choice" ? options?.find((option) => option.id === correctAnswer) : undefined;
  const optionLabel = (optionId: string) => { const index = options?.findIndex((option) => option.id === optionId) ?? -1; return index >= 0 ? String.fromCharCode(65 + index) : optionId; };
  const state = attemptReviewLabel(attemptReviewState(studentAnswer, isCorrect));
  const answer = selectedOption ? <><b>{optionLabel(selectedOption.id)}.</b> <MathText>{selectedOption.text}</MathText></> : <MathText>{studentAnswer || "No response"}</MathText>;
  const authorizedAnswer = correctOption ? <><b>{optionLabel(correctOption.id)}.</b> <MathText>{correctOption.text}</MathText></> : correctAnswer ? <MathText>{correctAnswer}</MathText> : null;

  return <article className="question-review">
    <header><span>Question {number}</span><span>{showPoints ? `${state} · ${earnedPoints ?? 0}/${points}` : state}</span></header>
    <div className="question-prompt question-review-prompt"><MathText>{prompt}</MathText></div>
    {type === "multiple_choice" && options?.length ? <ul className="question-review-options">{options.map((option) => <li className={`${option.id === selectedOption?.id ? "is-selected " : ""}${correctAnswer && option.id === correctOption?.id ? "is-correct" : ""}`} key={option.id}><b>{optionLabel(option.id)}</b><div><MathText>{option.text}</MathText></div><aside>{option.id === selectedOption?.id && <small>Your answer</small>}{correctAnswer && option.id === correctOption?.id && <small>Correct answer</small>}</aside></li>)}</ul> : null}
    <div className="question-review-answer"><span>Your answer</span><div>{answer}</div></div>
    {correctAnswer && <div className="question-review-answer"><span>Correct answer</span><div>{authorizedAnswer}</div></div>}
    {explanation && <div className="question-review-answer"><span>Explanation</span><div><MathText>{explanation}</MathText></div></div>}
    {footer}
  </article>;
}
