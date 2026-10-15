import test from "node:test";
import assert from "node:assert/strict";
import { createJournalStorage } from "../src/data/journalStorage";
import { upgradeData, validateLegacyData } from "../src/domain/backup";
import { projectData, changedDocuments } from "../src/sync/projection";
import { historyFixture, editLastSession, sqliteHarness } from "./storageFixture";

const identity = { projectId: "workout-test", deviceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", generationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" };
const installationId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const at = "2026-10-14T12:00:00.000Z";
function legacyData(data: ReturnType<typeof historyFixture>) {
  const value: any = structuredClone(data);
  value.schemaVersion = 1;
  delete value.bodyWeights;
  for (const plan of value.templates) delete plan.recurrence;
  for (const revision of value.scheduleRevisions) {
    for (const plan of revision.templates) delete plan.recurrence;
    for (const slot of revision.slots) slot.workoutIds = slot.workoutIds[0] === slot.workoutIds[1]
      ? slot.workoutIds[0] === null ? [] : [slot.workoutIds[0]] : slot.workoutIds;
  }
  for (const session of value.sessions) for (const entry of session.exercises) {
    delete entry.suggestion.algorithmVersion;
    for (const set of entry.sets) delete set.classification;
  }
  return validateLegacyData(value);
}
async function drain(store: ReturnType<typeof createJournalStorage>) {
  for (;;) {
    const batch = await store.sync.inFlight();
    if (!batch) return;
    await store.sync.acknowledge(batch.id, batch.changes.map(({ key, revision }) => ({ key, revision })), at);
  }
}
async function oldDatabase() {
  const sql = sqliteHarness();
  const store = createJournalStorage(sql.db); await store.load();
  let data = historyFixture(1); await store.write(data);
  const enrollment = await store.sync.prepareEnrollment(identity, "Phone", installationId);
  await store.sync.activateEnrollment(enrollment); await drain(store);
  data = editLastSession(data, "150"); await store.write(data);
  const frozen = (await store.sync.inFlight())!;
  for (const change of frozen.changes) if (change.kind === "workout_exercise") {
    const payload: any = change.payload;
    delete payload.suggestion.algorithmVersion;
    payload.sets.forEach((set: any) => { delete set.classification; });
    sql.native.prepare("UPDATE upload_outbox SET payload = ? WHERE key = ?").run(JSON.stringify(payload), change.key);
  }
  sql.native.prepare("UPDATE upload_inflight SET value = ? WHERE id = 1").run(JSON.stringify(frozen));
  const legacy = legacyData(data);
  const { sessions, ...metadata } = legacy;
  sql.native.prepare("UPDATE journal_meta SET value = ? WHERE id = 1").run(JSON.stringify(metadata));
  for (const session of sessions) sql.native.prepare("UPDATE workout_sessions SET value = ? WHERE id = ?").run(JSON.stringify(session), session.id);
  sql.native.exec("PRAGMA user_version = 4;");
  return { sql, frozen, legacy };
}
test("v4 migration preserves the raw recovery journal and frozen retry while queuing upgraded snapshots", async () => {
  const { sql, frozen, legacy } = await oldDatabase();
  try {
    let recovery: unknown;
    const store = createJournalStorage(sql.db, { beforeMigration: async (data, from, to) => {
      recovery = structuredClone(data); assert.equal(from, 4); assert.equal(to, 5);
    } });
    const upgraded = await store.load();
    assert.deepEqual(recovery, legacy);
    assert.deepEqual(upgraded, upgradeData(legacy));
    assert.equal(sql.native.prepare("PRAGMA user_version").get()!.user_version, 5);
    assert.deepEqual(await store.sync.inFlight(), frozen);
    await store.sync.acknowledge(frozen.id, frozen.changes.map(({ key, revision }) => ({ key, revision })), at);
    const next = (await store.sync.inFlight())!;
    const snapshot = next.changes.find(change => change.kind === "workout_exercise")!;
    assert.ok(snapshot.revision > frozen.changes[0].revision);
    assert.equal((snapshot.payload.suggestion as any).algorithmVersion, 1);
    assert.equal((snapshot.payload.sets as any[])[0].classification, "working");
    await drain(store);
    assert.deepEqual(await createJournalStorage(sql.db).load(), upgraded);
  } finally { sql.close(); }
});
test("v4 migration commit failure preserves old journal queue revisions and version for retry", async () => {
  const { sql, frozen, legacy } = await oldDatabase();
  try {
    const store = createJournalStorage(sql.db); await store.sync.state();
    const oldQueue = sql.native.prepare("SELECT * FROM upload_outbox ORDER BY key").all();
    sql.failCommit(); await assert.rejects(store.load(), /commit failure/);
    assert.equal(sql.native.prepare("PRAGMA user_version").get()!.user_version, 4);
    assert.deepEqual(sql.native.prepare("SELECT * FROM upload_outbox ORDER BY key").all(), oldQueue);
    assert.deepEqual(await store.sync.inFlight(), frozen);
    assert.equal(JSON.parse(String(sql.native.prepare("SELECT value FROM journal_meta").get()!.value)).schemaVersion, 1);
    assert.deepEqual(await store.load(), upgradeData(legacy));
  } finally { sql.close(); }
});
test("body-weight measurements upload independently and deletes emit empty tombstones", async () => {
  const sql = sqliteHarness();
  try {
    const store = createJournalStorage(sql.db); await store.load();
    let data = historyFixture(1); await store.write(data);
    const staged = await store.sync.prepareEnrollment(identity, "Phone", installationId); await store.sync.activateEnrollment(staged); await drain(store);
    const measurement = { id: "measurement", date: "2026-10-14", weightKg: 81.6466266, updatedAt: at };
    data = { ...data, bodyWeights: [measurement] }; await store.write(data);
    const batch = (await store.sync.inFlight())!; assert.equal(batch.changes.length, 1);
    assert.equal(batch.changes[0].kind, "body_weight"); assert.deepEqual(batch.changes[0].payload, measurement);
    await drain(store);
    const projected = projectData(data, identity.deviceId, "Phone");
    data = { ...data, bodyWeights: [] }; await store.write(data);
    const removed = (await store.sync.inFlight())!.changes[0];
    assert.equal(removed.kind, "body_weight"); assert.equal(removed.deleted, true); assert.deepEqual(removed.payload, {});
    assert.deepEqual(changedDocuments(projected, projectData(data, identity.deviceId, "Phone"))[0].payload, {});
  } finally { sql.close(); }
});
