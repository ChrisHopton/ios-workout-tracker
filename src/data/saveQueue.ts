/** Serializes durable writes. Treat each enqueued snapshot as immutable. */
export class SaveQueue<T> {
  private tail: Promise<void> = Promise.resolve();
  private latest: { snapshot: T } | undefined;
  private failure: unknown;
  private failed = false;
  private replacing = false;
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
    // A failed write must not poison the chain or block a later, newer snapshot.
    this.tail = operation.catch(() => undefined);
    return operation;
  }
  enqueue(snapshot: T): Promise<void> {
    if (this.replacing)
      return Promise.reject(
        new Error("Please wait for the backup to finish restoring."),
      );
    this.latest = { snapshot };
    return this.append(() => this.writer(snapshot));
  }
  /** The writer must replace its durable value atomically, as SQLite's single UPDATE does. */
  replace(snapshot: T, currentSnapshot: T): Promise<void> {
    if (this.replacing)
      return Promise.reject(new Error("A restore is already running."));
    this.replacing = true;
    // A restore before the first edit still needs a known current value for failure recovery.
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
