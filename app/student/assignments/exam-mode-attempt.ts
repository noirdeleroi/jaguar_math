export function resolveExamRunnerAttempt<T>(activeAttempt: T | undefined, initialAttempt: T | undefined) {
  return activeAttempt ?? initialAttempt;
}

export function canStartExamFromWaitingRoom({ questionsReleased, requireFullscreen, fullscreenActive, waitingRoomViolation, starting }: { questionsReleased: boolean; requireFullscreen: boolean; fullscreenActive: boolean; waitingRoomViolation: boolean; starting: boolean }) {
  return questionsReleased && !starting && !waitingRoomViolation && (!requireFullscreen || fullscreenActive);
}
