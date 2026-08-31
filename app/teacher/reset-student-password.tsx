"use client";

import { useActionState, type FormEvent } from "react";
import { resetStudentPassword, type ResetPasswordState } from "./actions";

const initial: ResetPasswordState = {};

export default function ResetStudentPassword({ studentId }: { studentId: string }) {
  const [state, action, pending] = useActionState(resetStudentPassword, initial);
  function confirmReset(event: FormEvent<HTMLFormElement>) { if (!window.confirm("Reset this student's password? They will be required to choose a new password the next time they sign in.")) event.preventDefault(); }
  return <form className="student-password-reset" action={action} onSubmit={confirmReset}><input name="student_id" type="hidden" value={studentId} /><button className="text-button" disabled={pending} type="submit">{pending ? "Resetting..." : "Reset password"}</button>{state.error && <small className="form-error" role="alert">{state.error}</small>}{state.credential && <div className="student-password-result"><strong>New temporary password</strong><code>{state.credential.temporaryPassword}</code><small>{state.credential.emailAddress} · shown once only</small></div>}</form>;
}
