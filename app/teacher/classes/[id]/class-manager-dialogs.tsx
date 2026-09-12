"use client";

import { useActionState, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { addStudentToClass, removeStudentFromClass, updateClass, updateStudentNickname } from "../../actions";
import DeleteClassButton from "./delete-class-button";
import styles from "./class-manager.module.css";

type Student = { id: string; fullName: string; nickname?: string; nicknameIsCustom?: boolean; email: string | null; gradeLevel: number | null };
type Classroom = { id: string; name: string; gradeLevel: number; academicYear: string };
type DialogName = "add" | "roster" | "settings" | null;

function SubmitButton({ children, danger = false }: { children: ReactNode; danger?: boolean }) {
  const { pending } = useFormStatus();
  return <button className={danger ? styles.removeButton : "teacher-button"} disabled={pending} type="submit">{pending ? "Saving…" : children}</button>;
}

function Modal({ children, label, onClose }: { children: ReactNode; label: string; onClose: () => void }) {
  useEffect(() => { const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); }; const overflow = document.body.style.overflow; document.body.style.overflow = "hidden"; window.addEventListener("keydown", close); return () => { document.body.style.overflow = overflow; window.removeEventListener("keydown", close); }; }, [onClose]);
  return <div aria-label={label} aria-modal="true" className={styles.modalBackdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }} role="dialog"><section className={styles.modal}><button aria-label={`Close ${label}`} autoFocus className={styles.modalClose} onClick={onClose} type="button">×</button>{children}</section></div>;
}

function NicknameEditor({ classroomId, student }: { classroomId: string; student: Student }) {
  const [state, action, pending] = useActionState(updateStudentNickname, {});
  return <form action={action} className={styles.nicknameForm} key={student.nickname}>
    <input name="class_id" type="hidden" value={classroomId} />
    <input name="student_id" type="hidden" value={student.id} />
    <label><span>Class nickname</span><input aria-label={`Nickname for ${student.fullName}`} defaultValue={student.nickname} maxLength={80} name="nickname" required /></label>
    <div><button disabled={pending} type="submit">{pending ? "Saving…" : "Save"}</button>{student.nicknameIsCustom ? <button disabled={pending} formNoValidate name="intent" type="submit" value="automatic">Use automatic</button> : null}</div>
    {state.error ? <small className={styles.nicknameError} role="alert">{state.error}</small> : state.success ? <small className={styles.nicknameSuccess} role="status">{state.success}</small> : null}
  </form>;
}

export default function ClassManagerDialogs({ classroom, enrolled, available }: { classroom: Classroom; enrolled: Student[]; available: Student[] }) {
  const [open, setOpen] = useState<DialogName>(null);
  function confirmRemoval(event: FormEvent<HTMLFormElement>, name: string) { if (!window.confirm(`Remove ${name} from ${classroom.name}? Their Jaguar account and submitted work will remain.`)) event.preventDefault(); }
  return <div className={styles.dialogActions}>
    <button className={styles.smallAction} onClick={() => setOpen("add")} type="button">＋ Add student</button>
    <button className={styles.smallAction} onClick={() => setOpen("roster")} type="button">Manage roster</button>
    <button className={styles.smallAction} onClick={() => setOpen("settings")} type="button">Class settings</button>

    {open === "add" ? <Modal label="Add a student" onClose={() => setOpen(null)}><p className="eyebrow">Enrollment</p><h2>Add a student</h2><p>Choose an existing Jaguar student account. This does not create a new student.</p>{available.length ? <form action={addStudentToClass} className={styles.modalForm}><input name="class_id" type="hidden" value={classroom.id} /><label>Existing student<select name="student_id" defaultValue="" required><option disabled value="">Choose a student</option>{available.map((student) => <option key={student.id} value={student.id}>{student.fullName} · Grade {student.gradeLevel ?? "—"}</option>)}</select></label><SubmitButton>Add student →</SubmitButton></form> : <p className={styles.modalNote}>Every existing Jaguar student is already assigned to this class.</p>}</Modal> : null}

    {open === "roster" ? <Modal label="Manage class roster" onClose={() => setOpen(null)}><p className="eyebrow">Roster controls</p><h2>{enrolled.length} students</h2><p>Edit the name used around this classroom. Full account names and student history stay unchanged.</p><div className={styles.rosterList}>{enrolled.map((student) => <article key={student.id}><div className={styles.rosterIdentity}><strong>{student.nickname}</strong><span>{student.fullName} · {student.email || "No email"} · Grade {student.gradeLevel ?? "—"}</span></div><NicknameEditor classroomId={classroom.id} student={student} /><form action={removeStudentFromClass} onSubmit={(event) => confirmRemoval(event, student.nickname || student.fullName)}><input name="class_id" type="hidden" value={classroom.id} /><input name="student_id" type="hidden" value={student.id} /><SubmitButton danger>Remove</SubmitButton></form></article>)}</div></Modal> : null}

    {open === "settings" ? <Modal label="Class settings" onClose={() => setOpen(null)}><p className="eyebrow">Class settings</p><h2>Edit {classroom.name}</h2><form action={updateClass} className={styles.modalForm}><input name="class_id" type="hidden" value={classroom.id} /><label>Class name<input defaultValue={classroom.name} name="name" required /></label><label>Grade<select defaultValue={classroom.gradeLevel} name="grade_level"><option value="11">Grade 11</option><option value="12">Grade 12</option></select></label><label>Academic year<input defaultValue={classroom.academicYear} name="academic_year" required /></label><SubmitButton>Save class details</SubmitButton></form><div className={styles.dangerZone}><p className="eyebrow">Danger zone</p><DeleteClassButton classId={classroom.id} className={classroom.name} /></div></Modal> : null}
  </div>;
}
