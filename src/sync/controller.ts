import type { BootstrapDraft } from "./bootstrap";
import {
  parseConnectionCode,
  sameIdentity,
  identityOf,
  validateCredentials,
  type SyncCredentials,
  type SyncIdentity,
  type UploadBatch,
} from "./protocol";
import { makeCommitBody, SyncError, validateResponse, type SyncErrorKind, type SyncRequest, type SyncTransport } from "./transport";

export interface SyncLocalState extends SyncIdentity {
  installationId: string;
  label: string;
  clock: number;
  lastSyncedAt: string | null;
  enabled: boolean;
  bound: boolean;
  initialComplete: boolean;
}
export interface SyncRepository {
  prepareBootstrap?(candidate: BootstrapDraft): Promise<BootstrapDraft>;
  state(): Promise<SyncLocalState | null>;
  pendingEnrollment(): Promise<SyncLocalState | null>;
  prepareEnrollment(identity: SyncIdentity, label: string, installationId: string): Promise<SyncLocalState>;
  activateEnrollment(staged: SyncLocalState): Promise<void>;
  disconnect(): Promise<void>;
  setLabel(label: string): Promise<void>;
  pendingCount(): Promise<number>;
  inFlight(): Promise<UploadBatch | null>;
  reserveAttempt(writes: number, at: number): Promise<{ allowed: boolean; retryAt: number | null }>;
  acknowledge(batchId: string, acks: { key: string; revision: number }[], at: string): Promise<void>;
}
export interface SyncSecrets {
  load(): Promise<SyncCredentials | null>;
  save(credentials: SyncCredentials): Promise<void>;
  remove(): Promise<void>;
}
export interface SyncViewState {
  status: "disconnected" | "pending" | "syncing" | "synced" | "paused" | "error";
  deviceLabel: string;
  pending: number;
  lastSyncedAt: string | null;
  error: string | null;
  busy: boolean;
  bound: boolean;
  initialComplete: boolean;
  pausedUntil: string | null;
  phase: "setup" | "enrollment" | "upload" | "idle";
  errorKind: SyncErrorKind | null;
  retryable: boolean;
  nextRetryAt: string | null;
}
export interface SyncControllerOptions {
  now?: () => number;
  setTimeout?: (callback: () => void, delay: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
  createInstallationId?: () => string;
}
export const DISCONNECTED_SYNC_STATE: SyncViewState = {
  status: "disconnected", deviceLabel: "", pending: 0, lastSyncedAt: null,
  error: null, busy: false, bound: false, initialComplete: false, pausedUntil: null,
  phase: "setup", errorKind: null, retryable: false, nextRetryAt: null,
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function safeError(error: unknown): SyncError {
  return error instanceof SyncError
    ? error
    : new SyncError("Cloud upload could not finish. Your changes remain saved on this phone.", true, "storage");
}
function checkedLabel(value: string): string {
  const label = value.trim();
  if (!label || label.length > 80) throw new SyncError("Enter a phone label between 1 and 80 characters.", false, "invalid");
  return label;
}
const matches = sameIdentity;

export class SyncController {
  private snapshot: SyncViewState = { ...DISCONNECTED_SYNC_STATE };
  private listeners = new Set<() => void>();
  private credentials: SyncCredentials | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private initialization: Promise<boolean> | null = null;
  private syncPromise: Promise<void> | null = null;
  private connecting = false;
  private controls = 0;
  private active = true;
  private disposed = false;
  private blockedError: string | null = null;
  private generation = 0;
  private configuration = 0;
  private refreshVersion = 0;
  private timer: unknown;
  private timerAt: number | null = null;
  private firstChangeAt: number | null = null;
  private retryAt: number | null = null;
  private quotaUntil: number | null = null;
  private retryDelay = 15_000;
  private runAgain = false;
  private readonly now: () => number;
  private readonly schedule: (callback: () => void, delay: number) => unknown;
  private readonly cancel: (handle: unknown) => void;
  private readonly installationId: () => string;

  constructor(
    private readonly repository: SyncRepository,
    private readonly secrets: SyncSecrets,
    private readonly transport: SyncTransport,
    options: SyncControllerOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.schedule = options.setTimeout ?? ((callback, delay) => setTimeout(callback, delay));
    this.cancel = options.clearTimeout ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
    this.installationId = options.createInstallationId ?? (() => {
      if (typeof globalThis.crypto?.randomUUID !== "function") {
        throw new SyncError("This app could not create a secure installation identity. Try again.", false, "invalid");
      }
      return globalThis.crypto.randomUUID();
    });
  }

  getSnapshot = (): SyncViewState => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  reportSetupStarted(): void {
    this.publish({ status: "pending", phase: "setup", busy: true, error: null,
      errorKind: null, retryable: false, nextRetryAt: null });
  }

  reportStartupError(error: unknown, retryAt: number | null = null): void {
    const safe = safeError(error);
    this.publish({ status: "error", phase: "setup", error: safe.message, busy: false,
      errorKind: safe.kind, retryable: safe.retryable,
      nextRetryAt: retryAt === null ? null : new Date(retryAt).toISOString() });
  }

  /** User retries use the same scheduler and cannot bypass backoff, quota, or revocation. */
  retry(): void {
    if (this.snapshot.retryable && !this.blockedError && !this.syncPromise)
      this.scheduleAt(this.now());
  }

  initialize(): Promise<boolean> {
    if (this.initialization) return this.initialization;
    this.initialization = this.enqueue(async () => {
      const configuration = this.configuration;
      try {
        const [saved, state, staged] = await Promise.all([
          this.secrets.load(), this.repository.state(), this.repository.pendingEnrollment(),
        ]);
        if (!this.currentConfiguration(configuration)) return false;
        const credentials = saved ? validateCredentials(saved) : null;
        if (
          credentials &&
          ((matches(state, credentials) && state!.enabled && state!.bound) || matches(staged, credentials))
        ) {
          this.credentials = credentials;
          await this.refresh(this.generation, null);
          this.scheduleAt(this.now());
          return true;
        } else {
          this.credentials = null;
          this.publish({
            ...DISCONNECTED_SYNC_STATE,
            deviceLabel: state?.label ?? staged?.label ?? "",
            lastSyncedAt: state?.lastSyncedAt ?? null,
            error: credentials ? "The saved upload identity needs attention. Your workouts remain on this phone." : null,
          });
        }
      } catch {
        if (this.currentConfiguration(configuration)) {
          this.credentials = null;
          this.publish({
            ...DISCONNECTED_SYNC_STATE,
            error: "The saved upload connection could not be loaded. Your workouts remain on this phone.",
          });
        }
      }
      // Retry a transient startup read failure without replacing the saved identity.
      this.initialization = null;
      return false;
    });
    return this.initialization;
  }

  connect(code: string, value: string): Promise<void> {
    if (this.connecting) return Promise.reject(new SyncError("A cloud connection is already being checked.", false, "invalid"));
    if (this.disposed) return Promise.reject(new SyncError("Sync has stopped.", false, "invalid"));
    let credentials: SyncCredentials;
    let label: string;
    try {
      try { credentials = parseConnectionCode(code); } catch {
        throw new SyncError("The cloud connection code is invalid.", false, "invalid");
      }
      label = checkedLabel(value);
    } catch (error) { return Promise.reject(error); }
    this.connecting = true;
    ++this.generation;
    const configuration = ++this.configuration;
    const resumeAt = this.timerAt;
    this.clearSchedule();
    return this.control(async () => {
      const previous = {
        credentials: this.credentials, error: this.snapshot.error,
        errorKind: this.snapshot.errorKind, retryable: this.snapshot.retryable,
        nextRetryAt: this.snapshot.nextRetryAt, blockedError: this.blockedError,
        retryAt: this.retryAt, quotaUntil: this.quotaUntil, retryDelay: this.retryDelay,
      };
      let restoreSecrets = false;
      let activated = false;
      try {
        if (!this.active) throw new SyncError("Open the app to connect cloud uploads.", true);
        const installationId = this.installationId();
        if (!UUID.test(installationId)) throw new SyncError("A secure installation identity could not be created.", false, "invalid");
        const staged = await this.repository.prepareEnrollment(identityOf(credentials), label, installationId);
        if (!this.currentConfiguration(configuration)) return;
        this.checkStaged(staged, credentials);
        restoreSecrets = true;
        await this.secrets.save(credentials);
        if (!this.currentConfiguration(configuration)) return;
        this.credentials = credentials;
        await this.reserve(1);
        const request: SyncRequest = { action: "bind", installationId: staged.installationId };
        validateResponse(request, await this.transport(
          request, credentials, () => this.active && this.currentConfiguration(configuration),
        ));
        if (!this.currentConfiguration(configuration)) return;
        await this.repository.activateEnrollment(staged);
        activated = true;
        if (!this.currentConfiguration(configuration)) return;
        this.blockedError = null;
        this.retryAt = null;
        this.quotaUntil = null;
        this.retryDelay = 15_000;
        await this.refresh(this.generation, null);
        this.scheduleAt(this.now());
      } catch (error) {
        if (this.currentConfiguration(configuration)) {
          if (activated) {
            this.fail(safeError(error), true);
          } else {
            let restored = true;
            if (restoreSecrets) {
              try {
                if (previous.credentials) await this.secrets.save(previous.credentials);
                else await this.secrets.remove();
              } catch {
                restored = false;
                error = new SyncError("The previous cloud connection could not be restored securely. Replace the connection code.", false, "storage");
                try { await this.repository.disconnect(); } catch {
                  error = new SyncError("The previous cloud connection could not be restored securely or disabled. Replace the connection code before reopening the app.", false, "storage");
                }
                try { await this.secrets.remove(); } catch {}
              }
            }
            if (!this.currentConfiguration(configuration)) return;
            this.credentials = restored ? previous.credentials : null;
            this.blockedError = previous.blockedError;
            this.retryAt = previous.retryAt;
            this.quotaUntil = previous.quotaUntil;
            this.retryDelay = previous.retryDelay;
            this.publish({ errorKind: previous.errorKind, retryable: previous.retryable, nextRetryAt: previous.nextRetryAt });
            await this.refresh(this.generation, previous.error).catch(() => undefined);
            if (this.credentials) {
              this.scheduleAt(resumeAt ?? this.now());
            } else {
              this.fail(safeError(error), false);
            }
          }
        }
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
      this.blockedError = null;
      this.quotaUntil = null;
      this.runAgain = false;
      let failed = false;
      try { await this.repository.disconnect(); } catch { failed = true; }
      try { await this.secrets.remove(); } catch { failed = true; }
      await this.refresh(this.generation, null);
      if (failed) {
        const error = new SyncError("The cloud connection could not be fully removed. Try again.", true, "storage");
        this.publish({ status: "disconnected", error: error.message });
        throw error;
      }
    });
  }

  setLabel(value: string): Promise<void> {
    let label: string;
    try { label = checkedLabel(value); } catch (error) { return Promise.reject(error); }
    const generation = ++this.generation;
    this.clearSchedule();
    return this.control(async () => {
      try {
        if (!this.credentials || !this.snapshot.bound) throw new SyncError("Connect cloud uploads before changing the phone label.", false, "invalid");
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
    this.scheduleAt(immediate ? now : Math.min(now + 10_000, this.firstChangeAt + 60_000));
  }

  setActive(active: boolean): void {
    if (this.disposed || this.active === active) return;
    this.active = active;
    if (!active) {
      ++this.generation;
      this.clearSchedule();
      this.firstChangeAt = null;
      if (this.credentials && this.snapshot.status === "syncing") this.publish({ status: "pending" });
    } else {
      this.retryAt = this.quotaUntil;
      this.scheduleAt(this.now());
    }
  }

  syncNow(): Promise<void> {
    if (this.disposed) return Promise.reject(new SyncError("Sync has stopped.", false, "invalid"));
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
        this.credentials && this.controls === 0 && this.snapshot.status !== "error" &&
        this.snapshot.status !== "paused" &&
        (this.snapshot.pending > 0 || !this.snapshot.initialComplete) &&
        (this.timerAt === null || this.runAgain)
      ) this.scheduleAt(this.now() + (this.runAgain ? 0 : 10_000));
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
      try { await operation(); } finally {
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
  private checkStaged(staged: SyncLocalState, credentials: SyncCredentials): void {
    if (!matches(staged, credentials) || !UUID.test(staged.installationId) ||
      !Number.isSafeInteger(staged.clock) || staged.clock < 0) {
      throw new SyncError("The saved installation identity is invalid. Ask the owner for a replacement code.", false, "invalid");
    }
  }
  private publish(patch: Partial<SyncViewState>): void {
    if (this.disposed) return;
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }
  private async refresh(generation: number, error: string | null | undefined = undefined): Promise<void> {
    const version = ++this.refreshVersion;
    const [state, staged, pending] = await Promise.all([
      this.repository.state(), this.repository.pendingEnrollment(), this.repository.pendingCount(),
    ]);
    if (!this.current(generation) || version !== this.refreshVersion) return;
    const shown = this.credentials && matches(state, this.credentials)
      ? state : this.credentials && matches(staged, this.credentials) ? staged : state;
    const connected = this.credentials !== null;
    const bound = connected && matches(state, this.credentials!) && state!.bound && state!.enabled;
    const message = error === undefined ? this.snapshot.error : error;
    const paused = this.quotaUntil !== null && this.quotaUntil > this.now();
    this.publish({
      deviceLabel: shown?.label ?? "",
      pending: connected ? pending : 0,
      lastSyncedAt: shown?.lastSyncedAt ?? null,
      bound,
      initialComplete: bound && state!.initialComplete,
      error: message,
      ...(message === null ? { errorKind: null, retryable: false } : {}),
      phase: !connected ? "setup" : !bound ? "enrollment" : this.snapshot.status === "syncing" && this.syncPromise ? "upload" : "idle",
      nextRetryAt: !connected && this.snapshot.phase === "setup" && message ? this.snapshot.nextRetryAt :
        this.retryAt !== null && this.retryAt > this.now() ? new Date(this.retryAt).toISOString() : null,
      pausedUntil: paused ? new Date(this.quotaUntil!).toISOString() : null,
      status: !connected ? "disconnected" : paused ? "paused" : message ? "error" :
        this.snapshot.status === "syncing" && this.syncPromise ? "syncing" :
        pending > 0 || !bound || !state!.initialComplete ? "pending" : "synced",
    });
  }
  private clearSchedule(): void {
    if (this.timerAt !== null) this.cancel(this.timer);
    this.timer = undefined;
    this.timerAt = null;
  }
  private scheduleAt(time: number): void {
    if (this.disposed || !this.active || !this.credentials || this.blockedError) return;
    const due = Math.max(time, this.retryAt ?? time, this.quotaUntil ?? time);
    this.clearSchedule();
    this.timerAt = due;
    if (this.snapshot.error && this.snapshot.retryable) this.publish({ nextRetryAt: new Date(due).toISOString() });
    this.timer = this.schedule(() => {
      this.timerAt = null;
      this.timer = undefined;
      if (!this.active || this.disposed || this.blockedError || !this.credentials) return;
      if (this.syncPromise || this.controls > 0) { this.runAgain = true; return; }
      void this.syncNow().catch(() => undefined);
    }, Math.max(0, due - this.now()));
  }
  private fail(error: SyncError, retry: boolean): void {
    if (this.blockedError && error.retryable) {
      this.publish({ status: this.credentials ? "error" : "disconnected", error: this.blockedError });
      this.clearSchedule();
      return;
    }
    if (!error.retryable) this.blockedError = error.message;
    this.publish({ errorKind: error.kind, retryable: error.retryable, nextRetryAt: null });
    if (error.kind === "quota") {
      this.quotaUntil = Math.max(error.retryAt ?? this.now() + 300_000, this.now() + 1);
      this.retryAt = this.quotaUntil;
      this.publish({
        status: this.credentials ? "paused" : "disconnected",
        error: error.message,
        pausedUntil: new Date(this.quotaUntil).toISOString(),
      });
      this.scheduleAt(this.quotaUntil);
    } else {
      this.publish({ status: this.credentials ? "error" : "disconnected", error: error.message });
      if (retry && error.retryable && this.credentials) {
        this.retryAt = this.now() + this.retryDelay;
        this.retryDelay = Math.min(this.retryDelay * 2, 300_000);
        this.scheduleAt(this.retryAt);
      } else this.clearSchedule();
    }
  }
  private async reserve(writes: number): Promise<void> {
    if (this.quotaUntil !== null && this.quotaUntil > this.now()) {
      throw new SyncError("Cloud uploads are paused until the upload quota resets. Your changes remain saved on this phone.", true, "quota", this.quotaUntil);
    }
    const reservation = await this.repository.reserveAttempt(writes, this.now());
    if (!reservation.allowed) {
      if (reservation.retryAt === null || !Number.isFinite(reservation.retryAt) || reservation.retryAt <= this.now()) {
        throw new SyncError("The upload budget could not be verified. Try again.", true, "storage");
      }
      throw new SyncError("Cloud uploads are paused until the upload quota resets. Your changes remain saved on this phone.", true, "quota", reservation.retryAt);
    }
    this.quotaUntil = null;
  }
  private async upload(generation: number): Promise<void> {
    if (!this.current(generation)) return;
    try {
      if (!this.credentials) throw new SyncError("Connect cloud uploads before syncing.", false, "invalid");
      if (!this.active) throw new SyncError("Uploads will resume when the app is open.", true);
      const credentials = this.credentials;
      let [state, staged] = await Promise.all([this.repository.state(), this.repository.pendingEnrollment()]);
      if (!this.current(generation) || !this.active) return;
      if (matches(staged, credentials) && !(matches(state, credentials) && state!.enabled && state!.bound)) {
        this.checkStaged(staged!, credentials);
        await this.reserve(1);
        if (!this.current(generation) || !this.active) return;
        this.publish({ phase: "enrollment", status: "syncing", error: null, errorKind: null, retryable: false, nextRetryAt: null });
        const request: SyncRequest = { action: "bind", installationId: staged!.installationId };
        validateResponse(request, await this.transport(request, credentials, () => this.active && this.current(generation)));

        if (!this.current(generation) || !this.active) return;
        await this.repository.activateEnrollment(staged!);
        state = await this.repository.state();
        staged = null;
      }
      if (!state?.enabled || !state.bound || !matches(state, credentials)) {
        this.credentials = null;
        throw new SyncError("The saved upload identity needs attention. Your workouts remain on this phone.", false, "auth");
      }
      this.checkStaged(state, credentials);
      this.retryAt = null;
      this.firstChangeAt = null;
      this.publish({ status: "syncing", phase: "upload", error: null, errorKind: null, retryable: false, nextRetryAt: null, pausedUntil: null });
      for (let index = 0; index < 100; index++) {
        if (!this.current(generation) || !this.active) return;
        const batch = await this.repository.inFlight();
        if (!this.current(generation) || !this.active) return;
        if (batch === null) break;
        if (typeof batch.id !== "string" || !batch.id) {
          throw new SyncError("The saved upload batch is invalid. Try again.", false, "invalid");
        }
        const request: SyncRequest = {
          action: "upload", installationId: state.installationId,
          changes: JSON.parse(JSON.stringify(batch.changes)),
        };
        makeCommitBody(request, credentials);
        await this.reserve(request.changes.length);
        if (!this.current(generation) || !this.active) return;
        const receipt = validateResponse(request, await this.transport(
          request, credentials, () => this.active && this.current(generation),
        ));
        if (!this.current(generation) || !this.active) return;
        await this.repository.acknowledge(batch.id, receipt.acknowledged, new Date(this.now()).toISOString());
        await this.refresh(generation, null);
        if (index === 99) this.runAgain = true;
      }
      if (!this.current(generation)) return;
      this.blockedError = null;
      this.retryDelay = 15_000;
      this.quotaUntil = null;
      await this.refresh(generation, null);
      this.publish({
        status: this.snapshot.pending > 0 || !this.snapshot.initialComplete ? "pending" : "synced",
        phase: "idle", nextRetryAt: null,
      });
    } catch (error) {
      if (!this.current(generation)) return;
      const safe = safeError(error);
      this.fail(safe, true);
      throw safe;
    }
  }
}
