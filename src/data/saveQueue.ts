// Queued snapshots must be immutable
export class SaveQueue<T> {
  private tail: Promise<void> = Promise.resolve();
  private latest: { snapshot: T } | undefined;
  private failure: unknown;
  private failed = false;
  private replacing = false;
  private pending: { snapshot: T; promise: Promise<void> } | undefined;
  constructor(private readonly writer: (snapshot: T) => Promise<void>) {}
  private append(write: () => Promise<void>): Promise<void> {
    const operation = this.tail.then(async () => {
      try {
        await write();
        this.failed = false;
        this.failure = undefined;
      } catch (error) {
        this.failed = true;
        this.failure = error;
        throw error;
      }
    });
    // Allow newer snapshots to save after a failed write
    this.tail = operation.catch(() => undefined);
    return operation;
  }
  enqueue(snapshot: T): Promise<void> {
    if (this.replacing)
      return Promise.reject(
        new Error("Please wait for the backup to finish restoring."),
      );
    this.latest = { snapshot };
    if (this.pending) {
      this.pending.snapshot = snapshot;
      return this.pending.promise;
    }
    const pending = { snapshot, promise: Promise.resolve() };
    pending.promise = this.append(async () => {
      this.pending = undefined;
      await this.writer(pending.snapshot);
    });
    this.pending = pending;
    return pending.promise;
  }
  replace(snapshot: T, currentSnapshot: T): Promise<void> {
    if (this.replacing)
      return Promise.reject(new Error("A restore is already running."));
    this.replacing = true;
    // Keep a recovery snapshot when restoring before the first edit
    this.latest ??= { snapshot: currentSnapshot };
    return this.append(async () => {
      await this.writer(snapshot);
      this.latest = { snapshot };
    }).finally(() => {
      this.replacing = false;
    });
  }
  async flush(): Promise<void> {
    let observed: Promise<void>;
    do {
      observed = this.tail;
      await observed;
    } while (observed !== this.tail);
    if (this.failed) throw this.failure;
  }
  retry(): Promise<void> {
    if (this.replacing)
      return Promise.reject(
        new Error("Please wait for the backup to finish restoring."),
      );
    if (!this.latest) return Promise.resolve();
    return this.enqueue(this.latest.snapshot);
  }
}
