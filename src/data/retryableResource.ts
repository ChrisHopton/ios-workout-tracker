// Share pending opens but allow another attempt after failure
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
