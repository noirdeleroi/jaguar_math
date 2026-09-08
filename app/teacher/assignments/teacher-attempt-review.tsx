"use client";

import { useState } from "react";
import QuestionReview from "@/app/components/question-review";

type Option = { id: string; text: string };
type Skill = { code: string; name: string; isPrimary: boolean };

export type TeacherReviewQuestion = {
  id: string;
  number: number;
  prompt: string;
  type: string;
  options: Option[] | null;
  studentAnswer: string | null;
  earnedPoints: number | null;
  points: number;
  isCorrect: boolean | null;
  correctAnswer: string;
  explanation: string | null;
  answered: boolean;
  skills: Skill[];
};

function questionState(question: TeacherReviewQuestion) {
  if (!question.answered) return "unanswered";
  if (question.isCorrect === true) return "correct";
  if (question.isCorrect === false) return "incorrect";
  return "unscored";
}

function stateLabel(question: TeacherReviewQuestion) {
  const state = questionState(question);
  if (state === "correct") return "Correct";
  if (state === "incorrect") return "Incorrect";
  if (state === "unanswered") return "Unanswered";
  return "Not scored";
}

export default function TeacherAttemptReview({ questions }: { questions: TeacherReviewQuestion[] }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const question = questions[currentIndex];
  if (!question) return <p className="form-note">No questions are available for this attempt.</p>;
  const state = questionState(question);

  return <section className="teacher-section teacher-attempt-review" aria-labelledby="question-review-heading">
    <header className="teacher-attempt-review-header">
      <div><p className="eyebrow">Question-by-question</p><h2 id="question-review-heading">Review each response</h2><p>Select a question to see the student&apos;s answer, correct answer, explanation, and linked skills.</p></div>
      <div className="teacher-attempt-legend" aria-label="Question status colors"><span className="correct">Correct</span><span className="incorrect">Incorrect</span><span className="unanswered">Unanswered</span></div>
    </header>
    <nav aria-label="Attempt question navigation" className="teacher-attempt-question-nav">
      {questions.map((item, index) => {
        const itemState = questionState(item); const isCurrent = index === currentIndex;
        return <button aria-current={isCurrent ? "step" : undefined} aria-label={`Question ${item.number}: ${stateLabel(item)}`} className={`${itemState}${isCurrent ? " is-current" : ""}`} key={item.id} onClick={() => setCurrentIndex(index)} type="button"><span>{item.number}</span><small>{stateLabel(item)}</small></button>;
      })}
    </nav>
    <div className={`teacher-attempt-question-stage ${state}`}>
      <div className="teacher-attempt-current-heading"><div><span>Question {question.number} of {questions.length}</span><strong>{stateLabel(question)}</strong></div><b>{question.earnedPoints ?? 0} / {question.points} points</b></div>
      <QuestionReview correctAnswer={question.correctAnswer} earnedPoints={question.earnedPoints} explanation={question.explanation} footer={<p className="attempt-skills">Jaguar skills: {question.skills.length ? question.skills.map((skill) => <span key={skill.code}>{skill.isPrimary ? "Primary · " : ""}{skill.code} — {skill.name}</span>) : "No linked skill"}</p>} isCorrect={question.isCorrect} number={question.number} options={question.options} points={question.points} prompt={question.prompt} studentAnswer={question.studentAnswer} type={question.type} />
    </div>
    <footer className="teacher-attempt-review-controls"><button disabled={currentIndex === 0} onClick={() => setCurrentIndex((index) => index - 1)} type="button">← Previous</button><span>Question {currentIndex + 1} of {questions.length}</span><button disabled={currentIndex === questions.length - 1} onClick={() => setCurrentIndex((index) => index + 1)} type="button">Next →</button></footer>
  </section>;
}
