import test from "node:test";
import assert from "node:assert/strict";
import { createJournalStorage } from "../src/data/journalStorage";
import { projectData, changedDocuments } from "../src/sync/projection";
import { historyFixture, sqliteHarness } from "./storageFixture";

const identity = { projectId: "workout-test", deviceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", generationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" };
const installationId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const at = "2026-10-14T12:00:00.000Z";
async function drain(store: ReturnType<typeof createJournalStorage>) {
  for (;;) {
    const batch = await store.sync.inFlight();
    if (!batch) return;
    await store.sync.acknowledge(batch.id, batch.changes.map(({ key, revision }) => ({ key, revision })), at);
  }
}
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
