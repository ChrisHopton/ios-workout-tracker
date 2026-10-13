import test from "node:test";
import assert from "node:assert/strict";
import {
  createSyncTransport,
  requestSync,
  SyncError,
  type TransportOptions,
} from "../src/sync/transport";
import {
  makeBatch,
  makeRowKey,
  type RowChange,
  type SyncCredentials,
  type SyncRequest,
} from "../src/sync/protocol";
import * as previewSecrets from "../src/sync/credentials.web";

const DEVICE = "11111111-1111-4111-8111-111111111111";
const CREDENTIALS: SyncCredentials = {
  version: 1,
  endpoint: "https://script.google.com/macros/s/test_deployment/exec",
  deviceId: DEVICE,
  token: "a".repeat(64),
};
const ROW: RowChange = {
  table: "People",
  key: makeRowKey("People", DEVICE, "profile"),
  values: ["Phone", 30, "Unspecified", 175, "lb"],
  revision: 1,
  deleted: false,
};
const REQUEST = makeBatch(CREDENTIALS, [ROW]);

function reply(request = REQUEST) {
  return {
    version: 1, ok: true, deviceId: DEVICE, maxRevision: 9,
    acknowledged: (request.changes ?? []).map(({ key, revision }) => ({ key, revision })),
  };
}

function fetcher(callback: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  return callback as typeof fetch;
}

test("POST follows the Apps Script redirect and validates the complete acknowledgement", async () => {
  const transport = createSyncTransport(fetcher(async (input, init) => {
    assert.equal(input, CREDENTIALS.endpoint);
    assert.equal(init?.method, "POST");
    assert.equal(init?.redirect, "follow");
    assert.equal(init?.headers && (init.headers as Record<string, string>)["Content-Type"], "application/json");
    assert.deepEqual(JSON.parse(init!.body as string), REQUEST);
    assert.ok(init?.signal instanceof AbortSignal);
    return Response.json(reply());
  }));
  assert.deepEqual(await transport(REQUEST, CREDENTIALS), reply());
});

test("timeout aborts a request even when fetch never settles", async () => {
  let timeout!: () => void;
  let cancelled = false;
  let signal!: AbortSignal;
  const options: TransportOptions = {
    setTimeout: (callback, delay) => {
      assert.equal(delay, 20_000);
      timeout = callback;
      return 7;
    },
    clearTimeout: (handle) => { assert.equal(handle, 7); cancelled = true; },
  };
  const transport = createSyncTransport(fetcher(async (_, init) => {
    signal = init!.signal!;
    return new Promise<Response>(() => undefined);
  }), options);
  const request = transport(REQUEST, CREDENTIALS);
  timeout();
  await assert.rejects(request, (error: unknown) =>
    error instanceof SyncError && error.retryable && /timed out/.test(error.message));
  assert.equal(signal.aborted, true);
  assert.equal(cancelled, true);
});

test("the twenty second timeout also covers a stalled response body", async () => {
  let timeout!: () => void;
  const transport = createSyncTransport(fetcher(async () => ({
    ok: true,
    json: () => new Promise(() => undefined),
  }) as Response), {
    setTimeout: (callback) => { timeout = callback; return 1; },
    clearTimeout: () => undefined,
  });
  const request = transport(REQUEST, CREDENTIALS);
  await Promise.resolve();
  timeout();
  await assert.rejects(request, /timed out/);
});

test("non-JSON HTTP 200 responses and malformed response shapes are rejected", async () => {
  const invalid = [
    { ...reply(), version: 2 },
    { ...reply(), deviceId: "22222222-2222-4222-8222-222222222222" },
    { ...reply(), acknowledged: [] },
    { ...reply(), acknowledged: [{ key: ROW.key, revision: 2 }] },
    { ...reply(), acknowledged: [{ key: ROW.key, revision: 1 }, { key: ROW.key, revision: 1 }] },
    { ...reply(), maxRevision: -1 },
    { ...reply(), token: CREDENTIALS.token },
  ];
  for (const value of invalid) {
    const transport = createSyncTransport(fetcher(async () => Response.json(value)));
    await assert.rejects(transport(REQUEST, CREDENTIALS), (error: unknown) =>
      error instanceof SyncError && !error.retryable && /invalid response/.test(error.message));
  }
  const html = createSyncTransport(fetcher(async () => new Response("<html>Sign in</html>")));
  await assert.rejects(html(REQUEST, CREDENTIALS), /invalid response/);
});

test("HTTP authentication errors stop retries while rate limits and server failures can retry", async () => {
  for (const [status, retryable] of [[403, false], [400, false], [429, true], [408, true], [503, true]] as const) {
    const transport = createSyncTransport(fetcher(async () => new Response("", { status })));
    await assert.rejects(transport(REQUEST, CREDENTIALS), (error: unknown) =>
      error instanceof SyncError && error.retryable === retryable);
  }
});

test("failure responses and raw network exceptions never expose endpoint or token text", async () => {
  const transport = createSyncTransport(fetcher(async () =>
    Response.json({ version: 1, ok: false, error: CREDENTIALS.token, retryable: false })));
  const response = await transport(REQUEST, CREDENTIALS);
  assert.equal(response.ok, false);
  if (!response.ok) {
    assert.ok(!response.error.includes(CREDENTIALS.token));
    assert.equal(response.retryable, false);
  }
  const offline = createSyncTransport(fetcher(async () => {
    throw new Error(`${CREDENTIALS.endpoint} ${CREDENTIALS.token}`);
  }));
  await assert.rejects(offline(REQUEST, CREDENTIALS), (error: unknown) =>
    error instanceof SyncError && error.retryable &&
    !error.message.includes(CREDENTIALS.token) &&
    !error.message.includes(CREDENTIALS.endpoint));
});

test("request validation refuses invalid credentials and oversized requests before fetching", async () => {
  let calls = 0;
  const transport = createSyncTransport(fetcher(async () => { calls++; return Response.json(reply()); }));
  const invalidRequests = [
    { ...REQUEST, token: "b".repeat(64) },
    { ...REQUEST, version: 2 },
    { ...REQUEST, extra: true },
    { ...REQUEST, changes: [ROW, ROW] },
    { ...REQUEST, changes: [{ ...ROW, revision: 0 }] },
    { version: 1, action: "hello", deviceId: DEVICE, token: CREDENTIALS.token, changes: [] },
    { ...REQUEST, changes: Array.from({ length: 101 }, (_, index) =>
      ({ ...ROW, key: makeRowKey("People", DEVICE, index) })) },
    { ...REQUEST, changes: Array.from({ length: 20 }, (_, index) => ({
      ...ROW, key: makeRowKey("People", DEVICE, index),
      values: ["x".repeat(14_000), 30, "Unspecified", 175, "lb"],
    })) },
  ];
  for (const request of invalidRequests) {
    await assert.rejects(transport(request as SyncRequest, CREDENTIALS), /pending sync data is invalid/);
  }
  await assert.rejects(transport(REQUEST, {
    ...CREDENTIALS, endpoint: "https://example.com/steal",
  }), /pending sync data is invalid/);
  assert.equal(calls, 0);
});

test("hello accepts only an empty acknowledgement list", async () => {
  const hello: SyncRequest = {
    version: 1, action: "hello", deviceId: DEVICE, token: CREDENTIALS.token,
  };
  const valid = createSyncTransport(fetcher(async () => Response.json(reply(hello))));
  assert.equal((await valid(hello, CREDENTIALS)).ok, true);
  const invalid = createSyncTransport(fetcher(async () => Response.json(reply())));
  await assert.rejects(invalid(hello, CREDENTIALS), /invalid response/);
});

test("web credentials remain only in memory and real browser transport refuses network calls", async () => {
  await previewSecrets.removeCredentials();
  assert.equal(await previewSecrets.loadCredentials(), null);
  await previewSecrets.saveCredentials(CREDENTIALS);
  const loaded = await previewSecrets.loadCredentials();
  assert.deepEqual(loaded, CREDENTIALS);
  loaded!.token = "b".repeat(64);
  assert.deepEqual(await previewSecrets.loadCredentials(), CREDENTIALS);
  Object.defineProperty(globalThis, "document", { value: {}, configurable: true });
  try {
    await assert.rejects(requestSync(REQUEST, CREDENTIALS), /iPhone app/);
  } finally {
    Reflect.deleteProperty(globalThis, "document");
    await previewSecrets.removeCredentials();
  }
  assert.equal(await previewSecrets.loadCredentials(), null);
});