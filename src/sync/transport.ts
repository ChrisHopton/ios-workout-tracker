import {
  byteLength,
  encodeFirestoreDocument,
  makeBatch,
  parseCommitReceipt,
  MAX_BATCH_BYTES,
  validateCredentials,
  type CommitReceipt,
  type DocumentChange,
  type SyncCredentials,
} from "./protocol";

export type SyncRequest =
  | { action: "bind"; installationId: string }
  | { action: "upload"; installationId: string; changes: DocumentChange[] };

export type SyncErrorKind = "network" | "auth" | "quota" | "invalid" | "storage";

export class SyncError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly kind: SyncErrorKind = "network",
    readonly retryAt: number | null = null,
  ) {
    super(message);
    this.name = "SyncError";
  }
}
export type SyncTransport = (
  request: SyncRequest,
  credentials: SyncCredentials,
  canSend?: () => boolean,
) => Promise<CommitReceipt>;

export interface TransportOptions {
  now?: () => number;
  timeoutMs?: number;
  setTimeout?: (callback: () => void, delay: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
  loadRefreshToken?: (credentials: SyncCredentials) => Promise<string | null>;
  saveRefreshToken?: (credentials: SyncCredentials, token: string) => Promise<void>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const REJECTED = "Cloud connection rejected or already used. Ask the owner for a replacement code.";
const INVALID = "The cloud response could not be verified. Try again or replace the connection code.";

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function exact(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
function timestamp(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value)) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 19) === value.slice(0, 19);
}
function opaque(value: unknown): value is string {
  return typeof value === "string" && /^[!-~]{1,16384}$/.test(value);
}

export function validateResponse(request: SyncRequest, value: unknown): CommitReceipt {
  try {
    return parseCommitReceipt(value, request.action === "upload" ? request.changes : []);
  } catch {
    throw new SyncError(INVALID, false, "invalid");
  }
}

export function makeCommitBody(request: SyncRequest, credentials: SyncCredentials): string {
  try {
    const checked = validateCredentials(credentials);
    if (!UUID.test(request.installationId)) throw new Error();
    let writes;
    if (request.action === "bind" && exact(request as unknown as Record<string, unknown>, ["action", "installationId"])) {
      writes = [{
        update: {
          name: `projects/${checked.projectId}/databases/(default)/documents/devices/${checked.deviceId}/generations/${checked.generationId}`,
          fields: {
            schemaVersion: { integerValue: "1" },
            deviceId: { stringValue: checked.deviceId },
            generationId: { stringValue: checked.generationId },
            installationId: { stringValue: request.installationId },
          },
        },
      }];
    } else if (
      request.action === "upload" &&
      exact(request as unknown as Record<string, unknown>, ["action", "installationId", "changes"]) &&
      Array.isArray(request.changes) && request.changes.length > 0
    ) {
      const batch = makeBatch(checked, request.changes, request.installationId);
      if (
        batch.changes.length !== request.changes.length ||
        new Set(request.changes.map((change) => change.key)).size !== request.changes.length
      ) throw new Error();
      writes = request.changes.map((change) => ({
        update: encodeFirestoreDocument(checked, request.installationId, change),
      }));
    } else throw new Error();
    const body = JSON.stringify({ writes });
    if (byteLength(body) > MAX_BATCH_BYTES) throw new Error();
    return body;
  } catch {
    throw new SyncError("The pending cloud data or connection is invalid.", false, "invalid");
  }
}

function commitReceipt(value: unknown, request: SyncRequest): CommitReceipt {
  const count = request.action === "bind" ? 1 : request.changes.length;
  if (
    !record(value) || !exact(value, ["writeResults", "commitTime"]) ||
    !timestamp(value.commitTime) || !Array.isArray(value.writeResults) ||
    value.writeResults.length !== count ||
    value.writeResults.some((result) =>
      !record(result) || !exact(result, ["updateTime"]) || !timestamp(result.updateTime) ||
      Date.parse(result.updateTime) > Date.parse(value.commitTime as string))
  ) throw new SyncError(INVALID, false, "invalid");
  return {
    acknowledged: request.action === "bind"
      ? []
      : request.changes.map(({ key, revision }) => ({ key, revision })),
  };
}

export function nextPacificReset(at: number): number {
  const format = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit",
  });
  const day = (value: number) => format.format(value);
  const today = day(at);
  let low = at;
  let high = at + 27 * 60 * 60 * 1000;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (day(middle) === today) low = middle;
    else high = middle;
  }
  return high;
}

interface Session {
  idToken: string;
  refreshToken: string;
  expiresAt: number;
}
function authSession(value: unknown, credentials: SyncCredentials, refresh: boolean, now: number): Session {
  if (!record(value)) throw new SyncError(INVALID, false, "invalid");
  const uid = refresh ? value.user_id : value.localId;
  const idToken = refresh ? value.id_token : value.idToken;
  const refreshToken = refresh ? value.refresh_token : value.refreshToken;
  const expiration = refresh ? value.expires_in : value.expiresIn;
  if (
    uid !== credentials.uid || !opaque(idToken) || !opaque(refreshToken) ||
    typeof expiration !== "string" || !/^\d+$/.test(expiration) ||
    Number(expiration) < 1 || Number(expiration) > 86_400 ||
    (refresh && value.token_type !== "Bearer")
  ) throw new SyncError(INVALID, false, "invalid");
  return { idToken, refreshToken, expiresAt: now + Number(expiration) * 1000 };
}

export function createSyncTransport(
  fetchImplementation?: typeof fetch,
  options: TransportOptions = {},
): SyncTransport {
  const fetcher = fetchImplementation ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const schedule = options.setTimeout ?? ((callback, delay) => setTimeout(callback, delay));
  const cancel = options.clearTimeout ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const sessions = new Map<string, Session>();
  const authenticating = new Map<string, Promise<Session>>();

  async function json(url: string, init: RequestInit): Promise<{ status: number; value: unknown }> {
    const abort = new AbortController();
    let timer: unknown;
    const timeout = new Promise<never>((_, reject) => {
      timer = schedule(() => {
        abort.abort();
        reject(new SyncError("Cloud upload timed out. Your changes remain saved on this phone.", true));
      }, options.timeoutMs ?? 20_000);
    });
    try {
      const network = (async () => {
        const response = await fetcher(url, { ...init, redirect: "error", signal: abort.signal });
        let value: unknown;
        try { value = await response.json(); } catch {
          if (response.status === 200) throw new SyncError(INVALID, false, "invalid");
          value = null;
        }
        return { status: response.status, value };
      })();
      return await Promise.race([network, timeout]);
    } catch (error) {
      if (error instanceof SyncError) throw error;
      throw new SyncError("Cloud upload could not connect. Your changes remain saved on this phone.", true);
    } finally {
      cancel(timer);
    }
  }
  function failure(status: number, value: unknown, auth: boolean): SyncError {
    const code = record(value) && record(value.error) && typeof value.error.message === "string"
      ? value.error.message
      : "";
    if (status === 429 || code === "RESOURCE_EXHAUSTED" || code === "TOO_MANY_ATTEMPTS_TRY_LATER") {
      return new SyncError(
        "Cloud uploads are paused until the upload quota resets. Your changes remain saved on this phone.",
        true, "quota", auth ? now() + 300_000 : nextPacificReset(now()),
      );
    }
    if (status === 408 || status >= 500) return new SyncError("Cloud upload is temporarily unavailable. Try again.", true);
    return new SyncError(REJECTED, false, "auth");
  }
  async function authenticate(credentials: SyncCredentials, key: string): Promise<Session> {
    let refreshToken: string | null;
    try { refreshToken = sessions.get(key)?.refreshToken ?? await options.loadRefreshToken?.(credentials) ?? null; } catch {
      throw new SyncError("Saved cloud authorization could not be read. Try again.", true, "storage");
    }
    if (refreshToken !== null && !opaque(refreshToken)) throw new SyncError(INVALID, false, "invalid");
    let response;
    if (refreshToken) {
      response = await json(
        `https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(credentials.apiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`,
        },
      );
      if (response.status === 200) return authSession(response.value, credentials, true, now());
      const code = record(response.value) && record(response.value.error) ? response.value.error.message : null;
      if (code !== "INVALID_REFRESH_TOKEN" && code !== "TOKEN_EXPIRED") {
        throw failure(response.status, response.value, true);
      }
    }
    response = await json(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(credentials.apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: credentials.email, password: credentials.password, returnSecureToken: true }),
      },
    );
    if (response.status !== 200) throw failure(response.status, response.value, true);
    return authSession(response.value, credentials, false, now());
  }
  async function authorization(credentials: SyncCredentials): Promise<{ session: Session; cached: boolean; key: string }> {
    const key = JSON.stringify(credentials);
    let session = sessions.get(key);
    const cached = session !== undefined && session.expiresAt - 60_000 > now();
    if (!cached) {
      let pending = authenticating.get(key);
      if (!pending) {
        pending = authenticate(credentials, key);
        authenticating.set(key, pending);
      }
      try {
        session = await pending;
        sessions.set(key, session);
      } finally {
        if (authenticating.get(key) === pending) authenticating.delete(key);
      }
    }
    try { await options.saveRefreshToken?.(credentials, session!.refreshToken); } catch {
      throw new SyncError("Cloud authorization could not be saved securely. Try again.", true, "storage");
    }
    return { session: session!, cached, key };
  }

  return async (request, credentials, canSend = () => true) => {
    if (!fetchImplementation && typeof document !== "undefined") {
      throw new SyncError("Cloud uploads are available in the iPhone app. Browser preview uses a local demo.", false, "invalid");
    }
    const body = makeCommitBody(request, credentials);
    const checked = validateCredentials(credentials);
    if (!canSend()) throw new SyncError("Cloud upload paused while the app is closed.", true);
    const auth = await authorization(checked);
    if (!canSend()) throw new SyncError("Cloud upload paused while the app is closed.", true);
    const response = await json(
      `https://firestore.googleapis.com/v1/projects/${checked.projectId}/databases/(default)/documents:commit`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth.session.idToken}` },
        body,
      },
    );
    if (response.status === 401 && auth.cached) {
      auth.session.expiresAt = 0;
      throw new SyncError("Cloud authorization is being renewed. Try again.", true);
    }
    if (response.status !== 200) throw failure(response.status, response.value, false);
    return commitReceipt(response.value, request);
  };
}

export const requestSync = createSyncTransport();
