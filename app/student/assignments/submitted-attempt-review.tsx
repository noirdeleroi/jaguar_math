"use client";

import { useState } from "react";
import QuestionReview from "@/app/components/question-review";

type Option = { id: string; text: string };

type ReviewQuestion = {
  id: string;
  number: number;
  prompt: string;
  type: string;
  options: Option[] | null;
  studentAnswer: string | null;
  earnedPoints: number | null;
  points: number;
  isCorrect: boolean | null;
  correctAnswer?: string;
  explanation?: string | null;
};

function reviewState(isCorrect: boolean | null) {
  return isCorrect === true ? "correct" : isCorrect === false ? "incorrect" : "unscored";
}

function reviewLabel(isCorrect: boolean | null) {
  return isCorrect === true ? "Correct" : isCorrect === false ? "Incorrect" : "Not yet scored";
}

export default function SubmittedAttemptReview({ questions }: { questions: ReviewQuestion[] }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const question = questions[currentIndex];

  if (!question) return null;

  const state = reviewState(question.isCorrect);

  return <section className={`submitted-review ${state}`}>
    <header className="submitted-review-header">
      <div><p className="eyebrow">Question breakdown</p><h3>Question {question.number} of {questions.length}</h3></div>
      <span className={`submitted-review-result ${state}`}>{reviewLabel(question.isCorrect)} · {question.earnedPoints ?? 0}/{question.points}</span>
    </header>
    <nav aria-label="Submitted question navigation" className="submitted-review-navigation">
      {questions.map((item, index) => {
        const itemState = reviewState(item.isCorrect);
        const isCurrent = index === currentIndex;
        return <button aria-current={isCurrent ? "step" : undefined} aria-label={`Question ${item.number}: ${reviewLabel(item.isCorrect)}`} className={`submitted-review-question ${itemState}${isCurrent ? " is-current" : ""}`} key={item.id} onClick={() => setCurrentIndex(index)} type="button">{item.number}</button>;
      })}
    </nav>
    <div className="submitted-review-stage">
      <QuestionReview correctAnswer={question.correctAnswer} earnedPoints={question.earnedPoints} explanation={question.explanation} isCorrect={question.isCorrect} number={question.number} options={question.options} points={question.points} prompt={question.prompt} studentAnswer={question.studentAnswer} type={question.type} />
    </div>
    <footer className="submitted-review-controls">
      <button disabled={currentIndex === 0} onClick={() => setCurrentIndex((index) => index - 1)} type="button">← Previous</button>
      <button disabled={currentIndex === questions.length - 1} onClick={() => setCurrentIndex((index) => index + 1)} type="button">Next question →</button>
    </footer>
  </section>;
}
