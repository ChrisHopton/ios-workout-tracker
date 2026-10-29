import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { attestationDiagnostic, isAttestationDiagnostic } from "../src/sync/attestationDiagnostic";
import { uploadProblem } from "../src/components/settingsPresentation";
import { SyncError } from "../src/sync/transport";

test("attestation diagnostics only expose fixed allowlisted text", () => {
  for (const [error, tag] of [
    [{ code: "appCheck/provider-not-ready" }, "AT-PROVIDER"],
    [{ code: "app/no-app" }, "AT-APP"],
    [{ code: "appCheck/token-null" }, "AT-EMPTY"],
    [{ code: "appCheck/token-error", message: "HTTP status code: 403 private-token" }, "AT-REJECTED"],
    [{ message: "HTTP status code: 429 private-token" }, "AT-LIMIT"],
    [{ message: "NSURLErrorDomain private-token" }, "AT-NETWORK"],
    [{ message: "NativeRNFBTurboAppCheck could not be found private-token" }, "AT-MODULE"],
    [{ message: "unknown private-token", code: "private-token" }, "AT-TOKEN"],
  ] as const) {
    const message = attestationDiagnostic(error, "token");
    assert.ok(message.includes(tag)); assert.ok(isAttestationDiagnostic(message));
    assert.ok(!message.includes("private-token"));
    assert.equal(uploadProblem({ error: message, errorKind: "attestation", retryable: true }), message);
    assert.ok(!isAttestationDiagnostic(message + " private-token"));
  }
  assert.match(attestationDiagnostic({}, "configuration"), /AT-CONFIG/);
  assert.ok(!uploadProblem({ error: "AT-TOKEN private-token", errorKind: "attestation", retryable: true })!.includes("private-token"));
});

function nativeHarness(tokenResult: () => Promise<{ token: string }>, configurationError?: unknown) {
  let timer: (() => void) | undefined;
  let signups = 0, configurations = 0, cancelled = 0, tokenCalls = 0;
  const instance = { app: {} };
  const output: Record<string, unknown> = {};
  const compiled = ts.transpileModule(readFileSync("src/sync/runtime.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function("exports", "require", "setTimeout", "clearTimeout", compiled)(
    output, (name: string) => {
      if (name === "@react-native-firebase/app") return { getApp: () => ({}) };
      if (name === "@react-native-firebase/app-check") return {
        initializeAppCheck: (_app: unknown, options: unknown) => {
          configurations++;
          assert.deepEqual(options, { provider: { providerOptions: { apple: { provider: "appAttest" } } }, isTokenAutoRefreshEnabled: true });
          if (configurationError) throw configurationError;
          return instance;
        },
        getToken: (app: unknown, refresh: boolean) => {
          assert.equal(app, instance); assert.equal(refresh, false); tokenCalls++; return tokenResult();
        },
      };
      if (name === "expo-device") return { modelName: "Test iPhone" };
      if (name === "./firebaseConfig") return { FIREBASE_CONFIG: { projectId: "test", apiKey: "public" } };
      if (name === "./attestationDiagnostic") return { attestationDiagnostic };
      if (name === "./credentials") return {};
      if (name === "./transport") return {
        SyncError, createSyncTransport: () => async () => {},
        createAnonymousCredentials: async () => { signups++; return {}; },
      };
      throw new Error("Unexpected test dependency");
    },
    (callback: () => void, ms: number) => { assert.equal(ms, 20000); timer = callback; return 1; },
    () => { cancelled++; },
  );
  const runtime = (output as typeof import("../src/sync/runtime")).createUploadRuntime();
  return { run: () => runtime.signup({ deviceId: "test", generationId: "test" }, () => true),
    timeout: () => timer!(), counts: () => ({ signups, configurations, cancelled, tokenCalls }) };
}
test("native verification success gates signup and retains the configured production provider", async () => {
  const h = nativeHarness(async () => ({ token: "private-token" }));
  await h.run(); await h.run();
  assert.deepEqual(h.counts(), { signups: 2, configurations: 1, cancelled: 2, tokenCalls: 2 });
});
test("native configuration and token failures reach Settings without native messages or signup", async () => {
  for (const config of [true, false]) {
    const h = nativeHarness(async () => { throw { code: "appCheck/token-error", message: "private-token" }; },
      config ? new Error("private-token") : undefined);
    await assert.rejects(h.run(), (e: unknown) => e instanceof SyncError && e.kind === "attestation" &&
      e.retryable && e.message.includes(config ? "AT-CONFIG" : "AT-TOKEN") && !e.message.includes("private-token"));
    assert.equal(h.counts().signups, 0);
  }
});
test("native verification timeout never sends signup after a late token", async () => {
  let finish!: (value: { token: string }) => void;
  const h = nativeHarness(() => new Promise((resolve) => { finish = resolve; }));
  const attempt = h.run(); h.timeout();
  await assert.rejects(attempt, /AT-TIMEOUT/);
  finish({ token: "late-private-token" });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(h.counts().signups, 0); assert.equal(h.counts().cancelled, 1);
});
test("empty native verification token cannot reach authentication", async () => {
  const h = nativeHarness(async () => ({ token: "" }));
  await assert.rejects(h.run(), /AT-EMPTY/);
  assert.equal(h.counts().signups, 0);
});
