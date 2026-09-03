import MathText from "@/app/components/math-text";

type Question = { id: string; prompt: string; type: string; options: { id: string; text: string }[] | null };
type Response = { student_answer: string | null; is_correct: boolean | null; points_awarded: number | null } | undefined;
type AnswerReview = { correct_answer: string; explanation: string | null } | undefined;

export default function SubmittedQuestionReview({ position, points, question, response, answerReview }: { position: number; points: number; question: Question; response: Response; answerReview: AnswerReview }) {
  const studentAnswer = response?.student_answer ?? "";
  const selectedOption = question.type === "multiple_choice" ? question.options?.find((option) => option.id === studentAnswer) : undefined;
  const correctOption = answerReview && question.type === "multiple_choice" ? question.options?.find((option) => option.id === answerReview.correct_answer) : undefined;
  const state = response?.is_correct === true ? "Correct" : response?.is_correct === false ? "Incorrect" : "Not yet scored";
  const answer = selectedOption ? <><b>{selectedOption.id}.</b> <MathText>{selectedOption.text}</MathText></> : <MathText>{studentAnswer || "No response"}</MathText>;
  const correctAnswer = correctOption ? <><b>{correctOption.id}.</b> <MathText>{correctOption.text}</MathText></> : answerReview ? <MathText>{answerReview.correct_answer}</MathText> : null;

  return <article>
    <span>Question {position} · {state} · {response?.points_awarded ?? 0}/{points}</span>
    <div className="question-prompt review-prompt"><MathText>{question.prompt}</MathText></div>
    {question.type === "multiple_choice" && question.options?.length ? <ul className="review-options">{question.options.map((option) => <li className="review-option" key={option.id}><b>{option.id}</b><div className="review-option-text"><MathText>{option.text}</MathText></div>{option.id === selectedOption?.id && <small className="review-option-selected">Your selection</small>}{answerReview && option.id === correctOption?.id && <small className="review-option-correct">Correct answer</small>}</li>)}</ul> : null}
    <div className="review-answer"><span>Your answer</span><div className="review-answer-value">{answer}</div></div>
    {answerReview && <><div className="review-answer"><span>Correct answer</span><div className="review-answer-value">{correctAnswer}</div></div>{answerReview.explanation && <div className="review-answer"><span>Explanation</span><div className="review-answer-value"><MathText>{answerReview.explanation}</MathText></div></div>}</>}
  </article>;
}
