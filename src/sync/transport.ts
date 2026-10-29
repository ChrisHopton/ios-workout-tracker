import { isAttestationDiagnostic } from "./attestationDiagnostic";
import {
  byteLength,
  documentRoot,
  encodeFirestoreDocument,
  makeBatch,
  parseCommitReceipt,
  MAX_BATCH_BYTES,
  validateCredentials,
  type AnonymousSyncCredentials,
  type CommitReceipt,
  type DocumentChange,
  type SyncCredentials,
} from "./protocol";

export type SyncRequest =
  | { action: "bind"; installationId: string }
  | { action: "upload"; installationId: string; changes: DocumentChange[] };

export type SyncErrorKind = "network" | "auth" | "quota" | "invalid" | "storage" | "attestation" | "enrollment";

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
  getAppCheckToken?: (forceRefresh?: boolean) => Promise<string>;
  requireAppCheck?: boolean;
  now?: () => number;
  timeoutMs?: number;
  setTimeout?: (callback: () => void, delay: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
  loadRefreshToken?: (credentials: SyncCredentials) => Promise<string | null>;
  saveRefreshToken?: (credentials: SyncCredentials, token: string) => Promise<void>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const REJECTED = "Cloud connection rejected or already used. Ask the owner for a replacement code.";
const INVALID = "The cloud response could not be verified. Your changes remain saved on this phone.";

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
          name: documentRoot(checked),
          fields: {
            schemaVersion: { integerValue: checked.version === 2 ? "2" : "1" },
            ...(checked.version === 2 ? { enabled: { booleanValue: true } } : {}),
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

function createJsonRequest(fetcher: typeof fetch, options: TransportOptions) {
  const schedule = options.setTimeout ?? ((callback, delay) => setTimeout(callback, delay));
  const cancel = options.clearTimeout ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  return async function json(url: string, init: RequestInit): Promise<{ status: number; value: unknown }> {
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
  };
}

export function createSyncTransport(
  fetchImplementation?: typeof fetch,
  options: TransportOptions = {},
): SyncTransport {
  const fetcher = fetchImplementation ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const sessions = new Map<string, Session>();
  const authenticating = new Map<string, Promise<Session>>();
  const forceAttestation = new Set<string>();

  const json = createJsonRequest(fetcher, options);
  function failure(status: number, value: unknown, auth: boolean, automatic = false): SyncError {
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
    return new SyncError(automatic ? "Cloud authorization was revoked or rejected. Your changes remain saved on this phone." : REJECTED, false, "auth");
  }
  async function authenticate(credentials: SyncCredentials, key: string): Promise<Session> {
    let refreshToken: string | null;
    try { refreshToken = sessions.get(key)?.refreshToken ?? await options.loadRefreshToken?.(credentials) ??
      (credentials.version === 2 ? credentials.refreshToken : null); } catch {
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
      if (credentials.version === 2 || (code !== "INVALID_REFRESH_TOKEN" && code !== "TOKEN_EXPIRED")) {
        throw failure(response.status, response.value, true, credentials.version === 2);
      }
    }
    if (credentials.version === 2) throw new SyncError("Cloud authorization is unavailable. Your changes remain saved on this phone.", false, "auth");
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
    const credentialKey = JSON.stringify(checked);
    const forceRefresh = forceAttestation.has(credentialKey);
    let appCheckToken: string | undefined;
    if (options.requireAppCheck && !options.getAppCheckToken) {
      throw new SyncError("App verification is unavailable. Cloud uploads remain paused.", false, "attestation");
    }
    if (options.getAppCheckToken) {
      const schedule = options.setTimeout ?? ((callback, delay) => setTimeout(callback, delay));
      const cancel = options.clearTimeout ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
      let timer: unknown;
      try {
        const timeout = new Promise<never>((_, reject) => {
          timer = schedule(() => reject(new Error()), options.timeoutMs ?? 20_000);
        });
        appCheckToken = await Promise.race([options.getAppCheckToken(forceRefresh), timeout]);
        if (!opaque(appCheckToken)) throw new Error();
      } catch (error) {
        if (error instanceof SyncError && error.kind === "attestation" && isAttestationDiagnostic(error.message)) throw error;
        throw new SyncError("App verification could not be refreshed. Try again.", true, "attestation");
      } finally {
        cancel(timer);
      }
    }
    if (!canSend()) throw new SyncError("Cloud upload paused while the app is closed.", true);
    const auth = await authorization(checked);
    if (!canSend()) throw new SyncError("Cloud upload paused while the app is closed.", true);
    const response = await json(
      `https://firestore.googleapis.com/v1/projects/${checked.projectId}/databases/(default)/documents:commit`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json", Authorization: `Bearer ${auth.session.idToken}`,
          ...(appCheckToken ? { "X-Firebase-AppCheck": appCheckToken } : {}),
        },
        body,
      },
    );
    const responseError = record(response.value) && record(response.value.error) ? response.value.error : null;
    // App Check rejection can be identified by either its message or structured ErrorInfo reason.
    if ((response.status === 401 || response.status === 403) && responseError &&
      /app[ _-]?check|app attestation/i.test(JSON.stringify(responseError))) {
      if (forceRefresh) forceAttestation.delete(credentialKey);
      else forceAttestation.add(credentialKey);
      throw new SyncError("App verification was rejected. Cloud uploads remain paused.", !forceRefresh, "attestation");
    }
    if (response.status === 200) forceAttestation.delete(credentialKey);
    if (response.status === 401 && auth.cached) {
      auth.session.expiresAt = 0;
      throw new SyncError("Cloud authorization is being renewed. Try again.", true);
    }
    if (checked.version === 2 && request.action === "bind" && response.status === 403 &&
      responseError?.status === "PERMISSION_DENIED") {
      // A closed rollout gate can deny a new binding. Keep retrying this same saved UID;
      // authentication failures above and denials of already-bound uploads remain terminal.
      throw new SyncError("Automatic uploads are waiting for authorization. Your workouts are saved locally.", true, "enrollment");
    }
    if (response.status !== 200) throw failure(response.status, response.value, false, checked.version === 2);
    return commitReceipt(response.value, request);
  };
}

export interface AnonymousCredentialsOptions extends Pick<TransportOptions, "timeoutMs" | "setTimeout" | "clearTimeout" | "now"> {
  fetchImplementation?: typeof fetch;
  canSend?: () => boolean;
}

// Creation is an explicit bootstrap operation. Upload authentication never calls this function.
export async function createAnonymousCredentials(
  config: { projectId: string; apiKey: string },
  identity: { deviceId: string; generationId: string },
  options: AnonymousCredentialsOptions = {},
): Promise<AnonymousSyncCredentials> {
  let pending: AnonymousSyncCredentials;
  try {
    pending = validateCredentials({
      version: 2, layout: "automatic", projectId: config.projectId, apiKey: config.apiKey,
      deviceId: identity.deviceId, generationId: identity.generationId, uid: "pending", refreshToken: "pending",
    }) as AnonymousSyncCredentials;
  } catch {
    throw new SyncError("Automatic cloud upload configuration is invalid.", false, "invalid");
  }
  if (!options.fetchImplementation && typeof document !== "undefined") {
    throw new SyncError("Browser preview uses a local demo.", false, "invalid");
  }
  if (options.canSend && !options.canSend()) throw new SyncError("Cloud upload paused while the app is closed.", true);
  const json = createJsonRequest(options.fetchImplementation ?? globalThis.fetch, options);
  const response = await json(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(pending.apiKey)}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ returnSecureToken: true }) },
  );
  if (response.status !== 200) {
    const code = record(response.value) && record(response.value.error) ? response.value.error.message : null;
    if (response.status === 429 || code === "TOO_MANY_ATTEMPTS_TRY_LATER" || code === "RESOURCE_EXHAUSTED") {
      throw new SyncError("Cloud setup is temporarily limited. Try again later.", true, "quota", (options.now ?? Date.now)() + 300_000);
    }
    if (response.status === 408 || response.status >= 500) {
      throw new SyncError("Cloud setup is temporarily unavailable. Try again.", true);
    }
    throw new SyncError("Automatic cloud upload authorization was rejected.", false, "auth");
  }
  try {
    if (!record(response.value) || (response.value.email !== undefined && response.value.email !== "")) throw new Error();
    const credentials = validateCredentials({
      ...pending, uid: response.value.localId, refreshToken: response.value.refreshToken,
    });
    if (credentials.version !== 2) throw new Error();
    authSession(response.value, credentials, false, (options.now ?? Date.now)());
    return credentials;
  } catch {
    throw new SyncError(INVALID, false, "invalid");
  }
}

export const requestSync = createSyncTransport();
