import test from "node:test";
import assert from "node:assert/strict";
import { createJournalStorage } from "../src/data/journalStorage";
import { serializeBackup, parseBackup } from "../src/domain/backup";
import { pacificDay, nextPacificDay } from "../src/sync/journal";
import { editLastSession, historyFixture, sqliteHarness } from "./storageFixture";

const identity = { projectId: "workout-test", deviceId: "00000000-0000-4000-8000-000000000001", generationId: "00000000-0000-4000-8000-000000000002" };
const nonce = "00000000-0000-4000-8000-000000000003";
const at = "2026-10-13T12:00:00.000Z";
async function connect(store: ReturnType<typeof createJournalStorage>, id = identity, installationId = nonce) {
  const state = await store.sync.prepareEnrollment(id, "Phone", installationId);
  await store.sync.activateEnrollment(state);
  return state;
}
async function drain(store: ReturnType<typeof createJournalStorage>) {
  for (;;) {
    const batch = await store.sync.inFlight();
    if (!batch) return;
    await store.sync.acknowledge(batch.id, batch.changes.map(({ key, revision }) => ({ key, revision })), at);
  }
}
function failStateReadOnce(sql: ReturnType<typeof sqliteHarness>, table = "upload_state") {
  const getFirst = sql.db.getFirstAsync;
  sql.db.getFirstAsync = async <T>(query: string, ...params: (string | number)[]) => {
    if (query === `SELECT value FROM ${table} WHERE id = 1`) {
      sql.db.getFirstAsync = getFirst;
      throw new Error("simulated state read failure");
    }
    return getFirst<T>(query, ...params);
  };
}
function storedUploadData(sql: ReturnType<typeof sqliteHarness>) {
  return {
    state: sql.native.prepare("SELECT * FROM upload_state").all(),
    enrollment: sql.native.prepare("SELECT * FROM upload_enrollment").all(),
    records: sql.native.prepare("SELECT * FROM upload_records ORDER BY key").all(),
    outbox: sql.native.prepare("SELECT * FROM upload_outbox ORDER BY key").all(),
    inflight: sql.native.prepare("SELECT * FROM upload_inflight").all(),
    sequence: sql.native.prepare("SELECT * FROM upload_sequence").all(),
  };
}
test("enrollment reserves a nonce before binding and survives restart", async () => {
  const sql = sqliteHarness();
  try {
    const store = createJournalStorage(sql.db); await store.load();
    const staged = await store.sync.prepareEnrollment(identity, "Phone", nonce);
    assert.equal(await store.sync.state(), null);
    const reopened = createJournalStorage(sql.db); await reopened.load();
    assert.deepEqual(await reopened.sync.pendingEnrollment(), staged);
    const retry = await reopened.sync.prepareEnrollment(identity, "Phone", "00000000-0000-4000-8000-000000000099");
    assert.equal(retry.installationId, nonce);
    await reopened.sync.activateEnrollment(retry);
    assert.equal((await reopened.sync.state())!.bound, true);
  } finally { sql.close(); }
});
test("outbox and immutable in-flight batch survive reopening", async () => {
  const sql = sqliteHarness();
  try {
    const store = createJournalStorage(sql.db); await store.load();
    await store.write(historyFixture(3)); await connect(store);
    const batch = await store.sync.inFlight();
    const reopened = createJournalStorage(sql.db); await reopened.load();
    assert.deepEqual(await reopened.sync.inFlight(), batch);
    assert.ok(batch && batch.changes.length <= 10);
  } finally { sql.close(); }
});
test("failed local save rolls back journal queue and clock together", async () => {
  const sql = sqliteHarness();
  try {
    const store = createJournalStorage(sql.db); await store.load();
    const data = historyFixture(1); await store.write(data); await connect(store); await drain(store);
    const state = await store.sync.state(); sql.failNext(2);
    await assert.rejects(store.write(editLastSession(data, "105")), /disk failure/);
    assert.equal(await store.sync.pendingCount(), 0);
    assert.deepEqual(await store.sync.state(), state);
    assert.deepEqual(await store.load(), data);
    await store.write(editLastSession(data, "105")); assert.ok(await store.sync.pendingCount());
  } finally { sql.close(); }
});
test("rapid edits coalesce while frozen retry bytes stay unchanged", async () => {
  const sql = sqliteHarness();
  try {
    const store = createJournalStorage(sql.db); await store.load();
    let data = historyFixture(1); await store.write(data); await connect(store); await drain(store);
    data = editLastSession(data, "105"); await store.write(data);
    const frozen = (await store.sync.inFlight())!;
    const bytes = JSON.stringify(frozen);
    for (const weight of ["110", "115", "120"]) { data = editLastSession(data, weight); await store.write(data); }
    assert.equal(JSON.stringify(await store.sync.inFlight()), bytes);
    assert.equal(await store.sync.pendingCount(), 2);
    await store.sync.acknowledge(frozen.id, frozen.changes.map(({ key, revision }) => ({ key, revision })), at);
    const next = (await store.sync.inFlight())!;
    assert.ok(next.changes.some((doc) => JSON.stringify(doc.payload).includes("120")));
    assert.ok(next.changes.every((doc) => doc.revision > frozen.changes[0].revision));
  } finally { sql.close(); }
});
test("wrong or incomplete acknowledgments do not clear a batch", async () => {
  const sql = sqliteHarness();
  try {
    const store = createJournalStorage(sql.db); await store.load(); await connect(store);
    const batch = (await store.sync.inFlight())!;
    await store.sync.acknowledge("other-generation", [], at);
    assert.deepEqual(await store.sync.inFlight(), batch);
    await assert.rejects(store.sync.acknowledge(batch.id, [], at), /confirmation/);
    assert.deepEqual(await store.sync.inFlight(), batch);
  } finally { sql.close(); }
});
test("history snapshot remains unchanged when plan definitions change", async () => {
  const sql = sqliteHarness();
  try {
    const store = createJournalStorage(sql.db); await store.load();
    const data = historyFixture(1); await store.write(data); await connect(store); await drain(store);
    const changed = { ...data, exercises: data.exercises.map((ex, i) => i ? ex : { ...ex, name: "New name" }) };
    await store.write(changed);
    assert.equal((await store.load()).sessions[0].exercises[0].exercise.name, data.sessions[0].exercises[0].exercise.name);
    const batch = (await store.sync.inFlight())!;
    assert.ok(batch.changes.every((doc) => doc.kind !== "workout_exercise"));
  } finally { sql.close(); }
});
test("valid restore queues clears and deletion tombstones without identity import", async () => {
  const sql = sqliteHarness();
  try {
    const store = createJournalStorage(sql.db); await store.load();
    const data = historyFixture(2); await store.write(data); await connect(store); await drain(store);
    const restored = parseBackup(serializeBackup({ ...data, sessions: [data.sessions[0]] }));
    await store.write(restored);
    const batch = (await store.sync.inFlight())!;
    assert.equal(batch.changes.length, 7);
    assert.ok(batch.changes.every((doc) => doc.deleted && JSON.stringify(doc.payload) === "{}"));
    assert.equal((await store.sync.state())!.installationId, nonce);
    assert.ok(!serializeBackup(restored).includes("installationId"));
  } finally { sql.close(); }
});
test("rotation retains identity clock and the in-flight batch", async () => {
  const sql = sqliteHarness();
  try {
    const store = createJournalStorage(sql.db); await store.load(); await store.write(historyFixture(1)); await connect(store);
    const batch = await store.sync.inFlight(); const before = await store.sync.state();
    await connect(store, identity, "00000000-0000-4000-8000-000000000099");
    assert.deepEqual(await store.sync.inFlight(), batch);
    assert.deepEqual(await store.sync.state(), before);
  } finally { sql.close(); }
});
test("replacement generation starts separately and stale ack cannot clear it", async () => {
  const sql = sqliteHarness();
  try {
    const store = createJournalStorage(sql.db); await store.load(); await connect(store);
    const old = (await store.sync.inFlight())!;
    const nextIdentity = { ...identity, generationId: "00000000-0000-4000-8000-000000000009" };
    await connect(store, nextIdentity);
    const next = await store.sync.inFlight();
    await store.sync.acknowledge(old.id, old.changes.map(({ key, revision }) => ({ key, revision })), at);
    assert.deepEqual(await store.sync.inFlight(), next);
    assert.equal((await store.sync.state())!.lastSyncedAt, null);
  } finally { sql.close(); }
});
test("initial completion is acknowledged separately after history drains", async () => {
  const sql = sqliteHarness();
  try {
    const store = createJournalStorage(sql.db); await store.load(); await connect(store);
    while (await store.sync.pendingCount()) {
      const batch = (await store.sync.inFlight())!;
      assert.ok(batch.changes.every((doc) => doc.kind !== "completion"));
      await store.sync.acknowledge(batch.id, batch.changes, at);
    }
    assert.equal((await store.sync.state())!.initialComplete, false);
    const marker = (await store.sync.inFlight())!;
    assert.equal(marker.changes[0].kind, "completion");
    await store.sync.acknowledge(marker.id, marker.changes, at);
    assert.equal((await store.sync.state())!.initialComplete, true);
  } finally { sql.close(); }
});
test("daily attempts persist across generations and Pacific midnight DST", async () => {
  const sql = sqliteHarness();
  try {
    const store = createJournalStorage(sql.db); await store.load();
    const time = Date.parse("2026-11-01T08:30:00Z");
    for (let i = 0; i < 800; i++) assert.equal((await store.sync.reserveAttempt(10, time)).allowed, true);
    const reopened = createJournalStorage(sql.db); await reopened.load();
    const blocked = await reopened.sync.reserveAttempt(1, time);
    assert.equal(blocked.allowed, false);
    assert.equal(pacificDay(blocked.retryAt!), "2026-11-02");
    assert.equal((await reopened.sync.reserveAttempt(1, blocked.retryAt!)).allowed, true);
    assert.equal(pacificDay(nextPacificDay(Date.parse("2026-03-08T08:30:00Z"))), "2026-03-09");
  } finally { sql.close(); }
});
test("v3 migration preserves the journal and removes Sheets state", async () => {
  const sql = sqliteHarness();
  try {
    const store = createJournalStorage(sql.db); await store.load(); const data = historyFixture(2); await store.write(data);
    sql.native.exec("CREATE TABLE sync_state (id INTEGER PRIMARY KEY, device_id TEXT); CREATE TABLE sync_rows (key TEXT); CREATE TABLE sync_outbox (key TEXT); PRAGMA user_version = 3;");
    const reopened = createJournalStorage(sql.db); assert.deepEqual(await reopened.load(), data);
    assert.equal(sql.native.prepare("PRAGMA user_version").get()?.user_version, 5);
    assert.equal(sql.native.prepare("SELECT name FROM sqlite_master WHERE name = 'sync_state'").get(), undefined);
    assert.equal(await reopened.sync.state(), null);
  } finally { sql.close(); }
});
test("sync operations use only the exclusive transaction connection", async () => {
  const sql = sqliteHarness();
  let active = false;
  const base = sql.db;
  const guarded = { ...base,
    async runAsync(...args: Parameters<typeof base.runAsync>) { assert.equal(active, false); return base.runAsync(...args); },
    async getFirstAsync<T>(...args: Parameters<typeof base.getFirstAsync>) { assert.equal(active, false); return base.getFirstAsync<T>(...args); },
    async getAllAsync<T>(...args: Parameters<typeof base.getAllAsync>) { assert.equal(active, false); return base.getAllAsync<T>(...args); },
    async execAsync(sqlText: string) { assert.equal(active, false); return base.execAsync(sqlText); },
    async withExclusiveTransactionAsync(task: Parameters<typeof base.withExclusiveTransactionAsync>[0]) {
      return base.withExclusiveTransactionAsync(async (tx) => { active = true; try { await task(tx); } finally { active = false; } });
    },
  };
  try {
    const store = createJournalStorage(guarded); await store.load(); await store.write(historyFixture(1)); await connect(store); await drain(store);
  } finally { sql.close(); }
});

test("same-identity activation preserves edits saved during enrollment", async () => {
  const sql = sqliteHarness();
  try {
    const store = createJournalStorage(sql.db); await store.load();
    const data = historyFixture(1); await store.write(data); await connect(store); await drain(store);
    const candidate = await store.sync.prepareEnrollment(identity, "Renamed", nonce);
    await store.write(editLastSession(data, "105"));
    const advanced = (await store.sync.state())!.clock;
    await store.sync.activateEnrollment(candidate);
    assert.ok((await store.sync.state())!.clock > advanced);
    await store.write(editLastSession(data, "110"));
    assert.ok((await store.sync.state())!.clock > advanced + 1);
  } finally { sql.close(); }
});
test("pre-migration backup failure leaves old storage and sync tables intact", async () => {
  const sql = sqliteHarness();
  try {
    const data = historyFixture(1);
    sql.native.exec("CREATE TABLE app_state (id INTEGER PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE sync_state (id INTEGER); PRAGMA user_version = 1;");
    sql.native.prepare("INSERT INTO app_state VALUES (1, ?)").run(JSON.stringify(data));
    let preserved = false;
    const store = createJournalStorage(sql.db, { beforeMigration: async (snapshot) => {
      assert.deepEqual(snapshot, data); if (!preserved) throw new Error("backup disk full");
    } });
    await assert.rejects(store.load(), /backup disk full/);
    assert.ok(sql.native.prepare("SELECT name FROM sqlite_master WHERE name='sync_state'").get());
    assert.equal(sql.native.prepare("PRAGMA user_version").get()?.user_version, 1);
    preserved = true;
    assert.deepEqual(await store.load(), data);
  } finally { sql.close(); }
});

test("corrupt upload identity never prevents local workout autosaves", async () => {
  for (const patch of [
    { deviceId: "corrupt-device" }, { projectId: "?" }, { generationId: "bad-generation" },
    { installationId: "not-an-installation" }, { label: 42 }, { clock: -1 },
  ]) {
    const sql = sqliteHarness();
    try {
      const store = createJournalStorage(sql.db); await store.load();
      const data = historyFixture(1); await store.write(data); await connect(store); await drain(store);
      const current = (await store.sync.state())!;
      sql.native.prepare("UPDATE upload_state SET value = ?").run(JSON.stringify({ ...current, ...patch }));
      const edited = editLastSession(data, "150");
      await store.write(edited);
      assert.equal((await store.load()).sessions[0].exercises[0].sets[0].weight, "150");
      await assert.rejects(store.sync.state());
      const replacement = await store.sync.prepareEnrollment({ ...identity, generationId: "00000000-0000-4000-8000-000000000009" }, "New phone", nonce);
      await store.sync.activateEnrollment(replacement);
      assert.equal((await store.sync.state())!.generationId, replacement.generationId);
    } finally { sql.close(); }
  }
});

test("state read failure rolls back an autosave and retry captures the same snapshot", async () => {
  const sql = sqliteHarness();
  try {
    const store = createJournalStorage(sql.db); await store.load();
    const data = historyFixture(1); await store.write(data); await connect(store); await drain(store);
    const before = storedUploadData(sql);
    const edited = editLastSession(data, "151");
    failStateReadOnce(sql);
    await assert.rejects(store.write(edited), /state read failure/);
    assert.deepEqual(JSON.parse(String(sql.native.prepare("SELECT value FROM workout_sessions").get()!.value)), data.sessions[0]);
    assert.deepEqual(storedUploadData(sql), before);

    await store.write(edited);
    assert.deepEqual(JSON.parse(String(sql.native.prepare("SELECT value FROM workout_sessions").get()!.value)), edited.sessions[0]);
    const batch = (await store.sync.inFlight())!;
    assert.deepEqual(batch.changes.find((doc) => doc.kind === "workout_exercise")!.payload.sets, edited.sessions[0].exercises[0].sets);
    assert.ok(batch.changes.some((doc) => doc.kind === "workout"));
    assert.deepEqual(await createJournalStorage(sql.db).load(), edited);
  } finally { sql.close(); }
});

test("enrollment preparation read failures preserve current and staged identities and frozen uploads", async () => {
  for (const table of ["upload_state", "upload_enrollment"]) {
    const sql = sqliteHarness();
    try {
      const store = createJournalStorage(sql.db); await store.load();
      await store.write(historyFixture(1)); await connect(store);
      const frozen = await store.sync.inFlight();
      const nextIdentity = { ...identity, generationId: "00000000-0000-4000-8000-000000000009" };
      const stagedNonce = "00000000-0000-4000-8000-000000000004";
      await store.sync.prepareEnrollment(nextIdentity, "Pending", stagedNonce);
      const before = storedUploadData(sql);
      failStateReadOnce(sql, table);
      await assert.rejects(store.sync.prepareEnrollment(nextIdentity, "Renamed", nonce), /state read failure/);
      assert.deepEqual(storedUploadData(sql), before);

      const retry = await store.sync.prepareEnrollment(nextIdentity, "Renamed", nonce);
      assert.equal(retry.installationId, stagedNonce);
      assert.equal(retry.label, "Renamed");
      assert.equal((await store.sync.state())!.generationId, identity.generationId);
      assert.deepEqual(await store.sync.inFlight(), frozen);
    } finally { sql.close(); }
  }
});

test("activation read failures retain advanced revisions and immutable in-flight batches for retry", async () => {
  for (const table of ["upload_state", "upload_enrollment"]) {
    const sql = sqliteHarness();
    try {
      const store = createJournalStorage(sql.db); await store.load();
      const data = historyFixture(1); await store.write(data); await connect(store);
      const frozen = await store.sync.inFlight();
      const candidate = await store.sync.prepareEnrollment(identity, "Renamed", nonce);
      await store.write(editLastSession(data, "151"));
      const advanced = (await store.sync.state())!.clock;
      const before = storedUploadData(sql);
      failStateReadOnce(sql, table);
      await assert.rejects(store.sync.activateEnrollment(candidate), /state read failure/);
      assert.deepEqual(storedUploadData(sql), before);

      await store.sync.activateEnrollment(candidate);
      assert.ok((await store.sync.state())!.clock > advanced);
      assert.equal((await store.sync.state())!.label, "Renamed");
      assert.equal(await store.sync.pendingEnrollment(), null);
      assert.deepEqual(await store.sync.inFlight(), frozen);
    } finally { sql.close(); }
  }
});

test("state read failures leave disconnect rename batching and acknowledgment retryable", async () => {
  for (const operation of ["disconnect", "rename", "batch", "acknowledge"]) {
    const sql = sqliteHarness();
    try {
      const store = createJournalStorage(sql.db); await store.load(); await connect(store);
      const frozen = operation === "batch" ? null : (await store.sync.inFlight())!;
      const run = () => operation === "disconnect" ? store.sync.disconnect()
        : operation === "rename" ? store.sync.setLabel("Renamed")
        : operation === "batch" ? store.sync.inFlight()
        : store.sync.acknowledge(frozen!.id, frozen!.changes, at);
      const before = storedUploadData(sql);
      failStateReadOnce(sql);
      await assert.rejects(run(), /state read failure/);
      assert.deepEqual(storedUploadData(sql), before);
      await run();
      assert.notDeepEqual(storedUploadData(sql), before);
    } finally { sql.close(); }
  }
});

test("malformed stored identities allow local saves and full enrollment into a replacement generation", async () => {
  const sql = sqliteHarness();
  try {
    const store = createJournalStorage(sql.db); await store.load();
    const data = historyFixture(1); await store.write(data); await connect(store);
    const old = (await store.sync.inFlight())!;
    await store.sync.prepareEnrollment(identity, "Pending", nonce);
    sql.native.prepare("UPDATE upload_state SET value = ?").run("{");
    sql.native.prepare("UPDATE upload_enrollment SET value = ?").run("null");
    const edited = editLastSession(data, "151"); await store.write(edited);
    assert.deepEqual(await store.load(), edited);
    await assert.rejects(store.sync.state());
    await assert.rejects(store.sync.pendingEnrollment());

    const nextIdentity = { ...identity, generationId: "00000000-0000-4000-8000-000000000009" };
    await connect(store, nextIdentity);
    assert.equal((await store.sync.state())!.generationId, nextIdentity.generationId);
    assert.equal(await store.sync.pendingEnrollment(), null);
    const exercise = sql.native.prepare("SELECT payload FROM upload_outbox WHERE kind = 'workout_exercise' ORDER BY key LIMIT 1").get()!;
    assert.deepEqual(JSON.parse(String(exercise.payload)).sets, edited.sessions[0].exercises[0].sets);
    const replacement = await store.sync.inFlight();
    assert.notEqual(replacement!.id, old.id);
    await store.sync.acknowledge(old.id, old.changes, at);
    assert.deepEqual(await store.sync.inFlight(), replacement);
  } finally { sql.close(); }
});

test("disconnect clears abandoned enrollment but keeps local queue and frozen upload", async () => {
  const sql = sqliteHarness();
  try {
    const store = createJournalStorage(sql.db); await store.load();
    const data = historyFixture(1); await store.write(data); await connect(store); await drain(store);
    await store.write(editLastSession(data, "175"));
    const frozen = await store.sync.inFlight();
    await store.sync.prepareEnrollment(identity, "Abandoned label", nonce);
    const queued = await store.sync.pendingCount();
    await store.sync.disconnect();
    assert.equal((await store.sync.state())!.enabled, false);
    assert.equal(await store.sync.pendingEnrollment(), null);
    assert.equal(await store.sync.pendingCount(), queued);
    assert.deepEqual(await store.sync.inFlight(), frozen);
    const reopened = createJournalStorage(sql.db); await reopened.load();
    assert.equal((await reopened.sync.state())!.enabled, false);
    assert.equal(await reopened.sync.pendingEnrollment(), null);
  } finally { sql.close(); }
});


const bootstrapDraft = { version: 1 as const, ...identity, installationId: nonce, label: "iPhone · 000003" };
test("automatic draft survives restart and activation uploads all local history", async () => {
  const sql = sqliteHarness();
  try {
    const store = createJournalStorage(sql.db); await store.load();
    const history = historyFixture(2); await store.write(history);
    assert.deepEqual(await store.sync.prepareBootstrap(bootstrapDraft), bootstrapDraft);
    const reopened = createJournalStorage(sql.db); await reopened.load();
    assert.deepEqual(await reopened.sync.prepareBootstrap({ ...bootstrapDraft, label: "Different model" }), bootstrapDraft);
    const automatic = { ...identity, layout: "automatic" as const, uid: "anonymous_phone" };
    const staged = await reopened.sync.prepareEnrollment(automatic, bootstrapDraft.label, nonce);
    await reopened.sync.activateEnrollment(staged);
    assert.equal(sql.native.prepare("SELECT COUNT(*) AS n FROM upload_bootstrap").get()!.n, 0);
    assert.equal((await reopened.sync.state())!.layout, "automatic");
    assert.ok(await reopened.sync.pendingCount() > 2);
    assert.deepEqual(await reopened.load(), history);
    const frozen = await reopened.sync.inFlight();
    const again = createJournalStorage(sql.db); await again.load();
    assert.deepEqual(await again.sync.inFlight(), frozen);
  } finally { sql.close(); }
});
test("orphaned or corrupt upload state cannot bootstrap a replacement account", async () => {
  for (const damage of [
    "UPDATE upload_sequence SET counter = 2",
    "INSERT INTO upload_inflight VALUES (1, '{}')",
    "INSERT INTO upload_state VALUES (1, '{}')",
    "INSERT INTO upload_enrollment VALUES (1, '{}')",
    "INSERT INTO upload_bootstrap VALUES (1, '{}')",
  ]) {
    const sql = sqliteHarness();
    try {
      const store = createJournalStorage(sql.db); await store.load();
      sql.native.exec(damage);
      await assert.rejects(store.sync.prepareBootstrap(bootstrapDraft));
      assert.equal(await store.sync.pendingCount(), 0);
      const local = historyFixture(1); await store.write(local);
      assert.deepEqual(await store.load(), local);
    } finally { sql.close(); }
  }
});
test("bootstrap transaction and read failures leave no partially reserved identity", async () => {
  const sql = sqliteHarness();
  try {
    const store = createJournalStorage(sql.db); await store.load();
    failStateReadOnce(sql);
    await assert.rejects(store.sync.prepareBootstrap(bootstrapDraft), /read failure/);
    assert.equal(sql.native.prepare("SELECT COUNT(*) AS n FROM upload_bootstrap").get()!.n, 0);
    sql.failNext(1);
    await assert.rejects(store.sync.prepareBootstrap(bootstrapDraft), /disk failure/);
    assert.equal(sql.native.prepare("SELECT COUNT(*) AS n FROM upload_bootstrap").get()!.n, 0);
    assert.deepEqual(await store.sync.prepareBootstrap(bootstrapDraft), bootstrapDraft);
    sql.native.exec("UPDATE upload_sequence SET counter = 7");
    await assert.rejects(store.sync.prepareBootstrap(bootstrapDraft), /repair/);
  } finally { sql.close(); }
});
