// Bound every upstream request, including Auth. Preserve callers' cancellation.
export const boundedFetch: typeof fetch = (input, init) => {
  const timeout = AbortSignal.timeout(10_000);
  const caller = init?.signal ?? (input instanceof Request ? input.signal : undefined);
  return fetch(input, { ...init, signal: caller ? AbortSignal.any([caller, timeout]) : timeout });
};
