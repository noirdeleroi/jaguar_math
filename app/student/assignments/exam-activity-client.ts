export type ExamActivityEvent = "page_hidden" | "page_visible" | "window_blur" | "window_focus" | "fullscreen_exited" | "fullscreen_restored" | "fullscreen_unavailable";
export type ExamActivityResult = { focusViolations: number; autoSubmitted: boolean } | { error: string };

export async function sendExamActivity(attemptId: string, eventType: ExamActivityEvent, awayDurationSeconds?: number, keepalive = false): Promise<ExamActivityResult> {
  try {
    const response = await fetch("/api/exam-activity", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ attemptId, eventId: crypto.randomUUID(), eventType, awayDurationSeconds }), credentials: "same-origin", keepalive });
    const data = await response.json().catch(() => null) as { focusViolations?: unknown; autoSubmitted?: unknown; error?: unknown } | null;
    if (!response.ok || !data || typeof data.focusViolations !== "number") return { error: typeof data?.error === "string" ? data.error : "Exam activity could not be recorded. Your saved answers are unaffected." };
    return { focusViolations: data.focusViolations, autoSubmitted: data.autoSubmitted === true };
  } catch { return { error: "Exam activity could not be recorded. Your saved answers are unaffected." }; }
}
