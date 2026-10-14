// Ignore a late response after a network deadline. Callers of mutations must
// remain idempotent: timing out locally does not cancel server execution.
export async function withTimeout<T>(operation: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("The request timed out. Retry to continue the same attempt.")), milliseconds);
      }),
    ]);
  } finally { clearTimeout(timer); }
}
