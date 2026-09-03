"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { createAndEmailStudent, type AddStudentState } from "./actions";
import CredentialActions from "./google-classroom/credential-actions";

type Classroom = { id: string; name: string; grade_level: 11 | 12; academic_year: string };
const initial: AddStudentState = {};

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return <button className="teacher-button" disabled={disabled || pending} type="submit">{pending ? "Creating & emailing..." : "Create & email student"}</button>;
}

export default function AddStudentForm({ classes, gmailSendEnabled }: { classes: Classroom[]; gmailSendEnabled: boolean }) {
  const [state, action] = useActionState(createAndEmailStudent, initial);
  return <section className="teacher-section teacher-add-student"><div className="section-row"><div><p className="eyebrow">New student</p><h2>Add a student</h2><p className="form-note">Creates the student account, enrolls them in a class, and emails a one-time password.</p></div></div>{!classes.length ? <p className="form-note">Create a class before adding a student.</p> : !gmailSendEnabled ? <p className="credential-email-notice">Reconnect Google to enable credential email delivery. <a href="/api/google/connect">Reconnect Google</a></p> : <form action={action} className="teacher-add-student-form"><label>Student email<input autoComplete="email" name="email" placeholder="student@example.edu" required type="email" /></label><label>Student name <span className="form-note">(optional)</span><input autoComplete="name" name="full_name" placeholder="Uses the email name if blank" /></label><label>Class<select defaultValue="" name="class_id" required><option disabled value="">Choose a class</option>{classes.map((classroom) => <option key={classroom.id} value={classroom.id}>{classroom.name} · Grade {classroom.grade_level} · {classroom.academic_year}</option>)}</select></label><SubmitButton disabled={!gmailSendEnabled} /></form>}{state.error && <p className="notice notice-error" role="alert">{state.error}</p>}{state.completed && state.emailDelivery === "sent" && <p className="notice notice-success">Student account created, enrolled, and emailed securely.</p>}{state.credential && state.emailDelivery === "failed" && <section className="credential-results"><h3>One-time credentials</h3><p>Email delivery failed. Download, print, or share these credentials now—they are not saved.</p><div className="credential-result-list"><div><strong>{state.credential.fullName}</strong><span>{state.credential.emailAddress}</span><code>{state.credential.temporaryPassword}</code><small className="credential-email-failed">⚠ Email failed</small></div></div><CredentialActions credentials={[state.credential]} /></section>}</section>;
}
