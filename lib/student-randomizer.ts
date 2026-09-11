export const FULL_TURN = 360;

export function normalizeDegrees(value: number) {
  return ((value % FULL_TURN) + FULL_TURN) % FULL_TURN;
}

export function landingRotation(currentRotation: number, winnerIndex: number, participantCount: number, turns: number) {
  if (!Number.isInteger(participantCount) || participantCount < 1) throw new Error("participantCount must be a positive integer");
  if (!Number.isInteger(winnerIndex) || winnerIndex < 0 || winnerIndex >= participantCount) throw new Error("winnerIndex must identify a participant");
  const segmentAngle = FULL_TURN / participantCount;
  const targetRotation = normalizeDegrees(-winnerIndex * segmentAngle);
  const adjustment = normalizeDegrees(targetRotation - normalizeDegrees(currentRotation));
  return currentRotation + Math.max(1, Math.floor(turns)) * FULL_TURN + adjustment;
}

export function winnerIndexAtRotation(rotation: number, participantCount: number) {
  if (!Number.isInteger(participantCount) || participantCount < 1) throw new Error("participantCount must be a positive integer");
  const segmentAngle = FULL_TURN / participantCount;
  return Math.round(normalizeDegrees(-rotation) / segmentAngle) % participantCount;
}
