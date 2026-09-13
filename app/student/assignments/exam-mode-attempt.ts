export function resolveExamRunnerAttempt<T>(activeAttempt: T | undefined, initialAttempt: T | undefined) {
  return activeAttempt ?? initialAttempt;
}
