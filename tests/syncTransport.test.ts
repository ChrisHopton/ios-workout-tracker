import test from "node:test";
import assert from "node:assert/strict";
import {
  createSyncTransport, makeCommitBody, nextPacificReset, requestSync,
  SyncError, validateResponse, type SyncRequest, type TransportOptions,
} from "../src/sync/transport";
import { makeDocumentKey, type DocumentChange, type AnonymousSyncCredentials } from "../src/sync/protocol";
import * as secrets from "../src/sync/credentials.web";

const DEVICE = "11111111-1111-4111-8111-111111111111";
const GENERATION = "22222222-2222-4222-8222-222222222222";
const INSTALLATION = "33333333-3333-4333-8333-333333333333";
const CREDENTIALS: AnonymousSyncCredentials = {
  version: 3, layout: "automatic", projectId: "workout-test", apiKey: "a".repeat(39), deviceId: DEVICE,
  generationId: GENERATION, uid: "phone_one", refreshToken: "private-test-refresh",
};
const CHANGE: DocumentChange = {
  key: makeDocumentKey("workout", DEVICE, "session"), kind: "workout",
  payload: { title: "Workout", exercises: [] }, revision: 1, deleted: false,
};
const REQUEST: SyncRequest = { action: "upload", installationId: INSTALLATION, changes: [CHANGE] };
const STAMP = "2026-10-13T12:00:00.000Z";
function refreshResponse(overrides: Record<string, unknown> = {}) {
  return {
    id_token: "refreshed-id-token", refresh_token: "rotated-refresh-token",
    expires_in: "3600", user_id: CREDENTIALS.uid, token_type: "Bearer",
    project_id: "1234567890", ...overrides,
  };
}
function commitResponse(count = 1) {
  return { writeResults: Array.from({ length: count }, () => ({ updateTime: STAMP })), commitTime: STAMP };
}
function fetcher(callback: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  return callback as typeof fetch;
}
async function settle() { for (let index = 0; index < 40; index++) await Promise.resolve(); }
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

test("refreshes its device identity then only POSTs an atomic Commit with complete document envelopes", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const transport = createSyncTransport(fetcher(async (input, init) => {
    calls.push({ url: String(input), init: init! });
    return Response.json(calls.length === 1 ? refreshResponse() : commitResponse());
  }));
  assert.deepEqual(await transport(REQUEST, CREDENTIALS), {
    acknowledged: [{ key: CHANGE.key, revision: 1 }],
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, `https://securetoken.googleapis.com/v1/token?key=${CREDENTIALS.apiKey}`);
  assert.equal(calls[0].init.body, "grant_type=refresh_token&refresh_token=" + CREDENTIALS.refreshToken);
  assert.equal(calls[1].url, "https://firestore.googleapis.com/v1/projects/workout-test/databases/(default)/documents:commit");
  assert.equal((calls[1].init.headers as Record<string, string>).Authorization, "Bearer refreshed-id-token");
  const body = JSON.parse(calls[1].init.body as string);
  assert.deepEqual(Object.keys(body), ["writes"]);
  assert.deepEqual(Object.keys(body.writes[0]), ["update"]);
  assert.ok(body.writes[0].update.name.includes(`automaticUploads/${CREDENTIALS.uid}/records/`));
  assert.equal(body.writes[0].update.fields.installationId.stringValue, INSTALLATION);
  assert.equal(body.writes[0].update.fields.revision.integerValue, "1");
  assert.ok(!(calls[1].init.body as string).includes(CREDENTIALS.refreshToken));
  assert.ok(calls.every(({ init }) => init.method === "POST" && init.redirect === "error"));
});

test("loads a refresh token, verifies its UID, persists rotation, and caches only the ID token in memory", async () => {
  const urls: string[] = [];
  const saved: string[] = [];
  const transport = createSyncTransport(fetcher(async (input, init) => {
    urls.push(String(input));
    if (urls.length === 1) {
      assert.equal(init?.body, "grant_type=refresh_token&refresh_token=old%2Btoken");
      return Response.json(refreshResponse());
    }
    assert.equal((init!.headers as Record<string, string>).Authorization, "Bearer refreshed-id-token");
    return Response.json(commitResponse());
  }), {
    loadRefreshToken: async () => "old+token",
    saveRefreshToken: async (credentials, token) => {
      assert.deepEqual(credentials, CREDENTIALS); saved.push(token);
    },
  });
  await transport(REQUEST, CREDENTIALS);
  await transport(REQUEST, CREDENTIALS);
  assert.equal(urls.filter((url) => url.includes("securetoken.googleapis.com")).length, 1);
  assert.ok(urls.every((url) => !url.includes("signInWithPassword")));
  assert.deepEqual(saved, ["rotated-refresh-token", "rotated-refresh-token"]);
});

test("refreshes expiring ID tokens and never falls back to signup or a password", async () => {
  let now = Date.UTC(2026, 9, 13, 12);
  const urls: string[] = [];
  const transport = createSyncTransport(fetcher(async input => {
    const url = String(input); urls.push(url);
    return Response.json(url.includes("securetoken.googleapis.com") ? refreshResponse() : commitResponse());
  }), { now: () => now });
  await transport(REQUEST, CREDENTIALS); now += 3_540_000; await transport(REQUEST, CREDENTIALS);
  assert.equal(urls.filter(url => url.includes("securetoken.googleapis.com")).length, 2);
  const attempts: string[] = [];
  const expired = createSyncTransport(fetcher(async input => {
    attempts.push(String(input));
    return Response.json({ error: { message: "INVALID_REFRESH_TOKEN" } }, { status: 400 });
  }));
  await assert.rejects(expired(REQUEST, CREDENTIALS), error => error instanceof SyncError && !error.retryable);
  assert.equal(attempts.length, 1);
  assert.ok(attempts[0].includes("securetoken.googleapis.com"));
});

test("disabled users and mismatched Auth UIDs never reach Firestore", async () => {
  for (const value of [refreshResponse({ user_id: "wrong_uid" }), refreshResponse({ expires_in: "NaN" }), refreshResponse({ id_token: "bad\ntoken" })]) {
    let calls = 0;
    const transport = createSyncTransport(fetcher(async () => { calls++; return Response.json(value); }));
    await assert.rejects(transport(REQUEST, CREDENTIALS), (error: unknown) => error instanceof SyncError && !error.retryable);
    assert.equal(calls, 1);
  }
  let calls = 0;
  const disabled = createSyncTransport(fetcher(async () => {
    calls++;
    return Response.json({ error: { message: "USER_DISABLED" } }, { status: 400 });
  }), { loadRefreshToken: async () => "old-refresh" });
  await assert.rejects(disabled(REQUEST, CREDENTIALS), (error: unknown) => error instanceof SyncError && error.kind === "auth");
  assert.equal(calls, 1);
  const wrongRefresh = createSyncTransport(fetcher(async () =>
    Response.json(refreshResponse({ user_id: "wrong_uid" }))), { loadRefreshToken: async () => "old-refresh" });
  await assert.rejects(wrongRefresh(REQUEST, CREDENTIALS), /could not be verified/);
});

test("an expired cached authorization causes a separately budgeted retry instead of an internal Commit retry", async () => {
  let commits = 0;
  let refreshes = 0;
  const transport = createSyncTransport(fetcher(async (input) => {
    const url = String(input);
    if (url.includes("securetoken.googleapis.com")) { refreshes++; return Response.json(refreshResponse()); }
    commits++;
    return commits === 2
      ? Response.json({ error: { status: "UNAUTHENTICATED" } }, { status: 401 })
      : Response.json(commitResponse());
  }));
  await transport(REQUEST, CREDENTIALS);
  await assert.rejects(transport(REQUEST, CREDENTIALS), (error: unknown) => error instanceof SyncError && error.retryable);
  assert.equal(commits, 2);
  await transport(REQUEST, CREDENTIALS);
  assert.equal(commits, 3);
  assert.equal(refreshes, 2);
});

test("timeout aborts stalled Auth requests and stalled Commit response bodies", async () => {
  let timeout!: () => void;
  let signal!: AbortSignal;
  let cancelled = 0;
  const options: TransportOptions = {
    setTimeout: (callback, delay) => { assert.equal(delay, 20_000); timeout = callback; return 1; },
    clearTimeout: () => { cancelled++; },
  };
  const stalled = createSyncTransport(fetcher(async (_, init) => {
    signal = init!.signal!;
    return new Promise<Response>(() => undefined);
  }), options);
  const request = stalled(REQUEST, CREDENTIALS);
  await settle();
  timeout();
  await assert.rejects(request, (error: unknown) => error instanceof SyncError && error.retryable && /timed out/.test(error.message));
  assert.equal(signal.aborted, true);
  assert.equal(cancelled, 1);
  let calls = 0;
  const body = createSyncTransport(fetcher(async () => {
    calls++;
    return calls === 1 ? Response.json(refreshResponse()) : {
      status: 200, json: () => new Promise(() => undefined),
    } as Response;
  }), options);
  const bodyRequest = body(REQUEST, CREDENTIALS);
  await settle();
  timeout();
  await assert.rejects(bodyRequest, /timed out/);
});

test("backgrounding while Auth is pending prevents the subsequent Firestore Commit", async () => {
  const gate = deferred<Response>();
  let active = true;
  let calls = 0;
  const transport = createSyncTransport(fetcher(async () => { calls++; return gate.promise; }));
  const request = transport(REQUEST, CREDENTIALS, () => active);
  await settle();
  active = false;
  gate.resolve(Response.json(refreshResponse()));
  await assert.rejects(request, /paused while/);
  assert.equal(calls, 1);
});

test("binding writes an immutable nonce manifest and validates exactly one write result", async () => {
  const bind: SyncRequest = { action: "bind", installationId: INSTALLATION };
  const body = JSON.parse(makeCommitBody(bind, CREDENTIALS));
  assert.equal(body.writes.length, 1);
  assert.deepEqual(body.writes[0].update.fields, {
    schemaVersion: { integerValue: "3" }, enabled: { booleanValue: true }, deviceId: { stringValue: DEVICE },
    generationId: { stringValue: GENERATION }, installationId: { stringValue: INSTALLATION },
  });
  assert.ok(!body.writes[0].update.name.includes("/records/"));
  const transport = createSyncTransport(fetcher(async (input) => Response.json(
    String(input).includes("securetoken.googleapis.com") ? refreshResponse() : commitResponse(),
  )));
  assert.deepEqual(await transport(bind, CREDENTIALS), { acknowledged: [] });
});

test("malformed HTTP 200 receipts acknowledge nothing including invalid times and transforms", async () => {
  const invalid = [
    {}, { ...commitResponse(), writeResults: [] },
    { ...commitResponse(), writeResults: [{ updateTime: STAMP }, { updateTime: STAMP }] },
    { ...commitResponse(), commitTime: "2026-02-30T12:00:00Z" },
    { ...commitResponse(), commitTime: "yesterday" },
    { ...commitResponse(), writeResults: [{ updateTime: "2026-10-14T12:00:00Z" }] },
    { ...commitResponse(), writeResults: [{ updateTime: STAMP, transformResults: [] }] },
    { ...commitResponse(), extra: true },
  ];
  for (const receipt of invalid) {
    const transport = createSyncTransport(fetcher(async (input) => Response.json(
      String(input).includes("securetoken.googleapis.com") ? refreshResponse() : receipt,
    )));
    await assert.rejects(transport(REQUEST, CREDENTIALS), (error: unknown) =>
      error instanceof SyncError && !error.retryable && error.kind === "invalid");
  }
  const html = createSyncTransport(fetcher(async (input) =>
    String(input).includes("securetoken.googleapis.com") ? Response.json(refreshResponse()) : new Response("<html>Sign in</html>")));
  await assert.rejects(html(REQUEST, CREDENTIALS), /could not be verified/);
});

test("HTTP errors are sanitized and distinguish quota, authorization, and temporary service failure", async () => {
  for (const [status, kind, retryable] of [
    [403, "auth", false], [400, "auth", false], [429, "quota", true], [503, "network", true],
  ] as const) {
    const transport = createSyncTransport(fetcher(async (input) =>
      String(input).includes("securetoken.googleapis.com")
        ? Response.json(refreshResponse())
        : new Response(CREDENTIALS.refreshToken, { status })),
      { now: () => Date.UTC(2026, 9, 13, 12) });
    await assert.rejects(transport(REQUEST, CREDENTIALS), (error: unknown) =>
      error instanceof SyncError && error.kind === kind && error.retryable === retryable &&
      !error.message.includes(CREDENTIALS.refreshToken) &&
      (kind !== "quota" || error.retryAt! > Date.UTC(2026, 9, 13, 12)));
  }
  const offline = createSyncTransport(fetcher(async () => { throw new Error(CREDENTIALS.refreshToken); }));
  await assert.rejects(offline(REQUEST, CREDENTIALS), (error: unknown) =>
    error instanceof SyncError && error.retryable && !error.message.includes(CREDENTIALS.refreshToken));
});

test("invalid or oversized requests fail before Auth or Firestore network calls", async () => {
  let calls = 0;
  const transport = createSyncTransport(fetcher(async () => { calls++; return Response.json(refreshResponse()); }));
  const requests = [
    { ...REQUEST, installationId: "invalid" },
    { ...REQUEST, extra: true },
    { ...REQUEST, changes: [] },
    { ...REQUEST, changes: [CHANGE, CHANGE] },
    { ...REQUEST, changes: [{ ...CHANGE, revision: 0 }] },
    { ...REQUEST, changes: Array.from({ length: 11 }, (_, index) => ({
      ...CHANGE, key: makeDocumentKey("workout", DEVICE, index),
    })) },
    { ...REQUEST, changes: Array.from({ length: 10 }, (_, index) => ({
      ...CHANGE, key: makeDocumentKey("workout", DEVICE, index), payload: { content: "x".repeat(50_000) },
    })) },
    { action: "bind", installationId: INSTALLATION, changes: [] },
  ];
  for (const request of requests) {
    await assert.rejects(transport(request as SyncRequest, CREDENTIALS), /invalid/);
  }
  await assert.rejects(transport(REQUEST, { ...CREDENTIALS, projectId: "../other-project" }), /invalid/);
  assert.equal(calls, 0);
});

test("receipt mapping requires exact revision order and complete acknowledgements", () => {
  const other = { ...CHANGE, key: makeDocumentKey("workout", DEVICE, "other") };
  const request: SyncRequest = { ...REQUEST, changes: [CHANGE, other] };
  assert.throws(() => validateResponse(request, {
    acknowledged: [{ key: other.key, revision: 1 }, { key: CHANGE.key, revision: 1 }],
  }), /could not be verified/);
  assert.throws(() => validateResponse({ action: "bind", installationId: INSTALLATION }, {
    acknowledged: [{ key: CHANGE.key, revision: 1 }],
  }), /could not be verified/);
});

test("Pacific quota reset handles both daylight saving transitions", () => {
  assert.equal(new Date(nextPacificReset(Date.parse("2026-03-08T08:00:00Z"))).toISOString(), "2026-03-09T07:00:00.000Z");
  assert.equal(new Date(nextPacificReset(Date.parse("2026-11-01T07:00:00Z"))).toISOString(), "2026-11-02T08:00:00.000Z");
});

test("browser credential storage discards stale refreshes and default transport never contacts Firebase", async () => {
  await secrets.removeCredentials();
  await secrets.saveCredentials(CREDENTIALS);
  await secrets.saveRefreshToken(CREDENTIALS, "old-refresh");
  assert.equal(await secrets.loadRefreshToken(CREDENTIALS), "old-refresh");
  const rotated = { ...CREDENTIALS, uid: "rotated_uid" };
  await secrets.saveCredentials(rotated);
  await secrets.saveRefreshToken(CREDENTIALS, "late-refresh");
  assert.equal(await secrets.loadRefreshToken(rotated), rotated.refreshToken);
  await secrets.saveRefreshToken(rotated, "new-refresh");
  assert.equal(await secrets.loadRefreshToken(rotated), "new-refresh");
  Object.defineProperty(globalThis, "document", { value: {}, configurable: true });
  try {
    await assert.rejects(requestSync(REQUEST, CREDENTIALS), /Browser preview/);
    await assert.rejects(createSyncTransport()(REQUEST, CREDENTIALS), /Browser preview/);
  } finally {
    Reflect.deleteProperty(globalThis, "document");
    await secrets.removeCredentials();
  }
  await secrets.saveRefreshToken(rotated, "late-after-disconnect");
  assert.equal(await secrets.loadCredentials(), null);
  assert.equal(await secrets.loadRefreshToken(rotated), null);
});
test("mocked native SecureStore repairs corrupt vault data and removes legacy Sheets credentials", async () => {
  const [{ readFileSync }, { resolve }, typescript, protocol, reset] = await Promise.all([
    import("node:fs"), import("node:path"), import("typescript"), import("../src/sync/protocol"), import("../src/sync/reset"),
  ]);
  const stored = new Map<string, string>([
    ["workout.firebase.credentials.v1", "{corrupt private data"],
    ["workout.sheets.credentials.v1", "legacy-private-secret"],
  ]);
  const options: unknown[] = [];
  const secureStore = {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 7,
    getItemAsync: async (key: string, option: unknown) => {
      options.push(option); return stored.get(key) ?? null;
    },
    setItemAsync: async (key: string, value: string, option: unknown) => {
      options.push(option); stored.set(key, value);
    },
    deleteItemAsync: async (key: string, option: unknown) => {
      options.push(option); stored.delete(key);
    },
  };
  const compiler = typescript.default;
  const source = readFileSync(resolve("src/sync/credentials.ts"), "utf8");
  const compiled = compiler.transpileModule(source, {
    compilerOptions: { module: compiler.ModuleKind.CommonJS, target: compiler.ScriptTarget.ES2022 },
  }).outputText;
  const exported: Record<string, unknown> = {};
  const localRequire = (name: string) => {
    if (name === "expo-secure-store") return secureStore;
    if (name === "./protocol") return protocol;
    if (name === "./reset") return reset;
    throw new Error("Unexpected mock dependency");
  };
  new Function("exports", "require", compiled)(exported, localRequire);
  const vault = exported as typeof import("../src/sync/credentials");
  await assert.rejects(vault.loadCredentials(), (error: unknown) =>
    error instanceof Error && /could not be read/.test(error.message) && !error.message.includes("private data"));
  await vault.saveCredentials(CREDENTIALS);
  assert.deepEqual(await vault.loadCredentials(), CREDENTIALS);
  assert.equal(stored.has("workout.sheets.credentials.v1"), false);
  await vault.saveRefreshToken(CREDENTIALS, "first-refresh");
  assert.equal(await vault.loadRefreshToken(CREDENTIALS), "first-refresh");
  const rotated = { ...CREDENTIALS, uid: "new_uid" };
  await Promise.all([
    vault.saveCredentials(rotated),
    vault.saveRefreshToken(CREDENTIALS, "stale-refresh"),
  ]);
  assert.equal(await vault.loadRefreshToken(rotated), rotated.refreshToken);
  assert.deepEqual(await vault.loadCredentials(), rotated);
  const value = JSON.parse(stored.get("workout.firebase.credentials.v1")!);
  assert.deepEqual(Object.keys(value), ["credentials", "refreshToken"]);
  assert.ok(!stored.get("workout.firebase.credentials.v1")!.includes("idToken"));
  await vault.removeCredentials();
  await vault.saveRefreshToken(rotated, "late-after-remove");
  assert.equal(await vault.loadCredentials(), null);
  assert.ok(options.every((option) =>
    (option as { keychainAccessible: number }).keychainAccessible === 7));
});
