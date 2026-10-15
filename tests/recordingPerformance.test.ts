import test from "node:test";
import assert from "node:assert/strict";
import { snapshot } from "../src/data/snapshot";
import { createJournalStorage } from "../src/data/journalStorage";
import { parseBackup, serializeBackup } from "../src/domain/backup";
import { editLastSession, historyFixture, scheduleHistoryFixture, sqliteHarness } from "./storageFixture";

test("unchanged schedule history stays shared while changed revisions remain validated", () => {
  const data = snapshot(scheduleHistoryFixture(3, 2));
  const edited = snapshot(editLastSession(data, "155"), data);
  assert.equal(edited.scheduleRevisions, data.scheduleRevisions);
  assert.ok(Object.isFrozen(edited.scheduleRevisions[0].templates[0].exercises[0]));
  const revision = data.scheduleRevisions[1];
  const invalid = { ...revision, slots: revision.slots.map((slot, index) =>
    index === 0 ? { ...slot, workoutIds: [null, null] } : slot) };
  assert.throws(() => snapshot({
    ...data, scheduleRevisions: [data.scheduleRevisions[0], invalid, data.scheduleRevisions[2]],
  }, data), /recurrences|weekday assignment/);
  assert.throws(() => snapshot({
    ...data, scheduleRevisions: [...data.scheduleRevisions, data.scheduleRevisions[0]],
  }, data), /duplicate/);
  const duplicateDate = { ...revision, id: "different-id" };
  assert.throws(() => snapshot({
    ...data, scheduleRevisions: [...data.scheduleRevisions, duplicateDate],
  }, data), /duplicate/);
  assert.deepEqual(parseBackup(serializeBackup(edited)), edited);
});

test("shallow frozen untrusted schedules cannot bypass nested validation", () => {
  const data = scheduleHistoryFixture(1, 1);
  data.scheduleRevisions[0].templates[0].exercises[0].sets = 0;
  Object.freeze(data.scheduleRevisions[0]);
  Object.freeze(data);
  assert.throws(() => snapshot({ ...data }, data), /sets/);
  assert.throws(() => parseBackup(JSON.stringify(data)), /sets/);
});

test("the first session-only edit persists metadata in a fresh database", async () => {
  const sql = sqliteHarness();
  try {
    const store = createJournalStorage(sql.db);
    const initial = await store.load();
    const next = snapshot({ ...initial, sessions: historyFixture(1).sessions }, initial);
    await store.write(next);
    assert.ok(sql.native.prepare("SELECT value FROM journal_meta WHERE id = 1").get());
    assert.deepEqual(await createJournalStorage(sql.db).load(), next);
  } finally { sql.close(); }
});

test("cached metadata survives session edits and is updated only after successful metadata saves", async () => {
  const sql = sqliteHarness();
  try {
    const store = createJournalStorage(sql.db); await store.load();
    const data = snapshot(scheduleHistoryFixture(3, 2)); await store.write(data);
    const metadata = sql.native.prepare("SELECT value FROM journal_meta").get()!.value;
    const edited = snapshot(editLastSession(data, "160"), data);
    await store.write(edited);
    assert.equal(sql.native.prepare("SELECT value FROM journal_meta").get()!.value, metadata);
    const revised = snapshot({ ...edited, settings: { ...edited.settings, unit: "kg" } }, edited);
    sql.failCommit();
    await assert.rejects(store.write(revised), /commit failure/);
    assert.equal(sql.native.prepare("SELECT value FROM journal_meta").get()!.value, metadata);
    await store.write(revised);
    assert.deepEqual(await createJournalStorage(sql.db).load(), revised);
  } finally { sql.close(); }
});
