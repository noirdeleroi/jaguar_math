export type ExamActivityEvent = "page_hidden" | "page_visible" | "window_blur" | "window_focus" | "fullscreen_exited" | "fullscreen_restored" | "fullscreen_unavailable";
export type ExamActivityResult = { focusViolations: number; autoSubmitted: boolean } | { error: string };
type QueuedEvent = { eventId: string; eventType: ExamActivityEvent; awayDurationSeconds?: number };

const maxQueuedEvents = 500;
const queueKey = (attemptId: string) => `jaguar-exam-events:${attemptId}`;
const readQueue = (attemptId: string): QueuedEvent[] => {
  try { const parsed = JSON.parse(localStorage.getItem(queueKey(attemptId)) ?? "[]"); return Array.isArray(parsed) ? parsed.slice(-maxQueuedEvents) : []; } catch { return []; }
};
const writeQueue = (attemptId: string, events: QueuedEvent[]) => {
  try { if (events.length) localStorage.setItem(queueKey(attemptId), JSON.stringify(events.slice(-maxQueuedEvents))); else localStorage.removeItem(queueKey(attemptId)); } catch { /* Storage can be unavailable in private browser modes. */ }
};
const queueEvent = (attemptId: string, event: QueuedEvent) => writeQueue(attemptId, [...readQueue(attemptId).filter((queued) => queued.eventId !== event.eventId), event]);
const removeQueuedEvent = (attemptId: string, eventId: string) => writeQueue(attemptId, readQueue(attemptId).filter((event) => event.eventId !== eventId));

async function postExamActivity(attemptId: string, event: QueuedEvent, keepalive = false): Promise<ExamActivityResult> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch("/api/exam-activity", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ attemptId, ...event }), credentials: "same-origin", keepalive, signal: controller.signal });
    const data = await response.json().catch(() => null) as { focusViolations?: unknown; autoSubmitted?: unknown; error?: unknown } | null;
    if (!response.ok || !data || typeof data.focusViolations !== "number") return { error: typeof data?.error === "string" ? data.error : "Exam activity could not be recorded. It is queued on this device." };
    return { focusViolations: data.focusViolations, autoSubmitted: data.autoSubmitted === true };
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function sendExamActivity(attemptId: string, eventType: ExamActivityEvent, awayDurationSeconds?: number, keepalive = false): Promise<ExamActivityResult> {
  const event = { eventId: crypto.randomUUID(), eventType, awayDurationSeconds };
  // Persist before starting the request: mobile browsers can freeze the page as
  // soon as it becomes hidden, before a failed keepalive request rejects.
  queueEvent(attemptId, event);
  try {
    const result = await postExamActivity(attemptId, event, keepalive);
    if (!("error" in result)) removeQueuedEvent(attemptId, event.eventId);
    return result;
  } catch { return { error: "Exam activity is queued until the connection returns." }; }
}

export async function flushExamActivityQueue(attemptId: string): Promise<ExamActivityResult | null> {
  const queued = readQueue(attemptId);
  if (!queued.length) return null;
  let latest: ExamActivityResult | null = null;
  for (const event of queued) {
    try {
      latest = await postExamActivity(attemptId, event);
      if ("error" in latest) return latest;
      removeQueuedEvent(attemptId, event.eventId);
      if (latest.autoSubmitted) return latest;
    } catch { return { error: "Exam activity is queued until the connection returns." }; }
  }
  return latest;
}
