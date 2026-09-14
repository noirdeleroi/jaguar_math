export type HomeworkPdfRelease = {
  kind: string;
  dueAt: string | null;
  releasedAt: string | null;
};

export function homeworkPdfIsAvailable({ kind, dueAt, releasedAt }: HomeworkPdfRelease, now = Date.now()) {
  if (kind !== "homework" || !dueAt || !releasedAt) return false;
  const deadline = new Date(dueAt).getTime();
  const release = new Date(releasedAt).getTime();
  return Number.isFinite(deadline) && deadline <= now && Number.isFinite(release) && release <= now;
}
