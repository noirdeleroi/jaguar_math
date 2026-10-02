export const CLASSWORK_GRADE_NOTE_LIMIT = 2000;

export function normalizeClassworkGradeNote(value: unknown): { note: string; error?: string } {
  if (typeof value !== "string") return { note: "", error: "The classwork note must be text." };
  const note = value.replace(/\r\n?/g, "\n").trim();
  if (note.length > CLASSWORK_GRADE_NOTE_LIMIT) return { note: "", error: `Keep the classwork note under ${CLASSWORK_GRADE_NOTE_LIMIT} characters.` };
  return { note };
}
