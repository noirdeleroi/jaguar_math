"use client";

import { useActionState, useCallback, useState, useTransition } from "react";
import { CLASS_NOTE_LIMIT, type ClassNoteActionState, type ClassNoteRecord } from "@/lib/class-notes";
import { createClassNote, deleteClassNote } from "./actions";
import styles from "./notes.module.css";

type Classroom = { id: string; name: string; grade_level: number; academic_year: string };

const initialActionState: ClassNoteActionState = { status: "idle" };
const noteDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "America/Bogota",
});

function ClassNotesCard({ classroom, notes, onCreated, onDeleted }: {
  classroom: Classroom;
  notes: ClassNoteRecord[];
  onCreated: (note: ClassNoteRecord) => void;
  onDeleted: (noteId: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [actionState, formAction, isSaving] = useActionState(async (previous: ClassNoteActionState, formData: FormData) => {
    const nextState = await createClassNote(previous, formData);
    if (nextState.status === "success") {
      onCreated(nextState.note);
      setDraft("");
    }
    return nextState;
  }, initialActionState);
  const [isDeleting, startDeleting] = useTransition();
  const [deletingNoteId, setDeletingNoteId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState("");

  function handleDelete(note: ClassNoteRecord) {
    if (!window.confirm(`Delete the ${noteDateFormatter.format(new Date(note.created_at))} note?`)) return;
    setDeleteError("");
    setDeletingNoteId(note.id);
    startDeleting(async () => {
      const result = await deleteClassNote(note.id);
      if (result.error) setDeleteError(result.error);
      else onDeleted(note.id);
      setDeletingNoteId(null);
    });
  }

  const hasDraft = Boolean(draft.trim());
  const feedback = actionState.status === "error"
    ? actionState.message
    : actionState.status === "success" && !hasDraft
      ? "Saved"
      : "Date added automatically";

  return <section className={styles.classCard} data-grade={classroom.grade_level} aria-labelledby={`class-${classroom.id}`}>
    <header className={styles.classHeader}>
      <div>
        <span>Grade {classroom.grade_level}</span>
        <h2 id={`class-${classroom.id}`}>{classroom.name}</h2>
      </div>
      <span className={styles.noteCount}>{notes.length} {notes.length === 1 ? "note" : "notes"}</span>
    </header>

    <form action={formAction} className={styles.composer}>
      <input name="class_id" type="hidden" value={classroom.id} />
      <label className={styles.srOnly} htmlFor={`note-${classroom.id}`}>Add a note for {classroom.name}</label>
      <textarea
        id={`note-${classroom.id}`}
        name="body"
        maxLength={CLASS_NOTE_LIMIT}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key === "Enter") event.currentTarget.form?.requestSubmit();
        }}
        placeholder="Where did you stop? What comes next?"
        rows={2}
        value={draft}
      />
      <div className={styles.composerFooter}>
        <span className={actionState.status === "error" ? styles.errorText : undefined} aria-live="polite">{isSaving ? "Saving…" : feedback}</span>
        <span>{draft.length}/{CLASS_NOTE_LIMIT}</span>
        <button disabled={isSaving || !hasDraft} type="submit"><b aria-hidden="true">+</b> Add</button>
      </div>
    </form>

    <div className={styles.notesRegion}>
      {deleteError && <p className={styles.deleteError} role="alert">{deleteError}</p>}
      {notes.length ? <ol className={styles.noteList} aria-label={`${classroom.name} notes`}>
        {notes.map((note) => <li className={styles.note} key={note.id}>
          <div>
            <time dateTime={note.created_at}>{noteDateFormatter.format(new Date(note.created_at))}</time>
            <button
              aria-label={`Delete note from ${noteDateFormatter.format(new Date(note.created_at))}`}
              disabled={isDeleting && deletingNoteId === note.id}
              onClick={() => handleDelete(note)}
              title="Delete note"
              type="button"
            >{isDeleting && deletingNoteId === note.id ? "…" : "×"}</button>
          </div>
          <p>{note.body}</p>
        </li>)}
      </ol> : <div className={styles.emptyNotes}><span aria-hidden="true">✦</span><p>No notes yet</p><small>Add a quick marker for your next lesson.</small></div>}
    </div>
  </section>;
}

export default function NotesBoard({ classrooms, initialNotes }: { classrooms: Classroom[]; initialNotes: ClassNoteRecord[] }) {
  const [notes, setNotes] = useState(initialNotes);

  const handleCreated = useCallback((createdNote: ClassNoteRecord) => {
    setNotes((current) => current.some((note) => note.id === createdNote.id) ? current : [createdNote, ...current]);
  }, []);
  const handleDeleted = useCallback((noteId: string) => {
    setNotes((current) => current.filter((note) => note.id !== noteId));
  }, []);

  return <div className={styles.board}>
    {classrooms.map((classroom) => <ClassNotesCard
      classroom={classroom}
      key={classroom.id}
      notes={notes.filter((note) => note.class_id === classroom.id)}
      onCreated={handleCreated}
      onDeleted={handleDeleted}
    />)}
  </div>;
}
