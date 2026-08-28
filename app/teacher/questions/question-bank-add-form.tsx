"use client";

import { useActionState, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { addQuestionsToDraft, type QuestionBankActionState } from "../assignment-actions";

type Draft = { id: string; title: string };

export default function QuestionBankAddForm({ children, defaultAssignmentId, drafts }: { children: ReactNode; defaultAssignmentId?: string; drafts: Draft[] }) {
  const [state, action] = useActionState<QuestionBankActionState, FormData>(addQuestionsToDraft, null);
  const [selected, setSelected] = useState(0);
  return <form action={action} className="question-bank-form"><div className="question-bank-actions"><label>Add selected to <select defaultValue={defaultAssignmentId ?? ""} name="assignment_id" required><option disabled value="">Choose a private draft</option>{drafts.map((draft) => <option key={draft.id} value={draft.id}>{draft.title}</option>)}</select></label><AddButton disabled={!drafts.length || selected === 0} /></div>{state?.error && <p className="notice notice-error" role="alert">{state.error}</p>}<div onChange={(event) => { const target = event.target as HTMLInputElement; if (target.name === "question_ids") setSelected(event.currentTarget.querySelectorAll('input[name="question_ids"]:checked').length); }}>{children}</div></form>;
}

function AddButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return <button aria-live="polite" className="teacher-button" disabled={disabled || pending} type="submit">{pending ? "Adding..." : "Add selected"} <span aria-hidden="true">→</span></button>;
}
