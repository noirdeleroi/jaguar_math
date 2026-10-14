import type { ExamQuestion } from "./exam-launch";

export async function startExam(assignmentId: string): Promise<{ error: string } | { attemptId: string; expiresAt: string | null; formCode: string | null; focusViolations: number; questions: ExamQuestion[] }> {
  const response = await fetch("/api/exam-start", {
    method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ assignmentId }), signal: AbortSignal.timeout(25_000),
  });
  const result = await response.json();
  if (!response.ok || typeof result.attemptId !== "string" || !Array.isArray(result.questions)) return { error: typeof result.error === "string" ? result.error : "The test could not load. Please retry." };
  return result;
}
