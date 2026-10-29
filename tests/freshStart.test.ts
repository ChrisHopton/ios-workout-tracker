import test from "node:test";
import assert from "node:assert/strict";
import { createJournalStorage } from "../src/data/journalStorage";
import { initialData } from "../src/domain/library";
import { createAutomaticBootstrap } from "../src/sync/bootstrap";
import type { SyncSecrets } from "../src/sync/controller";
import { FRESH_START_EPOCH, resetCredentials } from "../src/sync/reset";
import { identityOf, type SyncCredentials, type PreviousAnonymousSyncCredentials } from "../src/sync/protocol";
import { createSyncTransport, SyncError } from "../src/sync/transport";
import { historyFixture, sqliteHarness } from "./storageFixture";

const uuid = (n: number) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
const OLD: PreviousAnonymousSyncCredentials = { version: 2, layout: "automatic", projectId: "workout-test", apiKey: "a".repeat(39),
  deviceId: uuid(1), generationId: uuid(2), uid: "existing_phone", refreshToken: "old-token" };
const now = Date.parse("2026-10-28T12:00:00Z");
function options() { let id = 100; return { createId: () => uuid(++id) }; }
async function oldPhone(bootstrapOnly = false, legacy = false) {
  const sql = sqliteHarness();
  const credentials: SyncCredentials = legacy ? { version: 1, projectId: OLD.projectId, apiKey: OLD.apiKey,
    deviceId: OLD.deviceId, generationId: OLD.generationId, uid: "legacy", email: "test@example.com", password: "legacy-secret" } : OLD;
  const old = createJournalStorage(sql.db); await old.load();
  const data = historyFixture(2); data.settings.firstName = "Old profile"; await old.write(data);
  if (bootstrapOnly) await old.sync.prepareBootstrap({ version: 1, projectId: OLD.projectId, deviceId: OLD.deviceId,
    generationId: OLD.generationId, installationId: uuid(3), label: "Old draft" });
  else {
    const staged = await old.sync.prepareEnrollment(identityOf(credentials), "Old phone", uuid(3));
    await old.sync.activateEnrollment(staged);
    await old.sync.inFlight(); await old.sync.reserveAttempt(10, now);
  }
  sql.native.exec("DELETE FROM app_lifecycle; PRAGMA user_version = 5;");
  return { sql, data, credentials };
}
function vault(initial: SyncCredentials | null = OLD) {
  let saved = initial ? { ...initial } : null;
  let crash = false, locked = false, failSave = false;
  const secrets: SyncSecrets = {
    load: async () => { if (locked) throw new Error("keychain locked"); return saved; },
    save: async value => { if (failSave) throw new Error("keychain write"); saved = { ...value }; },
    remove: async () => { saved = null; },
    migrateReset: async intent => {
      if (locked) throw new Error("keychain locked");
      const next = resetCredentials(saved, "latest-token", intent);
      if (next) saved = next;
      if (crash) { crash = false; throw new Error("crash after keychain"); }
      return next;
    },
  };
  return { secrets, saved: () => saved, crash: () => { crash = true; },
    lock: () => { locked = true; }, failSave: (value: boolean) => { failSave = value; } };
}
function bootstrap(store: ReturnType<typeof createJournalStorage>, storage: ReturnType<typeof vault>) {
  let signups = 0;
  const run = createAutomaticBootstrap(store.sync, storage.secrets, {
    ...options(), projectId: OLD.projectId, apiKey: OLD.apiKey, modelName: "iPhone",
    signup: async identity => { signups++; return { ...OLD, version: 3, ...identity, uid: "new_anonymous" }; },
  });
  return { run, signups: () => signups };
}

test("atomic reset clears personal journal and queues, keeps quota and permanent marker", async () => {
  const { sql } = await oldPhone();
  try {
    const store = createJournalStorage(sql.db, options()); assert.deepEqual(await store.load(), initialData());
    const intent = (await store.sync.pendingReset())!; assert.equal(intent.epoch, FRESH_START_EPOCH);
    assert.deepEqual(intent.sources, [identityOf(OLD)]);
    assert.notEqual(intent.target.generationId, OLD.generationId); assert.notEqual(intent.target.installationId, uuid(3));
    for (const table of ["workout_sessions", "upload_state", "upload_enrollment", "upload_bootstrap", "upload_records", "upload_outbox", "upload_inflight"])
      assert.equal(sql.native.prepare("SELECT COUNT(*) AS count FROM " + table).get()!.count, 0);
    assert.equal(sql.native.prepare("SELECT counter FROM upload_sequence").get()!.counter, 0);
    assert.equal(sql.native.prepare("SELECT attempts FROM upload_budget").get()!.attempts, 10);
    assert.equal(sql.native.prepare("PRAGMA user_version").get()!.user_version, 6);
    const next = { ...initialData(), settings: { ...initialData().settings, firstName: "New profile" } }; await store.write(next);
    sql.native.exec("PRAGMA user_version = 5;");
    const restarted = createJournalStorage(sql.db, options());
    assert.deepEqual(await restarted.load(), next); assert.deepEqual(await restarted.sync.pendingReset(), intent);
  } finally { sql.close(); }
});

test("failed reset commit preserves old data and queues for retry", async () => {
  const { sql, data } = await oldPhone();
  try {
    const before = sql.native.prepare("SELECT * FROM upload_outbox ORDER BY key").all();
    const store = createJournalStorage(sql.db, options()); await store.sync.state(); sql.failCommit();
    await assert.rejects(store.load(), /commit failure/);
    assert.equal(sql.native.prepare("SELECT COUNT(*) AS count FROM app_lifecycle").get()!.count, 0);
    assert.equal(sql.native.prepare("SELECT COUNT(*) AS count FROM workout_sessions").get()!.count, data.sessions.length);
    assert.deepEqual(sql.native.prepare("SELECT * FROM upload_outbox ORDER BY key").all(), before);
    assert.deepEqual(await store.load(), initialData());
  } finally { sql.close(); }
});

test("cleanup failure retries cleanup without wiping the committed fresh journal again", async () => {
  const { sql } = await oldPhone();
  try {
    let fail = true, backups = 0, cleanups = 0;
    const store = createJournalStorage(sql.db, { ...options(), beforeMigration: async () => { backups++; },
      cleanupRecovery: async () => { cleanups++; if (fail) throw new Error("cleanup unavailable"); } });
    await assert.rejects(store.load(), /cleanup unavailable/);
    const intent = await store.sync.pendingReset();
    const { sessions: _sessions, ...metadata } = initialData(); metadata.settings.firstName = "New";
    sql.native.prepare("UPDATE journal_meta SET value = ? WHERE id = 1").run(JSON.stringify(metadata));
    fail = false;
    assert.equal((await store.load()).settings.firstName, "New");
    assert.deepEqual(await store.sync.pendingReset(), intent); assert.equal(backups, 0); assert.equal(cleanups, 2);
    await store.load(); assert.equal(cleanups, 2);
  } finally { sql.close(); }
});

test("crashes after secure rewrite or before staging commit retain UID, token and fixed target", async t => {
  for (const phase of ["secure", "staging", "bootstrap"] as const) await t.test(phase, async () => {
    const { sql } = await oldPhone(phase === "bootstrap");
    try {
      const store = createJournalStorage(sql.db, options()); await store.load();
      const intent = (await store.sync.pendingReset())!, storage = vault();
      if (phase === "staging") sql.failCommit(); else storage.crash();
      const first = bootstrap(store, storage); await assert.rejects(first.run(() => true));
      const saved = storage.saved()!; assert.equal(saved.version, 3); assert.equal(saved.uid, OLD.uid); assert.equal(saved.deviceId, OLD.deviceId);
      assert.equal(saved.refreshToken, "latest-token");
      assert.deepEqual(await store.sync.pendingReset(), intent);
      const resumed = bootstrap(createJournalStorage(sql.db), storage); assert.equal(await resumed.run(() => false), true);
      const staged = (await store.sync.pendingEnrollment())!;
      assert.equal(staged.generationId, intent.target.generationId); assert.equal(staged.installationId, intent.target.installationId);
      assert.equal(staged.clock, 0); assert.equal(staged.initialComplete, false);
      assert.equal(await store.sync.pendingReset(), null); assert.equal(first.signups() + resumed.signups(), 0);
    } finally { sql.close(); }
  });
});

test("missing, locked, mismatched credentials never create a replacement", async t => {
  for (const kind of ["missing", "locked", "mismatched"] as const) await t.test(kind, async () => {
    const { sql } = await oldPhone();
    try {
      const store = createJournalStorage(sql.db, options()); await store.load();
      const storage = vault(kind === "missing" ? null : kind === "mismatched" ? { ...OLD, uid: "wrong" } : OLD);
      if (kind === "locked") storage.lock();
      const setup = bootstrap(store, storage); await assert.rejects(setup.run(() => true));
      assert.equal(setup.signups(), 0); assert.ok(await store.sync.pendingReset());
    } finally { sql.close(); }
  });
});

test("unfinished signup and legacy migration create only one replacement across secure retries", async t => {
  for (const legacy of [false, true]) await t.test(String(legacy), async () => {
    const { sql, credentials } = await oldPhone(!legacy, legacy);
    try {
      const store = createJournalStorage(sql.db, options()); await store.load();
      const storage = vault(legacy ? credentials : null); storage.failSave(true); const setup = bootstrap(store, storage);
      assert.equal(await setup.run(() => false), false); await assert.rejects(setup.run(() => true), /keychain write/);
      storage.failSave(false); assert.equal(await setup.run(() => true), true); assert.equal(setup.signups(), 1);
      assert.equal(storage.saved()!.version, 3); assert.notEqual(storage.saved()!.uid, credentials.uid);
    } finally { sql.close(); }
  });
});

test("corrupt identities, orphan queues and read failures never manufacture reset identities", async t => {
  for (const kind of ["corrupt", "orphan", "query"] as const) await t.test(kind, async () => {
    const { sql } = await oldPhone();
    try {
      if (kind === "corrupt") sql.native.exec("UPDATE upload_state SET value = 'broken'");
      if (kind === "orphan") sql.native.exec("DELETE FROM upload_state");
      const original = sql.db.getFirstAsync;
      if (kind === "query") sql.db.getFirstAsync = async (query, ...args) => {
        if (query.includes("upload_state")) throw new Error("read failed"); return original(query, ...args);
      };
      await assert.rejects(createJournalStorage(sql.db, options()).load());
      assert.equal(sql.native.prepare("SELECT COUNT(*) AS count FROM app_lifecycle").get()!.count, 0);
      assert.equal(sql.native.prepare("SELECT COUNT(*) AS count FROM upload_reset").get()!.count, 0);
    } finally { sql.close(); }
  });
});

test("previous credentials cannot send even when native attestation is available", async () => {
  let calls = 0;
  const transport = createSyncTransport((async () => { calls++; throw new Error("unexpected"); }) as typeof fetch,
    { getAppCheckToken: async () => { calls++; return "valid-token"; } });
  await assert.rejects(transport({ action: "bind", installationId: uuid(3) }, OLD),
    error => error instanceof SyncError && error.kind === "auth" && !error.retryable);
  assert.equal(calls, 0);
});
