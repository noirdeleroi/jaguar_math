export type AssignmentPdfRelease = {
  kind: string;
  dueAt: string | null;
  releasedAt: string | null;
};

export function assignmentPdfIsAvailable({ kind, dueAt, releasedAt }: AssignmentPdfRelease, now = Date.now()) {
  const deadline = dueAt ? new Date(dueAt).getTime() : Number.NaN;
  const automaticHomeworkRelease = kind === "homework" && Number.isFinite(deadline) && deadline <= now;
  const release = releasedAt ? new Date(releasedAt).getTime() : Number.NaN;
  const manualRelease = Number.isFinite(release) && release <= now;
  return automaticHomeworkRelease || manualRelease;
}
