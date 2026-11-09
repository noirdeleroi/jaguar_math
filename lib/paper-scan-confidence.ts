import type { BubbleReading } from "./paper-scan-layout.ts";

const clamp = (value: number) => Math.max(0, Math.min(1, value));
// A signal-clarity score, not a statistically calibrated probability of accuracy.
export function markConfidence(
  densities: number[],
  quadrants?: number[],
  outside?: number[],
) {
  if (densities.length !== 4 || densities.some((d) => !Number.isFinite(d)))
    return null;
  const ranked = densities
    .map((density, index) => ({ density, index }))
    .sort((a, b) => b.density - a.density);
  const top = ranked[0];
  const second = ranked[1].density;
  if (top.density < 0.025) return Math.round(99 - top.density * 400);
  const dominance = clamp((top.density - second) / Math.max(top.density, 0.12));
  const strength = clamp(top.density / 0.55);
  const coverage = quadrants ? clamp(quadrants[top.index] / 0.45) : strength;
  const purity = clamp(1 - second / 0.22);
  const penalty = Math.min(10, (outside?.[top.index] ?? 0) * 20);
  return Math.round(
    Math.max(
      0,
      Math.min(
        99,
        45 +
          25 * dominance +
          15 * strength +
          10 * coverage +
          5 * purity -
          penalty,
      ),
    ),
  );
}
export function readingConfidence(reading: BubbleReading | undefined) {
  if (!reading) return null;
  return typeof reading.confidence === "number"
    ? reading.confidence
    : markConfidence(reading.densities);
}
export function averageConfidence(readings: BubbleReading[]) {
  const values = readings
    .map(readingConfidence)
    .filter((v): v is number => v !== null);
  return values.length
    ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
    : null;
}
