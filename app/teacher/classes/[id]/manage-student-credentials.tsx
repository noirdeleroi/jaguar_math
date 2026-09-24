"use client";

import { useActionState, useEffect, useId, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { resetClassStudentPasswords, type BulkResetPasswordState } from "../../actions";
import CredentialActions from "../../google-classroom/credential-actions";

type Student = { id: string; fullName: string; emailAddress: string };
const initial: BulkResetPasswordState = {};

export default function ManageStudentCredentials({ classId, gmailSendEnabled, students }: { classId: string; gmailSendEnabled: boolean; students: Student[] }) {
  const [open, setOpen] = useState(false); const [selected, setSelected] = useState<Set<string>>(new Set()); const [selectionError, setSelectionError] = useState("");
  const titleId = useId();
  const [state, action, pending] = useActionState(resetClassStudentPasswords, initial); const allSelected = students.length > 0 && selected.size === students.length;
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function closeOnEscape(event: KeyboardEvent) { if (event.key === "Escape") setOpen(false); }
    window.addEventListener("keydown", closeOnEscape);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", closeOnEscape); };
  }, [open]);
  function toggleStudent(studentId: string, checked: boolean) { setSelected((current) => { const next = new Set(current); if (checked) next.add(studentId); else next.delete(studentId); return next; }); setSelectionError(""); }
  function toggleAll(checked: boolean) { setSelected(checked ? new Set(students.map((student) => student.id)) : new Set()); setSelectionError(""); }
  function confirmReset(event: FormEvent<HTMLFormElement>) { if (!selected.size) { event.preventDefault(); setSelectionError("Select at least one student."); return; } if (!window.confirm("This will replace the selected students' current passwords. Continue?")) event.preventDefault(); }
  return <div className="class-credentials">
    <button aria-expanded={open} aria-haspopup="dialog" className="secondary-inline-button" onClick={() => setOpen(true)} type="button">Manage credentials</button>
    {open && createPortal(<div className="credential-manager-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) setOpen(false); }}>
      <div aria-labelledby={titleId} aria-modal="true" className="credential-manager" role="dialog">
      <div className="credential-manager-header"><h2 id={titleId}>Credential manager</h2><button aria-label="Close credential manager" autoFocus className="credential-manager-close" onClick={() => setOpen(false)} type="button">×</button></div>
      <div className="credential-manager-body">
      <p className="credential-warning"><strong>Warning:</strong> This will replace the selected students&apos; current passwords.</p>
      {!gmailSendEnabled && <p className="credential-email-notice">Reconnect Google to enable email sending. <a href="/api/google/connect">Reconnect Google</a></p>}
      <form action={action} onSubmit={confirmReset}>
        <input name="class_id" type="hidden" value={classId} />
        <label className="credential-select-all"><input checked={allSelected} onChange={(event) => toggleAll(event.target.checked)} type="checkbox" /> Select all students</label>
        <div className="credential-student-list">{students.map((student) => <label key={student.id}><input checked={selected.has(student.id)} name="student_id" onChange={(event) => toggleStudent(student.id, event.target.checked)} type="checkbox" value={student.id} /><span><strong>{student.fullName}</strong><small>{student.emailAddress}</small></span></label>)}</div>
        <div className="credential-submit-actions"><button className="secondary-inline-button" disabled={pending || !selected.size} name="delivery" type="submit" value="manual">{pending ? "Generating..." : "Generate temporary passwords"}</button>{gmailSendEnabled && <button className="teacher-button" disabled={pending || !selected.size} name="delivery" type="submit" value="email">{pending ? "Generating..." : "Generate & email credentials"}</button>}</div>
      </form>
      {selectionError && <p className="form-error" role="alert">{selectionError}</p>}{state.error && <p className="form-error" role="alert">{state.error}</p>}
      {state.credentials?.length ? <div className="credential-results"><h3>New one-time credentials</h3><p>Download or print these now. Temporary passwords are not saved.</p><div className="credential-result-list">{state.credentials.map((credential) => <div key={credential.emailAddress}><strong>{credential.fullName}</strong><span>{credential.emailAddress}</span><code>{credential.temporaryPassword}</code>{credential.emailDelivery && <small className={credential.emailDelivery === "sent" ? "credential-email-sent" : "credential-email-failed"}>{credential.emailDelivery === "sent" ? "✓ Sent" : "⚠ Email failed"}</small>}</div>)}</div><CredentialActions credentials={state.credentials} /></div> : null}
      </div>
      </div>
    </div>, document.body)}
  </div>;
}
