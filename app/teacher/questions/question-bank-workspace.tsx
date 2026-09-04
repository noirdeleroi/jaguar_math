"use client";

import { useState } from "react";
import Link from "next/link";
import MathText from "@/app/components/math-text";

type Option = { id: string; text: string };
type Skill = { code: string; name: string; domain: string; weight: number; is_primary: boolean };
export type BankQuestionDetail = {
  id: string;
  prompt: string;
  type: string;
  difficulty: number;
  options: Option[] | null;
  created_at: string;
  points: number;
  skills: Skill[];
  correctAnswer: string | null;
  numericTolerance: number | null;
  explanation: string | null;
  source: { id: string; title: string; status: string } | null;
  editableDraft: { id: string; title: string } | null;
};

function typeLabel(type: string) {
  return type.replaceAll("_", " ");
}

function AnswerValue({ question }: { question: BankQuestionDetail }) {
  const matchingOption = question.options?.find((option) => option.id === question.correctAnswer);
  if (matchingOption) return <><b>{matchingOption.id}.</b> <MathText>{matchingOption.text}</MathText></>;
  return <MathText>{question.correctAnswer || "No answer key"}</MathText>;
}

export default function QuestionBankWorkspace({ canSelect, questions }: { canSelect: boolean; questions: BankQuestionDetail[] }) {
  const [openQuestion, setOpenQuestion] = useState<BankQuestionDetail | null>(null);
  return <div className="question-bank-workspace">
    <div className="question-bank-list" aria-label="Questions">
      {questions.map((question) => <article className="question-bank-card" key={question.id}>
        {canSelect && <label className="question-bank-select"><input aria-label={`Select question: ${question.prompt}`} name="question_ids" type="checkbox" value={question.id} /><span>Select</span></label>}
        <button className="question-bank-card-open" onClick={() => setOpenQuestion(question)} type="button">
          <span className="question-bank-card-meta">{typeLabel(question.type)} · Difficulty {question.difficulty} · {question.points} {question.points === 1 ? "pt" : "pts"}</span>
          <strong><MathText>{question.prompt}</MathText></strong>
          <small>{question.skills.length ? question.skills.map((skill) => skill.code).join(" · ") : "No Jaguar skill linked"}</small>
          <span className="question-bank-card-arrow" aria-hidden="true">View details →</span>
        </button>
      </article>)}
    </div>
    {openQuestion && <div className="question-detail-backdrop" onMouseDown={() => setOpenQuestion(null)} role="presentation"><section aria-labelledby="question-detail-title" aria-modal="true" className="question-detail-modal" onMouseDown={(event) => event.stopPropagation()} role="dialog"><header><div><p className="eyebrow">Question detail</p><h2 id="question-detail-title">{typeLabel(openQuestion.type)}</h2><p>Difficulty {openQuestion.difficulty} · {openQuestion.points} {openQuestion.points === 1 ? "point" : "points"} · Created {new Date(openQuestion.created_at).toLocaleDateString()}</p></div><button aria-label="Close question detail" className="question-detail-close" onClick={() => setOpenQuestion(null)} type="button">×</button></header><div className="question-detail-body"><section className="question-detail-prompt"><p className="question-number">Student-facing question</p><div className="question-prompt"><MathText>{openQuestion.prompt}</MathText></div>{openQuestion.options?.length ? <div className="question-detail-options">{openQuestion.options.map((option) => <div className={option.id === openQuestion.correctAnswer ? "is-correct" : ""} key={option.id}><b>{option.id}</b><MathText>{option.text}</MathText></div>)}</div> : <div className="question-detail-answer-field">Students enter a {typeLabel(openQuestion.type)} response.</div>}</section><aside className="question-detail-key"><div><span>Correct answer</span><strong><AnswerValue question={openQuestion} /></strong>{openQuestion.type === "numeric" && <small>Numeric tolerance: {openQuestion.numericTolerance ?? 0}</small>}</div><div><span>Solution / explanation</span><p><MathText>{openQuestion.explanation || "No explanation was provided."}</MathText></p></div><div><span>Jaguar skills</span><ul>{openQuestion.skills.length ? openQuestion.skills.map((skill) => <li key={skill.code}><b>{skill.is_primary ? "Primary · " : ""}{skill.code}</b><small>{skill.name} · weight {skill.weight}</small></li>) : <li>No skills linked</li>}</ul></div></aside></div><footer><div><span>Source</span><strong>{openQuestion.source?.title || "Question bank"}</strong>{openQuestion.source && <small>{openQuestion.source.status}</small>}</div>{openQuestion.editableDraft ? <Link className="teacher-button" href={`/teacher/assignments/${openQuestion.editableDraft.id}`}>Edit in {openQuestion.editableDraft.title} <span>→</span></Link> : <p className="form-note">This question is not in an editable draft. Add a copy to a draft to make changes safely.</p>}</footer></section></div>}
  </div>;
}
