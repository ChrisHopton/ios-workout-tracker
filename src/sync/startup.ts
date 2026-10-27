import { SyncError } from "./transport";

interface StartupOptions {
  bootstrap: (canSend: () => boolean) => Promise<boolean>;
  initialize: () => Promise<boolean>;
  started: () => void;
  failed: (error: unknown, retryAt: number | null) => void;
  retryUpload: () => void;
  now?: () => number;
  schedule?: (callback: () => void, delay: number) => unknown;
  cancel?: (handle: unknown) => void;
}

/** Foreground setup and manual retries share one operation, identity, and retry clock. */
export function createUploadStartup(options: StartupOptions) {
  const now = options.now ?? Date.now;
  const schedule = options.schedule ?? ((callback, delay) => setTimeout(callback, delay));
  const cancel = options.cancel ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  let active = false;
  let disposed = false;
  let ready = false;
  let running = false;
  let blocked = false;
  let retryDelay = 15_000;
  let retryAt = 0;
  let timer: unknown;
  const clear = () => { if (timer !== undefined) cancel(timer); timer = undefined; };
  async function start() {
    if (disposed || !active || ready || running || blocked) return;
    clear();
    if (now() < retryAt) {
      timer = schedule(() => void start(), retryAt - now());
      return;
    }
    running = true;
    options.started();
    try {
      if (await options.bootstrap(() => !disposed && active)) {
        if (disposed) return;
        if (!await options.initialize())
          throw new SyncError("The saved upload connection could not be loaded. Your workouts remain on this phone.", true, "storage");
        ready = true;
      }
    } catch (error) {
      if (disposed) return;
      if (!(error instanceof SyncError) || error.retryable) {
        retryAt = Math.max(now() + retryDelay, error instanceof SyncError ? error.retryAt ?? 0 : 0);
        retryDelay = Math.min(retryDelay * 2, 300_000);
      } else blocked = true;
      options.failed(error, blocked ? null : retryAt);
    } finally {
      running = false;
      if (!disposed && active && !ready && !blocked && timer === undefined)
        timer = schedule(() => void start(), Math.max(0, retryAt - now()));
    }
  }
  return {
    setActive(value: boolean) {
      active = value;
      if (active) void start(); else clear();
    },
    retry() {
      if (disposed || !active || blocked) return;
      if (ready) options.retryUpload(); else void start();
    },
    dispose() { disposed = true; clear(); },
  };
}
