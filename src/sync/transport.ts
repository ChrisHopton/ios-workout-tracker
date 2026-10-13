import {
  byteLength,
  makeBatch,
  MAX_BATCH_BYTES,
  parseSyncResponse,
  validateCredentials,
  type SyncCredentials,
  type SyncRequest,
  type SyncResponse,
} from "./protocol";

export class SyncError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
    this.name = "SyncError";
  }
}

export type SyncTransport = (
  request: SyncRequest,
  credentials: SyncCredentials,
) => Promise<SyncResponse>;

export interface TransportOptions {
  timeoutMs?: number;
  setTimeout?: (callback: () => void, delay: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

const INVALID_RESPONSE = "Sheets returned an invalid response. Reconnect and try again.";

export function validateResponse(
  request: SyncRequest,
  value: unknown,
): SyncResponse {
  let response: SyncResponse;
  try {
    response = parseSyncResponse(value, request.deviceId);
  } catch {
    throw new SyncError(INVALID_RESPONSE, false);
  }
  if (!response.ok) {
    return {
      ...response,
      error: response.retryable
        ? "Sheets sync is temporarily unavailable. Try again."
        : "Sheets rejected the connection. Reconnect and try again.",
    };
  }
  const changes = request.action === "upload" ? request.changes ?? [] : [];
  const expected = new Map(changes.map((change) => [change.key, change.revision]));
  if (
    expected.size !== changes.length ||
    response.acknowledged.length !== expected.size ||
    response.acknowledged.some(
      (ack) => expected.get(ack.key) !== ack.revision,
    )
  ) {
    throw new SyncError(INVALID_RESPONSE, false);
  }
  return response;
}

function requestBody(request: SyncRequest, credentials: SyncCredentials): string {
  try {
    const checked = validateCredentials(credentials);
    if (
      request.version !== 1 ||
      request.deviceId !== checked.deviceId ||
      request.token !== checked.token ||
      (request.action !== "hello" && request.action !== "upload")
    ) {
      throw new Error();
    }
    const expectedKeys =
      request.action === "hello"
        ? ["version", "action", "deviceId", "token"]
        : ["version", "action", "deviceId", "token", "changes"];
    if (
      Object.keys(request).length !== expectedKeys.length ||
      !expectedKeys.every((key) => Object.hasOwn(request, key))
    ) {
      throw new Error();
    }
    if (request.action === "upload") {
      if (!Array.isArray(request.changes)) throw new Error();
      const batch = makeBatch(checked, request.changes);
      if (
        batch.changes!.length !== request.changes.length ||
        new Set(request.changes.map((change) => change.key)).size !==
          request.changes.length
      ) {
        throw new Error();
      }
    }
    const body = JSON.stringify(request);
    if (byteLength(body) > MAX_BATCH_BYTES) throw new Error();
    return body;
  } catch {
    throw new SyncError("The pending sync data is invalid. Reconnect and try again.", false);
  }
}

export function createSyncTransport(
  fetchImplementation: typeof fetch = globalThis.fetch,
  options: TransportOptions = {},
): SyncTransport {
  const schedule = options.setTimeout ?? ((callback, delay) => setTimeout(callback, delay));
  const cancel =
    options.clearTimeout ??
    ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  return async (request, credentials) => {
    const body = requestBody(request, credentials);
    const abort = new AbortController();
    let timer: unknown;
    const timeout = new Promise<never>((_, reject) => {
      timer = schedule(() => {
        abort.abort();
        reject(new SyncError("Sheets sync timed out. Try again.", true));
      }, options.timeoutMs ?? 20_000);
    });
    try {
      const network = (async () => {
        const response = await fetchImplementation(credentials.endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          redirect: "follow",
          signal: abort.signal,
        });
        if (!response.ok) {
          const retryable =
            response.status === 408 ||
            response.status === 429 ||
            response.status >= 500;
          throw new SyncError(
            retryable
              ? "Sheets could not be reached. Try again."
              : "Sheets rejected the connection. Reconnect and try again.",
            retryable,
          );
        }
        let value: unknown;
        try {
          value = await response.json();
        } catch {
          throw new SyncError(INVALID_RESPONSE, false);
        }
        return validateResponse(request, value);
      })();
      return await Promise.race([network, timeout]);
    } catch (error) {
      if (error instanceof SyncError) throw error;
      throw new SyncError("Sheets could not be reached. Check your connection and try again.", true);
    } finally {
      cancel(timer);
    }
  };
}

const nativeTransport = createSyncTransport();

export const requestSync: SyncTransport = (request, credentials) => {
  if (typeof document !== "undefined") {
    return Promise.reject(
      new SyncError("Sheets sync is available in the iPhone app.", false),
    );
  }
  return nativeTransport(request, credentials);
};