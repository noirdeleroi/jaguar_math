export const CLASS_NOTE_LIMIT = 280;

export type ClassNoteRecord = {
  id: string;
  class_id: string;
  body: string;
  created_at: string;
};

export type ClassNoteActionState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "success"; note: ClassNoteRecord };

export function normalizeClassNote(value: FormDataEntryValue | null): { body: string } | { error: string } {
  if (typeof value !== "string") return { error: "Write a note before saving." } as const;
  const body = value.replace(/\r\n?/g, "\n").trim();
  if (!body) return { error: "Write a note before saving." } as const;
  if (body.length > CLASS_NOTE_LIMIT) return { error: `Keep notes to ${CLASS_NOTE_LIMIT} characters or fewer.` } as const;
  return { body } as const;
}
