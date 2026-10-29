import test from "node:test";
import assert from "node:assert/strict";
import {
  automaticPhoneLabel, createAutomaticBootstrap, validateBootstrap,
  type BootstrapDraft, type BootstrapOptions,
} from "../src/sync/bootstrap";
import type { SyncLocalState, SyncRepository, SyncSecrets } from "../src/sync/controller";
import {
  identityOf, validateCredentials, type AnonymousSyncCredentials,
  type LegacySyncCredentials, type SyncCredentials, type SyncIdentity,
} from "../src/sync/protocol";

const PROJECT = "workout-test";
const API_KEY = "a".repeat(39);
const online = () => true;
const offline = () => false;
const uuid = (value: number) => "00000000-0000-4000-8000-" + String(value).padStart(12, "0");
const LEGACY: LegacySyncCredentials = {
  version: 1, projectId: PROJECT, apiKey: API_KEY,
  deviceId: uuid(801), generationId: uuid(802), uid: "legacy_phone",
  email: "legacy@example.com", password: "legacy-private-password",
};

function anonymous(identity: { deviceId: string; generationId: string }): AnonymousSyncCredentials {
  return {
    version: 3, layout: "automatic", projectId: PROJECT, apiKey: API_KEY,
    ...identity, uid: "anonymous_phone", refreshToken: "private-refresh-token",
  };
}
function local(identity: SyncIdentity, overrides: Partial<SyncLocalState> = {}): SyncLocalState {
  return {
    ...identity, installationId: uuid(803), label: "Existing phone", clock: 19,
    lastSyncedAt: "2026-10-19T12:00:00.000Z", enabled: true, bound: true,
    initialComplete: true, ...overrides,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

class Repository implements SyncRepository {
  active: SyncLocalState | null = null;
  staged: SyncLocalState | null = null;
  draft: BootstrapDraft | null = null;
  stateError: Error | null = null;
  stagedError: Error | null = null;
  draftError: Error | null = null;
  enrollmentError: Error | null = null;
  draftAttempts = 0;
  enrollmentAttempts = 0;

  constructor(readonly events: string[]) {}
  async state() {
    if (this.stateError) throw this.stateError;
    return structuredClone(this.active);
  }
  async pendingEnrollment() {
    if (this.stagedError) throw this.stagedError;
    return structuredClone(this.staged);
  }
  async prepareBootstrap(candidate: BootstrapDraft) {
    this.draftAttempts++;
    if (this.draftError) throw this.draftError;
    // Model durable draft reuse and validation supplied by the storage contract.
    if (!this.draft) {
      this.draft = structuredClone(validateBootstrap(candidate));
      this.events.push("draft persisted");
    }
    return structuredClone(validateBootstrap(this.draft));
  }
  async prepareEnrollment(identity: SyncIdentity, label: string, installationId: string) {
    this.enrollmentAttempts++;
    if (this.enrollmentError) throw this.enrollmentError;
    this.staged = local(identity, {
      label, installationId, clock: 0, lastSyncedAt: null,
      enabled: false, bound: false, initialComplete: false,
    });
    this.events.push("enrollment staged");
    return structuredClone(this.staged);
  }
  async activateEnrollment(): Promise<void> { throw new Error("Bootstrap must not activate uploads"); }
  async disconnect(): Promise<void> { throw new Error("Bootstrap must not disconnect"); }
  async setLabel(): Promise<void> { throw new Error("Bootstrap must not relabel an existing phone"); }
  async pendingCount(): Promise<number> { throw new Error("Bootstrap must not inspect upload batches"); }
  async inFlight(): Promise<null> { throw new Error("Bootstrap must not reserve upload batches"); }
  async reserveAttempt(): Promise<{ allowed: boolean; retryAt: null }> { throw new Error("Bootstrap must not upload"); }
  async acknowledge(): Promise<void> { throw new Error("Bootstrap must not acknowledge uploads"); }
}
class Secrets implements SyncSecrets {
  saved: SyncCredentials | null = null;
  loadError: Error | null = null;
  failuresRemaining = 0;
  saveAttempts = 0;

  constructor(readonly events: string[]) {}
  async load() {
    if (this.loadError) throw this.loadError;
    return this.saved ? structuredClone(validateCredentials(this.saved)) : null;
  }
  async save(value: SyncCredentials) {
    this.saveAttempts++;
    if (this.failuresRemaining-- > 0) throw new Error("Keychain is locked");
    this.saved = structuredClone(validateCredentials(value));
    this.events.push("credentials persisted");
  }
  async remove(): Promise<void> { throw new Error("Bootstrap must not erase credentials"); }
}
function fixture() {
  const events: string[] = [];
  const repository = new Repository(events);
  const secrets = new Secrets(events);
  const signupCalls: { deviceId: string; generationId: string }[] = [];
  const behavior: { signup: BootstrapOptions["signup"] } = {
    signup: async (identity) => anonymous({
      deviceId: identity.deviceId, generationId: identity.generationId,
    }),
  };
  let nextId = 0;
  const options: BootstrapOptions = {
    projectId: PROJECT, apiKey: API_KEY, modelName: "iPhone 17 Pro",
    createId: () => uuid(++nextId),
    signup: async (identity, canSend) => {
      events.push("signup");
      signupCalls.push({ deviceId: identity.deviceId, generationId: identity.generationId });
      return behavior.signup(identity, canSend);
    },
  };
  return {
    events, repository, secrets, signupCalls, behavior, options,
    bootstrap: createAutomaticBootstrap(repository, secrets, options),
  };
}

test("draft persistence precedes signup and secure credentials precede enrollment", async () => {
  const app = fixture();
  const canSend = () => true;
  app.behavior.signup = async (identity, guard) => {
    assert.equal(guard, canSend);
    assert.ok(app.repository.draft);
    assert.equal(identity.deviceId, app.repository.draft.deviceId);
    assert.equal(identity.generationId, app.repository.draft.generationId);
    assert.equal(app.secrets.saved, null);
    assert.equal(app.repository.staged, null);
    return anonymous({ deviceId: identity.deviceId, generationId: identity.generationId });
  };

  assert.equal(await app.bootstrap(canSend), true);
  assert.deepEqual(app.events, ["draft persisted", "signup", "credentials persisted", "enrollment staged"]);
  assert.deepEqual(app.repository.staged, local(identityOf(app.secrets.saved!), {
    installationId: app.repository.draft!.installationId,
    label: app.repository.draft!.label, clock: 0, lastSyncedAt: null,
    enabled: false, bound: false, initialComplete: false,
  }));
});

test("offline startup persists one draft and later retries reuse it across restarts", async () => {
  const app = fixture();
  assert.equal(await app.bootstrap(offline), false);
  const draft = structuredClone(app.repository.draft);
  assert.ok(draft);
  assert.equal(app.signupCalls.length, 0);
  assert.equal(app.secrets.saveAttempts, 0);
  assert.equal(app.repository.enrollmentAttempts, 0);

  assert.equal(await app.bootstrap(offline), false);
  const restarted = createAutomaticBootstrap(app.repository, app.secrets, app.options);
  assert.equal(await restarted(online), true);
  assert.deepEqual(app.repository.draft, draft);
  assert.deepEqual(app.signupCalls, [{ deviceId: draft.deviceId, generationId: draft.generationId }]);
  assert.equal(app.repository.staged!.installationId, draft.installationId);
});

test("a failed signup keeps the draft identity for the next network attempt", async () => {
  const app = fixture();
  app.behavior.signup = async () => { throw new Error("Offline"); };
  await assert.rejects(app.bootstrap(online), /Offline/);
  const draft = structuredClone(app.repository.draft);
  assert.ok(draft);
  assert.equal(app.secrets.saveAttempts, 0);
  assert.equal(app.repository.staged, null);

  app.behavior.signup = async ({ deviceId, generationId }) => anonymous({ deviceId, generationId });
  assert.equal(await app.bootstrap(online), true);
  assert.equal(app.signupCalls.length, 2);
  assert.deepEqual(app.signupCalls[0], app.signupCalls[1]);
  assert.deepEqual(app.repository.draft, draft);
});

test("failed secure storage retries reuse the authenticated result in memory without signup", async () => {
  const app = fixture();
  app.secrets.failuresRemaining = 2;
  await assert.rejects(app.bootstrap(online), /Keychain is locked/);
  const draft = structuredClone(app.repository.draft);
  await assert.rejects(app.bootstrap(offline), /Keychain is locked/);
  assert.equal(app.signupCalls.length, 1);
  assert.equal(app.repository.enrollmentAttempts, 0);
  assert.equal(app.secrets.saved, null);

  assert.equal(await app.bootstrap(offline), true);
  assert.equal(app.signupCalls.length, 1);
  assert.equal(app.secrets.saveAttempts, 3);
  assert.deepEqual(app.repository.draft, draft);
  assert.equal(app.secrets.saved!.uid, "anonymous_phone");
});

test("a restart resumes saved v3 credentials when enrollment had not yet persisted", async () => {
  const app = fixture();
  app.repository.enrollmentError = new Error("SQLite write interrupted");
  await assert.rejects(app.bootstrap(online), /SQLite write interrupted/);
  const saved = structuredClone(app.secrets.saved);
  const draft = structuredClone(app.repository.draft);
  assert.equal(saved!.version, 3);
  assert.equal(app.repository.staged, null);

  app.repository.enrollmentError = null;
  const restarted = createAutomaticBootstrap(app.repository, app.secrets, app.options);
  assert.equal(await restarted(offline), true);
  assert.equal(app.signupCalls.length, 1);
  assert.deepEqual(app.secrets.saved, saved);
  assert.deepEqual(app.repository.draft, draft);
  assert.deepEqual(identityOf(app.secrets.saved!), identityOf(saved!));

  const resumedStaging = createAutomaticBootstrap(app.repository, app.secrets, app.options);
  assert.equal(await resumedStaging(offline), true);
  assert.equal(app.signupCalls.length, 1);
  assert.equal(app.secrets.saveAttempts, 2);
});

test("legacy identities without an explicit reset intent cannot bypass fresh start", async (t) => {
  for (const location of ["active", "staged"] as const) {
    await t.test(location, async () => {
      const app = fixture();
      app.secrets.saved = structuredClone(LEGACY);
      app.repository[location] = local(identityOf(LEGACY), location === "staged"
        ? { enabled: false, bound: false, initialComplete: false } : {});
      const before = structuredClone(app.repository[location]);

      await assert.rejects(app.bootstrap(offline), /saved upload identity needs attention/);
      assert.deepEqual(app.repository[location], before);
      assert.deepEqual(app.secrets.saved, LEGACY);
      assert.equal(app.repository.draftAttempts, 0);
      assert.equal(app.repository.enrollmentAttempts, 0);
      assert.equal(app.secrets.saveAttempts, 0);
      assert.equal(app.signupCalls.length, 0);
    });
  }
});

test("missing credentials or a mismatched existing identity never creates a replacement", async (t) => {
  for (const location of ["active", "staged"] as const) {
    for (const missing of [true, false]) {
      await t.test(location + ", " + (missing ? "missing" : "mismatched") + " credentials", async () => {
        const app = fixture();
        app.repository[location] = local(identityOf(LEGACY));
        app.secrets.saved = missing ? null : { ...LEGACY, generationId: uuid(999) };
        const before = structuredClone(app.repository[location]);

        await assert.rejects(app.bootstrap(online), /saved upload identity needs attention/);
        assert.equal(app.signupCalls.length, 0);
        assert.equal(app.repository.draftAttempts, 0);
        assert.equal(app.secrets.saveAttempts, 0);
        assert.deepEqual(app.repository[location], before);
      });
    }
  }
});

test("malformed saved identities, drafts, and credentials do not create replacement accounts", async (t) => {
  const corruptions: [string, (app: ReturnType<typeof fixture>) => void][] = [
    ["active identity", (app) => {
      app.repository.active = local({ ...identityOf(LEGACY), deviceId: "not-a-uuid" });
      app.secrets.saved = { ...LEGACY };
    }],
    ["staged identity", (app) => {
      app.repository.staged = local({ ...identityOf(LEGACY), generationId: "not-a-uuid" });
      app.secrets.saved = { ...LEGACY };
    }],
    ["persisted draft", (app) => {
      app.repository.draft = {
        version: 1, projectId: PROJECT, deviceId: uuid(1), generationId: uuid(2),
        installationId: "invalid", label: "Existing phone",
      };
    }],
    ["saved credentials", (app) => {
      app.secrets.saved = { ...LEGACY, deviceId: "invalid" };
    }],
  ];
  for (const [name, corrupt] of corruptions) {
    await t.test(name, async () => {
      const app = fixture();
      corrupt(app);
      await assert.rejects(app.bootstrap(online));
      assert.equal(app.signupCalls.length, 0);
      assert.equal(app.secrets.saveAttempts, 0);
      assert.equal(app.repository.enrollmentAttempts, 0);
    });
  }
});

test("read failures and a storage refusal for orphaned history stop before signup", async (t) => {
  for (const source of ["state", "staged", "secrets", "orphaned history"] as const) {
    await t.test(source, async () => {
      const app = fixture();
      const error = new Error("Cannot read " + source);
      if (source === "state") app.repository.stateError = error;
      if (source === "staged") app.repository.stagedError = error;
      if (source === "secrets") app.secrets.loadError = error;
      if (source === "orphaned history") app.repository.draftError = error;

      await assert.rejects(app.bootstrap(online), (failure) => failure === error);
      assert.equal(app.signupCalls.length, 0);
      assert.equal(app.secrets.saveAttempts, 0);
      assert.equal(app.repository.enrollmentAttempts, 0);
      assert.equal(app.repository.draft, null);
    });
  }
});

test("a fresh local repository can replace stale Keychain credentials from an uninstall", async (t) => {
  const staleAnonymous = { ...anonymous({ deviceId: uuid(901), generationId: uuid(902) }), uid: "stale_anonymous_phone" };
  for (const saved of [LEGACY, staleAnonymous]) {
    await t.test("stale version " + saved.version, async () => {
      const app = fixture();
      app.secrets.saved = { ...saved };
      assert.equal(await app.bootstrap(online), true);
      assert.equal(app.signupCalls.length, 1);
      assert.equal(app.secrets.saved!.version, 3);
      assert.notEqual(app.secrets.saved!.uid, saved.uid);
      assert.notEqual(app.secrets.saved!.deviceId, saved.deviceId);
      assert.notEqual(app.secrets.saved!.generationId, saved.generationId);
      assert.equal(app.repository.staged!.deviceId, app.repository.draft!.deviceId);
    });
  }
});

test("concurrent bootstrap callers share one signup and one enrollment", async () => {
  const app = fixture();
  const started = deferred<void>();
  const completed = deferred<AnonymousSyncCredentials>();
  app.behavior.signup = async () => {
    started.resolve();
    return completed.promise;
  };
  const first = app.bootstrap(online);
  const second = app.bootstrap(online);
  assert.equal(first, second);
  await started.promise;
  const third = app.bootstrap(online);
  assert.equal(third, first);
  assert.equal(app.signupCalls.length, 1);
  assert.equal(app.repository.enrollmentAttempts, 0);

  completed.resolve(anonymous(app.signupCalls[0]));
  assert.deepEqual(await Promise.all([first, second, third]), [true, true, true]);
  assert.equal(app.signupCalls.length, 1);
  assert.equal(app.secrets.saveAttempts, 1);
  assert.equal(app.repository.enrollmentAttempts, 1);
});

test("automatic phone labels trim model names, fall back, and retain the installation suffix", () => {
  const installationId = "12345678-1234-4234-8234-123456abcdef";
  assert.equal(automaticPhoneLabel("  iPhone 17 Pro Max  ", installationId), "iPhone 17 Pro Max · ABCDEF");
  assert.equal(automaticPhoneLabel(null, installationId), "iPhone · ABCDEF");
  assert.equal(automaticPhoneLabel(" \t ", installationId), "iPhone · ABCDEF");
  const long = automaticPhoneLabel("A".repeat(100), installationId);
  assert.ok(long.length <= 80);
  assert.equal(long, "A".repeat(68) + " · ABCDEF");
});
