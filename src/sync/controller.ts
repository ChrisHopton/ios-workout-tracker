import {
  makeBatch,
  MAX_BATCH_ROWS,
  parseConnectionCode,
  validateCredentials,
  type RowChange,
  type SyncCredentials,
} from "./protocol";
import { SyncError, validateResponse, type SyncTransport } from "./transport";

export interface SyncLocalState {
  deviceId: string;
  label: string;
  clock: number;
  lastSyncedAt: string | null;
  enabled: boolean;
}

export interface SyncRepository {
  state(): Promise<SyncLocalState | null>;
  connect(deviceId: string, label: string, serverMaxRevision: number): Promise<void>;
  disconnect(): Promise<void>;
  setLabel(label: string): Promise<void>;
  pendingCount(): Promise<number>;
  pending(): Promise<RowChange[]>;
  acknowledge(acks: { key: string; revision: number }[], at: string): Promise<void>;
}

export interface SyncSecrets {
  load(): Promise<SyncCredentials | null>;
  save(credentials: SyncCredentials): Promise<void>;
  remove(): Promise<void>;
}

export interface SyncViewState {
  status: "disconnected" | "pending" | "syncing" | "synced" | "error";
  deviceLabel: string;
  pending: number;
  lastSyncedAt: string | null;
  error: string | null;
  busy: boolean;
}

export interface SyncControllerOptions {
  now?: () => number;
  setTimeout?: (callback: () => void, delay: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

export const DISCONNECTED_SYNC_STATE: SyncViewState = {
  status: "disconnected",
  deviceLabel: "",
  pending: 0,
  lastSyncedAt: null,
  error: null,
  busy: false,
};

function safeError(error: unknown): SyncError {
  return error instanceof SyncError
    ? error
    : new SyncError("Sheets sync could not finish. Try again.", true);
}

function checkedLabel(value: string): string {
  const label = value.trim();
  if (!label || label.length > 80) {
    throw new SyncError("Enter a phone label between 1 and 80 characters.", false);
  }
  return label;
}

export class SyncController {
  private snapshot: SyncViewState = { ...DISCONNECTED_SYNC_STATE };
  private listeners = new Set<() => void>();
  private credentials: SyncCredentials | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private initialization: Promise<void> | null = null;
  private syncPromise: Promise<void> | null = null;
  private connecting = false;
  private controls = 0;
  private active = true;
  private disposed = false;
  private blocked = false;
  private blockedError: string | null = null;
  private generation = 0;
  private configuration = 0;
  private refreshVersion = 0;
  private timer: unknown;
  private timerAt: number | null = null;
  private firstChangeAt: number | null = null;
  private retryAt: number | null = null;
  private retryDelay = 15_000;
  private runAgain = false;
  private readonly now: () => number;
  private readonly schedule: (callback: () => void, delay: number) => unknown;
  private readonly cancel: (handle: unknown) => void;

  constructor(
    private readonly repository: SyncRepository,
    private readonly secrets: SyncSecrets,
    private readonly transport: SyncTransport,
    options: SyncControllerOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.schedule =
      options.setTimeout ?? ((callback, delay) => setTimeout(callback, delay));
    this.cancel =
      options.clearTimeout ??
      ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  }

  getSnapshot = (): SyncViewState => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  initialize(): Promise<void> {
    if (this.initialization) return this.initialization;
    this.initialization = this.enqueue(async () => {
      const configuration = this.configuration;
      try {
        const [saved, state] = await Promise.all([
          this.secrets.load(),
          this.repository.state(),
        ]);
        if (!this.currentConfiguration(configuration)) return;
        const credentials = saved ? validateCredentials(saved) : null;
        if (credentials && state?.enabled && state.deviceId === credentials.deviceId) {
          this.credentials = credentials;
          await this.refresh(this.generation, null);
          this.scheduleAt(this.now());
        } else {
          this.credentials = null;
          this.publish({
            status: "disconnected",
            deviceLabel: state?.label ?? "",
            lastSyncedAt: state?.lastSyncedAt ?? null,
            pending: 0,
            error: credentials
              ? "Reconnect Sheets to this phone before syncing."
              : null,
          });
        }
      } catch {
        if (this.currentConfiguration(configuration)) {
          this.credentials = null;
          this.publish({
            status: "disconnected",
            error: "The saved Sheets connection could not be loaded. Reconnect and try again.",
          });
        }
      }
    });
    return this.initialization;
  }

  connect(code: string, label: string): Promise<void> {
    if (this.connecting) {
      return Promise.reject(new SyncError("A Sheets connection is already being checked.", false));
    }
    if (this.disposed) return Promise.reject(new SyncError("Sync has stopped.", false));
    this.connecting = true;
    ++this.generation;
    const configuration = ++this.configuration;
    this.clearSchedule();
    return this.control(async () => {
      try {
        if (!this.active) throw new SyncError("Open the app to connect Sheets.", true);
        let credentials: SyncCredentials;
        try {
          credentials = parseConnectionCode(code);
        } catch {
          throw new SyncError("The Sheets connection code is invalid.", false);
        }
        const deviceLabel = checkedLabel(label);
        const request = {
          version: 1 as const,
          action: "hello" as const,
          deviceId: credentials.deviceId,
          token: credentials.token,
        };
        const response = validateResponse(
          request,
          await this.transport(request, credentials),
        );
        if (!this.currentConfiguration(configuration)) throw new SyncError("The connection changed. Try again.", true);
        if (!response.ok) throw new SyncError(response.error, response.retryable);
        if (response.maxRevision === Number.MAX_SAFE_INTEGER) {
          throw new SyncError("Sheets returned an invalid revision. Reconnect and try again.", false);
        }
        const previous = this.credentials;
        await this.secrets.save(credentials);
        try {
          if (!this.currentConfiguration(configuration)) throw new Error();
          await this.repository.connect(
            credentials.deviceId,
            deviceLabel,
            response.maxRevision,
          );
        } catch {
          if (previous) await this.secrets.save(previous);
          else await this.secrets.remove();
          throw new SyncError("The Sheets connection could not be saved. Try again.", true);
        }
        if (!this.currentConfiguration(configuration)) return;
        this.credentials = credentials;
        this.blocked = false;
        this.blockedError = null;
        this.retryAt = null;
        this.retryDelay = 15_000;
        await this.refresh(this.generation, null);
        this.scheduleAt(this.now());
      } catch (error) {
        if (this.currentConfiguration(configuration)) this.fail(safeError(error), false);
        throw safeError(error);
      } finally {
        this.connecting = false;
      }
    });
  }

  disconnect(): Promise<void> {
    ++this.generation;
    ++this.configuration;
    this.clearSchedule();
    this.firstChangeAt = null;
    this.retryAt = null;
    return this.control(async () => {
      this.credentials = null;
      this.clearSchedule();
      this.blocked = false;
      this.blockedError = null;
      this.runAgain = false;
      let failed = false;
      try {
        await this.repository.disconnect();
      } catch {
        failed = true;
      }
      try {
        await this.secrets.remove();
      } catch {
        failed = true;
      }
      await this.refresh(this.generation, null);
      if (failed) {
        const error = new SyncError("The Sheets connection could not be fully removed. Try again.", true);
        this.publish({ status: "disconnected", error: error.message });
        throw error;
      }
    });
  }

  setLabel(value: string): Promise<void> {
    let label: string;
    try {
      label = checkedLabel(value);
    } catch (error) {
      return Promise.reject(error);
    }
    const generation = ++this.generation;
    this.clearSchedule();
    return this.control(async () => {
      try {
        if (!this.credentials) throw new SyncError("Connect Sheets before changing the phone label.", false);
        await this.repository.setLabel(label);
        await this.refresh(generation);
        this.scheduleAt(this.now());
      } catch (error) {
        if (this.current(generation)) this.fail(safeError(error), false);
        throw safeError(error);
      }
    });
  }

  changed(immediate = false): void {
    if (this.disposed) return;
    const generation = this.generation;
    void this.refresh(generation).catch((error) => {
      if (this.current(generation)) this.fail(safeError(error), true);
    });
    if (!this.credentials) return;
    const now = this.now();
    this.firstChangeAt ??= now;
    this.scheduleAt(
      immediate ? now : Math.min(now + 10_000, this.firstChangeAt + 60_000),
    );
  }

  setActive(active: boolean): void {
    if (this.disposed || this.active === active) return;
    this.active = active;
    if (!active) {
      ++this.generation;
      this.clearSchedule();
      this.firstChangeAt = null;
      if (this.credentials && this.snapshot.status === "syncing") {
        this.publish({ status: this.snapshot.pending > 0 ? "pending" : "synced" });
      }
    } else {
      this.retryAt = null;
      this.scheduleAt(this.now());
    }
  }

  syncNow(): Promise<void> {
    if (this.disposed) return Promise.reject(new SyncError("Sync has stopped.", false));
    if (this.syncPromise) return this.syncPromise;
    this.clearSchedule();
    const generation = this.generation;
    const promise = this.enqueue(() => this.upload(generation));
    this.syncPromise = promise;
    this.publish({ busy: true });
    const finish = () => {
      if (this.syncPromise !== promise) return;
      this.syncPromise = null;
      this.publish({ busy: this.controls > 0 });
      if (
        this.credentials &&
        this.controls === 0 &&
        this.snapshot.pending > 0 &&
        this.snapshot.status !== "error" &&
        (this.timerAt === null || this.runAgain)
      ) {
        this.scheduleAt(this.now() + (this.runAgain ? 0 : 10_000));
      }
      this.runAgain = false;
    };
    void promise.then(finish, finish);
    return promise;
  }

  dispose(): void {
    this.disposed = true;
    ++this.generation;
    this.clearSchedule();
    this.listeners.clear();
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const promise = this.queue.then(operation);
    this.queue = promise.catch(() => undefined);
    return promise;
  }

  private control(operation: () => Promise<void>): Promise<void> {
    this.controls++;
    this.publish({ busy: true });
    return this.enqueue(async () => {
      try {
        await operation();
      } finally {
        this.controls--;
        this.publish({ busy: this.controls > 0 || this.syncPromise !== null });
        if (this.controls === 0 && this.runAgain && this.snapshot.status !== "error") {
          this.scheduleAt(this.now());
          this.runAgain = false;
        }
      }
    });
  }

  private current(generation: number): boolean {
    return !this.disposed && generation === this.generation;
  }

  private currentConfiguration(configuration: number): boolean {
    return !this.disposed && configuration === this.configuration;
  }

  private publish(patch: Partial<SyncViewState>): void {
    if (this.disposed) return;
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  private async refresh(
    generation: number,
    error: string | null | undefined = undefined,
  ): Promise<void> {
    const refreshVersion = ++this.refreshVersion;
    const [state, pending] = await Promise.all([
      this.repository.state(),
      this.repository.pendingCount(),
    ]);
    if (!this.current(generation) || refreshVersion !== this.refreshVersion) return;
    const connected = this.credentials !== null;
    const message = error === undefined ? this.snapshot.error : error;
    this.publish({
      deviceLabel: state?.label ?? "",
      pending: connected ? pending : 0,
      lastSyncedAt: state?.lastSyncedAt ?? null,
      error: message,
      status: !connected
        ? "disconnected"
        : message
          ? "error"
          : this.snapshot.status === "syncing" && this.syncPromise
            ? "syncing"
            : pending > 0
              ? "pending"
              : "synced",
    });
  }

  private clearSchedule(): void {
    if (this.timerAt !== null) this.cancel(this.timer);
    this.timer = undefined;
    this.timerAt = null;
  }

  private scheduleAt(time: number): void {
    if (this.disposed || !this.active || !this.credentials || this.blocked) return;
    const due = Math.max(time, this.retryAt ?? time);
    this.clearSchedule();
    this.timerAt = due;
    this.timer = this.schedule(() => {
      this.timerAt = null;
      this.timer = undefined;
      if (!this.active || this.disposed || this.blocked || !this.credentials) return;
      if (this.syncPromise || this.controls > 0) {
        this.runAgain = true;
        return;
      }
      void this.syncNow().catch(() => undefined);
    }, Math.max(0, due - this.now()));
  }

  private fail(error: SyncError, retry: boolean): void {
    if (this.blocked && error.retryable && this.blockedError) {
      this.publish({
        status: this.credentials ? "error" : "disconnected",
        error: this.blockedError,
      });
      this.clearSchedule();
      return;
    }
    this.publish({ status: this.credentials ? "error" : "disconnected", error: error.message });
    this.blocked = !error.retryable;
    this.blockedError = this.blocked ? error.message : null;
    if (retry && error.retryable && this.credentials) {
      this.retryAt = this.now() + this.retryDelay;
      this.retryDelay = Math.min(this.retryDelay * 2, 300_000);
      this.scheduleAt(this.retryAt);
    } else {
      this.clearSchedule();
    }
  }

  private async upload(generation: number): Promise<void> {
    if (!this.current(generation)) return;
    try {
      if (!this.credentials) throw new SyncError("Connect Sheets before syncing.", false);
      if (!this.active) throw new SyncError("Sync will resume when the app is open.", true);
      const credentials = this.credentials;
      const state = await this.repository.state();
      if (!this.current(generation) || !this.active) return;
      if (!state?.enabled || state.deviceId !== credentials.deviceId) {
        this.credentials = null;
        throw new SyncError("Reconnect Sheets to this phone before syncing.", false);
      }
      this.retryAt = null;
      this.firstChangeAt = null;
      this.publish({ status: "syncing", error: null });
      for (let batch = 0; batch < 100; batch++) {
        if (!this.current(generation) || !this.active) return;
        const captured = await this.repository.pending();
        if (!this.current(generation) || !this.active) return;
        if (captured.length === 0) break;
        let request;
        try {
          request = makeBatch(
            credentials,
            captured.slice(0, MAX_BATCH_ROWS),
          );
        } catch {
          throw new SyncError("The pending sync data is invalid. Reconnect and try again.", false);
        }
        const count = request.changes!.length;
        if (count === 0) throw new SyncError("The pending sync data could not be batched.", false);
        const response = validateResponse(
          request,
          await this.transport(request, credentials),
        );
        if (!this.current(generation) || !this.active) return;
        if (!response.ok) throw new SyncError(response.error, response.retryable);
        await this.repository.acknowledge(
          response.acknowledged,
          new Date(this.now()).toISOString(),
        );
        if (batch === 99) this.runAgain = true;
      }
      if (!this.current(generation)) return;
      this.blocked = false;
      this.blockedError = null;
      this.retryDelay = 15_000;
      await this.refresh(generation, null);
      this.publish({ status: this.snapshot.pending > 0 ? "pending" : "synced" });
    } catch (error) {
      if (!this.current(generation)) return;
      const safe = safeError(error);
      this.fail(safe, true);
      throw safe;
    }
  }
}