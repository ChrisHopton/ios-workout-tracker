import test from "node:test";
import assert from "node:assert/strict";
import {
  documentRoot, encodeFirestoreDocument, identityOf, makeDocumentKey, parseConnectionCode,
  sameIdentity, validateCredentials, validateIdentity, type AnonymousSyncCredentials,
  type DocumentChange, type LegacySyncCredentials,
} from "../src/sync/protocol";
import {
  createAnonymousCredentials, createSyncTransport, makeCommitBody, SyncError, type SyncRequest,
} from "../src/sync/transport";
import { createPreviewTransport } from "../src/sync/previewTransport";
import * as browserVault from "../src/sync/credentials.web";

const DEVICE = "11111111-1111-4111-8111-111111111111";
const GENERATION = "22222222-2222-4222-8222-222222222222";
const INSTALLATION = "33333333-3333-4333-8333-333333333333";
const OTHER_INSTALLATION = "44444444-4444-4444-8444-444444444444";
const AUTOMATIC: AnonymousSyncCredentials = {
  version: 2, layout: "automatic", projectId: "workout-test", apiKey: "a".repeat(39),
  deviceId: DEVICE, generationId: GENERATION, uid: "anonymous_phone", refreshToken: "initial-refresh-secret",
};
const LEGACY: LegacySyncCredentials = {
  version: 1, projectId: AUTOMATIC.projectId, apiKey: AUTOMATIC.apiKey, deviceId: DEVICE,
  generationId: GENERATION, uid: "legacy_phone", email: "phone@example.com", password: "legacy-secret",
};
const CHANGE: DocumentChange = {
  key: makeDocumentKey("workout", DEVICE, "session"), kind: "workout",
  payload: { title: "Workout" }, revision: 1, deleted: false,
};
const BIND: SyncRequest = { action: "bind", installationId: INSTALLATION };
const UPLOAD: SyncRequest = { action: "upload", installationId: INSTALLATION, changes: [CHANGE] };
const STAMP = "2026-10-13T12:00:00.000Z";
const CONFIG = { projectId: AUTOMATIC.projectId, apiKey: AUTOMATIC.apiKey };
const IDENTITY = { deviceId: DEVICE, generationId: GENERATION };
function signup(overrides: Record<string, unknown> = {}) {
  return { localId: AUTOMATIC.uid, idToken: "id-token", refreshToken: AUTOMATIC.refreshToken, expiresIn: "3600", ...overrides };
}
function refreshed(overrides: Record<string, unknown> = {}) {
  return {
    user_id: AUTOMATIC.uid, id_token: "new-id-token", refresh_token: "new-refresh-token",
    token_type: "Bearer", expires_in: "3600", ...overrides,
  };
}
function committed() { return { writeResults: [{ updateTime: STAMP }], commitTime: STAMP }; }
function fetcher(callback: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) { return callback as typeof fetch; }
async function settle() { for (let count = 0; count < 40; count++) await Promise.resolve(); }

test("automatic identities retain their UID and never collide with a legacy generation", () => {
  assert.deepEqual(validateCredentials(AUTOMATIC), AUTOMATIC);
  assert.deepEqual(identityOf(AUTOMATIC), { projectId: CONFIG.projectId, ...IDENTITY, layout: "automatic", uid: AUTOMATIC.uid });
  assert.deepEqual(identityOf(LEGACY), { projectId: CONFIG.projectId, ...IDENTITY });
  assert.equal(sameIdentity(null, AUTOMATIC), false);
  assert.equal(sameIdentity(AUTOMATIC, undefined), false);
  assert.ok(sameIdentity(LEGACY, { ...identityOf(LEGACY), layout: "legacy" }));
  assert.ok(!sameIdentity(LEGACY, AUTOMATIC));
  assert.ok(!sameIdentity(AUTOMATIC, { ...AUTOMATIC, uid: "another_phone" }));
  assert.equal(documentRoot(AUTOMATIC), `projects/workout-test/databases/(default)/documents/automaticUploads/${AUTOMATIC.uid}`);
  assert.equal(documentRoot(LEGACY), `projects/workout-test/databases/(default)/documents/devices/${DEVICE}/generations/${GENERATION}`);
  for (const value of [
    { ...AUTOMATIC, uid: undefined }, { ...AUTOMATIC, uid: "../other" },
    { ...AUTOMATIC, layout: undefined }, { ...AUTOMATIC, layout: "legacy" },
    { ...AUTOMATIC, refreshToken: "" }, { ...AUTOMATIC, refreshToken: "bad\ntoken" },
    { ...AUTOMATIC, email: "extra@example.com" }, { ...AUTOMATIC, password: "extra" },
  ]) assert.throws(() => validateCredentials(value));
  assert.throws(() => validateIdentity({ ...IDENTITY, projectId: CONFIG.projectId, layout: "automatic" }));
  assert.throws(() => parseConnectionCode(`WORKOUTFB1.${Buffer.from(JSON.stringify(AUTOMATIC)).toString("base64url")}`));
});

test("automatic binding uses schema 2 while records and exact legacy commits retain schema 1", () => {
  const binding = JSON.parse(makeCommitBody(BIND, AUTOMATIC));
  assert.deepEqual(binding, { writes: [{ update: { name: documentRoot(AUTOMATIC), fields: {
    schemaVersion: { integerValue: "2" }, enabled: { booleanValue: true }, deviceId: { stringValue: DEVICE },
    generationId: { stringValue: GENERATION }, installationId: { stringValue: INSTALLATION },
  } } }] });
  const document = encodeFirestoreDocument(AUTOMATIC, INSTALLATION, CHANGE);
  assert.equal(document.name, `${documentRoot(AUTOMATIC)}/records/${CHANGE.key}`);
  assert.deepEqual(document.fields.schemaVersion, { integerValue: "1" });
  assert.deepEqual(document.fields, encodeFirestoreDocument(LEGACY, INSTALLATION, CHANGE).fields);
  assert.equal(makeCommitBody(BIND, LEGACY), JSON.stringify({ writes: [{ update: {
    name: `projects/workout-test/databases/(default)/documents/devices/${DEVICE}/generations/${GENERATION}`,
    fields: { schemaVersion: { integerValue: "1" }, deviceId: { stringValue: DEVICE },
      generationId: { stringValue: GENERATION }, installationId: { stringValue: INSTALLATION } },
  } }] }));
  assert.ok(!makeCommitBody(UPLOAD, AUTOMATIC).includes(AUTOMATIC.refreshToken));
});

test("explicit anonymous setup sends only returnSecureToken and returns validated refresh credentials", async () => {
  let calls = 0;
  const value = await createAnonymousCredentials(CONFIG, IDENTITY, { fetchImplementation: fetcher(async (input, init) => {
    calls++;
    assert.equal(String(input), `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${CONFIG.apiKey}`);
    assert.deepEqual(JSON.parse(init!.body as string), { returnSecureToken: true });
    assert.equal(init!.redirect, "error");
    assert.equal(init!.method, "POST");
    return Response.json(signup({ email: "" }));
  }) });
  assert.deepEqual(value, AUTOMATIC);
  assert.equal(calls, 1);
  assert.ok(!JSON.stringify(value).includes("idToken"));
});

test("anonymous setup sanitizes rejected and invalid responses without retrying creation", async () => {
  for (const response of [
    () => Response.json(signup({ localId: "../bad" })),
    () => Response.json(signup({ refreshToken: "" })),
    () => Response.json(signup({ idToken: "bad\ntoken" })),
    () => Response.json(signup({ expiresIn: "NaN" })),
    () => Response.json(signup({ email: "someone@example.com" })),
    () => new Response(AUTOMATIC.refreshToken, { status: 400 }),
    () => new Response(AUTOMATIC.refreshToken, { status: 503 }),
    () => new Response(AUTOMATIC.refreshToken, { status: 429 }),
  ]) {
    let calls = 0;
    await assert.rejects(createAnonymousCredentials(CONFIG, IDENTITY, { fetchImplementation: fetcher(async () => {
      calls++; return response();
    }) }), (error: unknown) => error instanceof SyncError && !error.message.includes(AUTOMATIC.refreshToken));
    assert.equal(calls, 1);
  }
});

test("anonymous creation validates inputs and lifecycle first and times out a stalled body", async () => {
  let calls = 0;
  const implementation = fetcher(async () => { calls++; return Response.json(signup()); });
  await assert.rejects(createAnonymousCredentials({ ...CONFIG, apiKey: "bad" }, IDENTITY, { fetchImplementation: implementation }));
  await assert.rejects(createAnonymousCredentials(CONFIG, IDENTITY, { fetchImplementation: implementation, canSend: () => false }));
  assert.equal(calls, 0);
  let timeout!: () => void;
  let signal!: AbortSignal;
  let cancelled = false;
  const pending = createAnonymousCredentials(CONFIG, IDENTITY, {
    fetchImplementation: fetcher(async (_, init) => {
      signal = init!.signal!;
      return { status: 200, json: () => new Promise(() => undefined) } as Response;
    }),
    setTimeout: (callback) => { timeout = callback; return 1; }, clearTimeout: () => { cancelled = true; },
  });
  await settle();
  timeout();
  await assert.rejects(pending, /timed out/);
  assert.equal(signal.aborted, true);
  assert.equal(cancelled, true);
});

test("automatic uploads use the saved refresh secret and never create or sign in a password account", async () => {
  const urls: string[] = [];
  const saved: string[] = [];
  const transport = createSyncTransport(fetcher(async (input, init) => {
    const url = String(input); urls.push(url);
    if (url.includes("securetoken")) {
      assert.equal(init!.body, `grant_type=refresh_token&refresh_token=${AUTOMATIC.refreshToken}`);
      return Response.json(refreshed());
    }
    assert.equal((init!.headers as Record<string, string>).Authorization, "Bearer new-id-token");
    return Response.json(committed());
  }), { saveRefreshToken: async (_, token) => { saved.push(token); } });
  await transport(BIND, AUTOMATIC);
  await transport(UPLOAD, AUTOMATIC);
  assert.equal(urls.length, 3);
  assert.ok(urls.every((url) => !url.includes("identitytoolkit")));
  assert.deepEqual(saved, ["new-refresh-token", "new-refresh-token"]);
});

test("revoked invalid expired and disabled anonymous refreshes never recreate an identity", async () => {
  for (const message of ["INVALID_REFRESH_TOKEN", "TOKEN_EXPIRED", "USER_DISABLED", "USER_NOT_FOUND", "PROJECT_NUMBER_MISMATCH"]) {
    const urls: string[] = [];
    const transport = createSyncTransport(fetcher(async (input) => {
      urls.push(String(input));
      return Response.json({ error: { message } }, { status: 400 });
    }));
    await assert.rejects(transport(BIND, AUTOMATIC), (error: unknown) => error instanceof SyncError && error.kind === "auth" && !error.retryable);
    assert.equal(urls.length, 1);
    assert.ok(urls[0].includes("securetoken"));
  }
  for (const value of [refreshed({ user_id: "different_uid" }), refreshed({ refresh_token: "" }), refreshed({ token_type: "wrong" })]) {
    let calls = 0;
    const transport = createSyncTransport(fetcher(async () => { calls++; return Response.json(value); }));
    await assert.rejects(transport(BIND, AUTOMATIC), (error: unknown) => error instanceof SyncError && error.kind === "invalid");
    assert.equal(calls, 1);
  }
});

test("required App Check fails closed before authentication and every commit has the current token", async () => {
  let calls = 0;
  const implementation = fetcher(async (input, init) => {
    calls++;
    if (String(input).includes("securetoken")) return Response.json(refreshed());
    assert.equal((init!.headers as Record<string, string>)["X-Firebase-AppCheck"], `attestation-${calls - 1}`);
    return Response.json(committed());
  });
  await assert.rejects(createSyncTransport(implementation, { requireAppCheck: true })(BIND, AUTOMATIC), (error: unknown) =>
    error instanceof SyncError && error.kind === "attestation");
  assert.equal(calls, 0);
  let checks = 0;
  const transport = createSyncTransport(implementation, { requireAppCheck: true, getAppCheckToken: async (force) => {
    assert.equal(force, false); return `attestation-${++checks}`;
  } });
  await transport(BIND, AUTOMATIC);
  await transport(UPLOAD, AUTOMATIC);
  assert.equal(calls, 3);
  assert.equal(checks, 2);
});

test("missing invalid and failed attestation tokens never reach Firestore or leak provider errors", async () => {
  for (const getAppCheckToken of [
    async () => "", async () => "invalid\nheader", async () => { throw new Error("private-attestation-secret"); },
  ]) {
    let calls = 0;
    const transport = createSyncTransport(fetcher(async () => { calls++; return Response.json(refreshed()); }), {
      requireAppCheck: true, getAppCheckToken,
    });
    await assert.rejects(transport(UPLOAD, AUTOMATIC), (error: unknown) => error instanceof SyncError &&
      error.kind === "attestation" && error.retryable && !error.message.includes("private-attestation-secret"));
    assert.equal(calls, 0);
  }
});

test("App Check rejection forces one separately budgeted refresh and does not reauthenticate or re-create", async () => {
  const forced: (boolean | undefined)[] = [];
  let auths = 0;
  let commits = 0;
  const transport = createSyncTransport(fetcher(async (input) => {
    if (String(input).includes("securetoken")) { auths++; return Response.json(refreshed()); }
    commits++;
    return Response.json({ error: { message: "App Check token is invalid." } }, { status: 403 });
  }), { requireAppCheck: true, getAppCheckToken: async (force) => { forced.push(force); return "app-check-token"; } });
  await assert.rejects(transport(UPLOAD, AUTOMATIC), (error: unknown) => error instanceof SyncError && error.kind === "attestation" && error.retryable);
  assert.equal(commits, 1);
  await assert.rejects(transport(UPLOAD, AUTOMATIC), (error: unknown) => error instanceof SyncError && error.kind === "attestation" && !error.retryable);
  assert.equal(commits, 2);
  assert.equal(auths, 1);
  assert.deepEqual(forced, [false, true]);
});

test("forced attestation refresh failure stops the next commit and backgrounding stops authentication", async () => {
  let commits = 0;
  let active = true;
  const transport = createSyncTransport(fetcher(async (input) => {
    if (String(input).includes("securetoken")) return Response.json(refreshed());
    commits++;
    return Response.json({ error: { message: "AppCheck token rejected" } }, { status: 403 });
  }), { getAppCheckToken: async (force) => { if (force) throw new Error("private-token"); return "first-token"; } });
  await assert.rejects(transport(UPLOAD, AUTOMATIC));
  await assert.rejects(transport(UPLOAD, AUTOMATIC), /could not be refreshed/);
  assert.equal(commits, 1);
  let calls = 0;
  const background = createSyncTransport(fetcher(async () => { calls++; return Response.json(refreshed()); }), {
    requireAppCheck: true, getAppCheckToken: async () => { active = false; return "token"; },
  });
  await assert.rejects(background(UPLOAD, AUTOMATIC, () => active), /paused while/);
  assert.equal(calls, 0);
});

test("automatic browser preview is network-free and isolates different anonymous UIDs", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("No preview network"); };
  try {
    const transport = createPreviewTransport();
    await transport(BIND, AUTOMATIC);
    await transport(UPLOAD, AUTOMATIC);
    const other = { ...AUTOMATIC, uid: "another_uid" };
    await transport({ action: "bind", installationId: OTHER_INSTALLATION }, other);
    await transport({ ...UPLOAD, installationId: OTHER_INSTALLATION }, other);
    await assert.rejects(transport({ action: "bind", installationId: OTHER_INSTALLATION }, AUTOMATIC), /already bound/);
    await assert.rejects(transport(BIND, { ...AUTOMATIC, generationId: OTHER_INSTALLATION }), /already bound/);
    await assert.rejects(transport(UPLOAD, { ...AUTOMATIC, generationId: OTHER_INSTALLATION }), /Connect/);
    await transport(BIND, LEGACY);
    await assert.rejects(createAnonymousCredentials(CONFIG, IDENTITY, {
      fetchImplementation: fetcher(async () => { throw new Error("network-secret"); }),
    }), (error: unknown) => error instanceof SyncError && !error.message.includes("network-secret"));
    Object.defineProperty(globalThis, "document", { value: {}, configurable: true });
    try { await assert.rejects(createAnonymousCredentials(CONFIG, IDENTITY), /Browser preview/); }
    finally { Reflect.deleteProperty(globalThis, "document"); }
  } finally { globalThis.fetch = originalFetch; }
});

test("browser vault preserves anonymous refresh rotation across saves and rejects stale identities", async () => {
  await browserVault.removeCredentials();
  await browserVault.saveCredentials(AUTOMATIC);
  assert.equal(await browserVault.loadRefreshToken(AUTOMATIC), AUTOMATIC.refreshToken);
  await browserVault.saveRefreshToken(AUTOMATIC, "rotated-secret");
  await browserVault.saveCredentials(AUTOMATIC);
  assert.equal(await browserVault.loadRefreshToken(AUTOMATIC), "rotated-secret");
  assert.deepEqual(await browserVault.loadCredentials(), { ...AUTOMATIC, refreshToken: "rotated-secret" });
  const other = { ...AUTOMATIC, uid: "another_uid", refreshToken: "other-secret" };
  await browserVault.saveCredentials(other);
  await browserVault.saveRefreshToken(AUTOMATIC, "late-secret");
  assert.equal(await browserVault.loadRefreshToken(other), "other-secret");
  await browserVault.removeCredentials();
});

test("native vault keeps anonymous rotation securely and never overwrites a transient read failure", async () => {
  const [{ readFileSync }, { resolve }, typescript, protocol] = await Promise.all([
    import("node:fs"), import("node:path"), import("typescript"), import("../src/sync/protocol"),
  ]);
  const key = "workout.firebase.credentials.v1";
  const stored = new Map<string, string>();
  let failRead = false;
  let writes = 0;
  const secureStore = {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 7,
    getItemAsync: async (name: string) => {
      if (failRead) throw new Error("private-keychain-error");
      return stored.get(name) ?? null;
    },
    setItemAsync: async (name: string, value: string, options: { keychainAccessible: number }) => {
      assert.equal(options.keychainAccessible, 7); writes++; stored.set(name, value);
    },
    deleteItemAsync: async (name: string) => { stored.delete(name); },
  };
  const compiler = typescript.default;
  const compiled = compiler.transpileModule(readFileSync(resolve("src/sync/credentials.ts"), "utf8"), {
    compilerOptions: { module: compiler.ModuleKind.CommonJS, target: compiler.ScriptTarget.ES2022 },
  }).outputText;
  const exported: Record<string, unknown> = {};
  new Function("exports", "require", compiled)(exported, (name: string) => {
    if (name === "expo-secure-store") return secureStore;
    if (name === "./protocol") return protocol;
    throw new Error("Unexpected dependency");
  });
  const vault = exported as typeof import("../src/sync/credentials");
  await vault.saveCredentials(AUTOMATIC);
  await vault.saveRefreshToken(AUTOMATIC, "rotated-secret");
  await vault.saveCredentials(AUTOMATIC);
  assert.equal(await vault.loadRefreshToken(AUTOMATIC), "rotated-secret");
  assert.deepEqual(await vault.loadCredentials(), { ...AUTOMATIC, refreshToken: "rotated-secret" });
  const previous = stored.get(key);
  const previousWrites = writes;
  failRead = true;
  await assert.rejects(vault.saveCredentials({ ...AUTOMATIC, uid: "new_uid" }), /could not be saved securely/);
  await assert.rejects(vault.loadCredentials(), (error: unknown) => error instanceof Error && !error.message.includes("private-keychain-error"));
  assert.equal(stored.get(key), previous);
  assert.equal(writes, previousWrites);
  failRead = false;
  stored.set(key, JSON.stringify({ credentials: AUTOMATIC, refreshToken: null }));
  assert.equal(await vault.loadRefreshToken(AUTOMATIC), AUTOMATIC.refreshToken);
  await vault.removeCredentials();
  await vault.saveRefreshToken(AUTOMATIC, "late-secret");
  assert.equal(await vault.loadCredentials(), null);
});

test("stalled App Check times out before Auth or Firestore and a late token cannot send", async () => {
  let timeout!: () => void;
  let release!: (value: string) => void;
  let calls = 0;
  let cancelled = false;
  const transport = createSyncTransport(fetcher(async () => { calls++; return Response.json(refreshed()); }), {
    requireAppCheck: true,
    getAppCheckToken: () => new Promise<string>((resolve) => { release = resolve; }),
    setTimeout: (callback) => { timeout = callback; return 1; }, clearTimeout: () => { cancelled = true; },
  });
  const pending = transport(UPLOAD, AUTOMATIC);
  await settle();
  timeout();
  await assert.rejects(pending, (error: unknown) => error instanceof SyncError && error.kind === "attestation" && error.retryable);
  release("late-token");
  await settle();
  assert.equal(calls, 0);
  assert.equal(cancelled, true);
});

test("only automatic binding Firestore permission denials retry enrollment while invalid refresh stays terminal", async () => {
  const permission = { error: { code: 403, message: "Missing or insufficient permissions.", status: "PERMISSION_DENIED" } };
  for (const [credentials, request, expectedKind, retryable] of [
    [AUTOMATIC, BIND, "enrollment", true],
    [AUTOMATIC, UPLOAD, "auth", false],
    [LEGACY, BIND, "auth", false],
  ] as const) {
    const urls: string[] = [];
    const transport = createSyncTransport(fetcher(async (input) => {
      const url = String(input); urls.push(url);
      if (url.includes("securetoken")) return Response.json(refreshed());
      if (url.includes("signInWithPassword")) return Response.json(signup({ localId: LEGACY.uid }));
      return Response.json(permission, { status: 403 });
    }));
    await assert.rejects(transport(request, credentials), (error: unknown) =>
      error instanceof SyncError && error.kind === expectedKind && error.retryable === retryable);
    assert.equal(urls.length, 2);
    assert.ok(urls[1].includes("firestore.googleapis.com"));
  }
  let refreshes = 0;
  const revoked = createSyncTransport(fetcher(async (input) => {
    assert.ok(String(input).includes("securetoken")); refreshes++;
    return Response.json({ error: { message: "INVALID_REFRESH_TOKEN" } }, { status: 400 });
  }));
  await assert.rejects(revoked(BIND, AUTOMATIC), (error: unknown) =>
    error instanceof SyncError && error.kind === "auth" && !error.retryable);
  assert.equal(refreshes, 1);
});

test("automatic binding App Check and malformed 403 responses cannot become enrollment retries", async () => {
  for (const error of [
    { status: "PERMISSION_DENIED", message: "Firebase App Check token is invalid." },
    { status: "PERMISSION_DENIED", message: "Permission denied", details: [{ reason: "APP_CHECK_TOKEN_INVALID" }] },
  ]) {
    const flags: (boolean | undefined)[] = [];
    const transport = createSyncTransport(fetcher(async (input) => String(input).includes("securetoken")
      ? Response.json(refreshed()) : Response.json({ error }, { status: 403 })), {
      requireAppCheck: true, getAppCheckToken: async (force) => { flags.push(force); return "attestation-token"; },
    });
    await assert.rejects(transport(BIND, AUTOMATIC), (value: unknown) =>
      value instanceof SyncError && value.kind === "attestation" && value.retryable);
    await assert.rejects(transport(BIND, AUTOMATIC), (value: unknown) =>
      value instanceof SyncError && value.kind === "attestation" && !value.retryable);
    assert.deepEqual(flags, [false, true]);
  }
  const malformed = createSyncTransport(fetcher(async (input) => String(input).includes("securetoken")
    ? Response.json(refreshed()) : new Response("unverified body", { status: 403 })));
  await assert.rejects(malformed(BIND, AUTOMATIC), (error: unknown) =>
    error instanceof SyncError && error.kind === "auth" && !error.retryable);
});

test("only sanitized attestation diagnostics survive upload transport", async () => {
  const { attestationDiagnostic } = await import("../src/sync/attestationDiagnostic");
  for (const safe of [true, false]) {
    const message = safe ? attestationDiagnostic({ code: "appCheck/provider-not-ready" }, "token") : "private-token";
    let calls = 0;
    const transport = createSyncTransport(fetcher(async () => { calls++; throw new Error(); }), {
      requireAppCheck: true, getAppCheckToken: async () => { throw new SyncError(message, true, "attestation"); },
    });
    await assert.rejects(transport(BIND, AUTOMATIC), (e: unknown) => e instanceof SyncError &&
      e.kind === "attestation" && !e.message.includes("private-token") && (!safe || e.message.includes("AT-PROVIDER")));
    assert.equal(calls, 0);
  }
});
