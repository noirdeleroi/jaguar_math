export type ExamActivityEvent = "page_hidden" | "page_visible" | "window_blur" | "window_focus" | "fullscreen_exited" | "fullscreen_restored" | "fullscreen_unavailable";
export type ExamActivityResult = { focusViolations: number; autoSubmitted: boolean } | { error: string };
type QueuedEvent = { eventId: string; eventType: ExamActivityEvent; awayDurationSeconds?: number };

const queueKey = (attemptId: string) => `jaguar-exam-events:${attemptId}`;
const readQueue = (attemptId: string): QueuedEvent[] => {
  try { const parsed = JSON.parse(localStorage.getItem(queueKey(attemptId)) ?? "[]"); return Array.isArray(parsed) ? parsed.slice(0, 200) : []; } catch { return []; }
};
const writeQueue = (attemptId: string, events: QueuedEvent[]) => {
  try { if (events.length) localStorage.setItem(queueKey(attemptId), JSON.stringify(events.slice(-200))); else localStorage.removeItem(queueKey(attemptId)); } catch { /* Storage can be unavailable in private browser modes. */ }
};

async function postExamActivity(attemptId: string, event: QueuedEvent, keepalive = false): Promise<ExamActivityResult> {
  const response = await fetch("/api/exam-activity", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ attemptId, ...event }), credentials: "same-origin", keepalive });
  const data = await response.json().catch(() => null) as { focusViolations?: unknown; autoSubmitted?: unknown; error?: unknown } | null;
  if (!response.ok || !data || typeof data.focusViolations !== "number") return { error: typeof data?.error === "string" ? data.error : "Exam activity could not be recorded. It is queued on this device." };
  return { focusViolations: data.focusViolations, autoSubmitted: data.autoSubmitted === true };
}

export async function sendExamActivity(attemptId: string, eventType: ExamActivityEvent, awayDurationSeconds?: number, keepalive = false): Promise<ExamActivityResult> {
  const event = { eventId: crypto.randomUUID(), eventType, awayDurationSeconds };
  try {
    const result = await postExamActivity(attemptId, event, keepalive);
    if ("error" in result) writeQueue(attemptId, [...readQueue(attemptId), event]);
    return result;
  } catch { writeQueue(attemptId, [...readQueue(attemptId), event]); return { error: "Exam activity is queued until the connection returns." }; }
}

export async function flushExamActivityQueue(attemptId: string): Promise<ExamActivityResult | null> {
  const queued = readQueue(attemptId);
  if (!queued.length) return null;
  let latest: ExamActivityResult | null = null;
  for (let index = 0; index < queued.length; index += 1) {
    try {
      latest = await postExamActivity(attemptId, queued[index]);
      if ("error" in latest) { writeQueue(attemptId, queued.slice(index)); return latest; }
      writeQueue(attemptId, queued.slice(index + 1));
      if (latest.autoSubmitted) return latest;
    } catch { writeQueue(attemptId, queued.slice(index)); return { error: "Exam activity is queued until the connection returns." }; }
  }
  return latest;
}
