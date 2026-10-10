/** Shares an in-flight open, caching success while allowing a fresh attempt after failure. */
export function createRetryableResource<T>(
  open: () => Promise<T>,
): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return () => {
    pending ??= Promise.resolve()
      .then(open)
      .catch((error) => {
        pending = undefined;
        throw error;
      });
    return pending;
  };
}
