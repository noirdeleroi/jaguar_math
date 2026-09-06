export function shuffleWithSeed<T>(items: T[], seed: string) {
  let state = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    state ^= seed.charCodeAt(index);
    state = Math.imul(state, 16777619);
  }

  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    state += 0x6d2b79f5;
    let random = state;
    random = Math.imul(random ^ (random >>> 15), random | 1);
    random ^= random + Math.imul(random ^ (random >>> 7), random | 61);
    const target = Math.floor(((random ^ (random >>> 14)) >>> 0) / 4294967296 * (index + 1));
    [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
  }
  return shuffled;
}
