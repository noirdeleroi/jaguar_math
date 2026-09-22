export type AssignmentResultStatus = "not_started" | "in_progress" | "submitted";

export function assignmentResultStatus(activityStatus: AssignmentResultStatus | undefined, hasSubmittedAttempt: boolean): AssignmentResultStatus {
  if (hasSubmittedAttempt) return "submitted";
  return activityStatus ?? "not_started";
}
