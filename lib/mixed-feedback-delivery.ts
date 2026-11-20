import { FeedbackSendError } from "./mixed-feedback-email.ts";

// Keeping the external send between two durable states avoids automatic repeat
// emails after a timeout, lost HTTP response, refresh, or concurrent click.
export async function deliverFeedback<T>(operations: {
  prepare: () => Promise<T>;
  begin: () => Promise<boolean>;
  send: (packet: T) => Promise<string>;
  finish: (status: "sent" | "failed" | "uncertain", messageId: string | null, error: string | null) => Promise<void>;
}) {
  let started = false;
  try {
    const packet = await operations.prepare();
    if (!await operations.begin()) return { outcome: "skipped" as const, error: "This paper changed or is being processed. Refresh before retrying." };
    started = true;
    const messageId = await operations.send(packet);
    await operations.finish("sent", messageId, null);
    return { outcome: "sent" as const };
  } catch (error) {
    const uncertain = started && (!(error instanceof FeedbackSendError) || error.uncertain);
    const message = error instanceof Error ? error.message : "Feedback could not be sent.";
    try { await operations.finish(uncertain ? "uncertain" : "failed", null, message); }
    catch { return { outcome: "uncertain" as const, error: "Delivery could not be recorded. Refresh and check Sent mail before retrying." }; }
    return { outcome: uncertain ? "uncertain" as const : "failed" as const, error: message };
  }
}
