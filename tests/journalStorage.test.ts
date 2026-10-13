import test from "node:test";
import assert from "node:assert/strict";
import { createJournalStorage } from "../src/data/journalStorage";
import { snapshot } from "../src/data/snapshot";
import { parseBackup, serializeBackup } from "../src/domain/backup";
import {
  editLastSession,
  historyFixture,
  sqliteHarness,
} from "./storageFixture";

test("one set edit writes one small record even with a thousand workouts", async () => {
  const sql = sqliteHarness();
  try {
    const store = createJournalStorage(sql.db);
    await store.load();
    const data = snapshot(historyFixture());
    await store.write(data);
    const before = sql.stats();
    const next = snapshot(editLastSession(data, "105"), data);
    assert.equal(next.sessions[0], data.sessions[0]);
    assert.equal(next.settings, data.settings);
    await store.write(next);
    assert.equal(sql.stats().writes - before.writes, 1);
    assert.ok(sql.stats().bytes - before.bytes < 5000);
    const restored = await createJournalStorage(sql.db).load();
    assert.deepEqual(restored, next);
    assert.equal(restored.sessions.at(-1)?.exercises[0].sets[0].weight, "105");
    const beforeNoOp = sql.stats();
    await store.write(next);
    assert.deepEqual(sql.stats(), beforeNoOp);
  } finally {
    sql.close();
  }
});

test("version one journals migrate atomically and release the old copy", async () => {
  const sql = sqliteHarness();
  try {
    const data = historyFixture(2);
    sql.native.exec(
      "CREATE TABLE app_state (id INTEGER PRIMARY KEY, value TEXT NOT NULL); PRAGMA user_version = 1;",
    );
    sql.native
      .prepare("INSERT INTO app_state VALUES (1, ?)")
      .run(JSON.stringify(data));
    const migrated = await createJournalStorage(sql.db).load();
    assert.deepEqual(migrated, data);
    assert.equal(
      sql.native
        .prepare("SELECT name FROM sqlite_master WHERE name = 'app_state'")
        .get(),
      undefined,
    );
    assert.equal(
      sql.native.prepare("PRAGMA user_version").get()?.user_version,
      3,
    );
    assert.deepEqual(await createJournalStorage(sql.db).load(), data);
  } finally {
    sql.close();
  }
});

test("failed migration rolls back and can be retried without losing the original", async () => {
  const sql = sqliteHarness();
  try {
    const data = historyFixture(3);
    sql.native.exec(
      "CREATE TABLE app_state (id INTEGER PRIMARY KEY, value TEXT NOT NULL);",
    );
    sql.native
      .prepare("INSERT INTO app_state VALUES (1, ?)")
      .run(JSON.stringify(data));
    sql.failNext(2);
    const store = createJournalStorage(sql.db);
    await assert.rejects(store.load(), /disk failure/);
    assert.equal(
      sql.native.prepare("SELECT value FROM app_state").get()?.value,
      JSON.stringify(data),
    );
    assert.equal(
      sql.native.prepare("SELECT COUNT(*) AS count FROM workout_sessions").get()
        ?.count,
      0,
    );
    assert.deepEqual(await store.load(), data);
  } finally {
    sql.close();
  }
});

test("replacement restores delete old rows and transaction failure retains all prior data", async () => {
  const sql = sqliteHarness();
  try {
    const store = createJournalStorage(sql.db);
    await store.load();
    const prior = snapshot(historyFixture(4));
    await store.write(prior);
    const replacement = historyFixture(1);
    replacement.settings.unit = "kg";
    replacement.sessions[0].title = "Replacement";
    sql.failNext(2);
    await assert.rejects(store.write(replacement), /disk failure/);
    assert.deepEqual(await createJournalStorage(sql.db).load(), prior);
    await store.write(replacement);
    assert.deepEqual(await createJournalStorage(sql.db).load(), replacement);
  } finally {
    sql.close();
  }
});

test("unchanged frozen history remains shared while invalid edits and duplicate dates are rejected", () => {
  const data = snapshot(historyFixture(3));
  assert.ok(Object.isFrozen(data.sessions[0].exercises[0].sets[0]));
  assert.throws(() => {
    data.sessions[0].exercises[0].sets[0].weight = "999";
  }, TypeError);
  const invalid = editLastSession(data, "bad input");
  assert.throws(() => snapshot(invalid, data), /numeric draft/);
  assert.throws(
    () =>
      snapshot(
        { ...data, sessions: [...data.sessions, data.sessions[0]] },
        data,
      ),
    /duplicate/,
  );
  const cleared = snapshot(editLastSession(data, ""), data);
  assert.equal(cleared.sessions.at(-1)?.exercises[0].sets[0].weight, "");
  assert.deepEqual(parseBackup(serializeBackup(cleared)), cleared);
});

test("invalid replacement cannot issue a database write", async () => {
  const sql = sqliteHarness();
  try {
    const store = createJournalStorage(sql.db);
    await store.load();
    const data = snapshot(historyFixture(2));
    await store.write(data);
    const before = sql.stats();
    await assert.rejects(
      store.write(editLastSession(data, "invalid")),
      /numeric draft/,
    );
    assert.deepEqual(sql.stats(), before);
    assert.deepEqual(await createJournalStorage(sql.db).load(), data);
  } finally {
    sql.close();
  }
});

test("shallow frozen input is deeply frozen before unchanged history can bypass validation", () => {
  const input = historyFixture(2);
  Object.freeze(input.sessions[0]);
  Object.freeze(input);
  const data = snapshot(input);
  assert.ok(Object.isFrozen(data.sessions[0].exercises[0].sets[0]));
  assert.throws(() => {
    data.sessions[0].exercises[0].sets[0].weight = "invalid";
  }, TypeError);
  const untrusted = historyFixture(1);
  untrusted.sessions[0].exercises[0].sets[0].weight = "invalid";
  Object.freeze(untrusted.sessions[0]);
  assert.throws(() => snapshot({ ...untrusted }, untrusted), /numeric draft/);
});

test("migration commit failure restores the legacy table and version before retry", async () => {
  const sql = sqliteHarness();
  try {
    const data = historyFixture(3);
    sql.native.exec(
      "CREATE TABLE app_state (id INTEGER PRIMARY KEY, value TEXT NOT NULL); PRAGMA user_version = 1;",
    );
    sql.native
      .prepare("INSERT INTO app_state VALUES (1, ?)")
      .run(JSON.stringify(data));
    sql.failCommit();
    const store = createJournalStorage(sql.db);
    await assert.rejects(store.load(), /commit failure/);
    assert.equal(
      sql.native.prepare("SELECT value FROM app_state").get()?.value,
      JSON.stringify(data),
    );
    assert.equal(
      sql.native.prepare("PRAGMA user_version").get()?.user_version,
      1,
    );
    assert.equal(
      sql.native.prepare("SELECT COUNT(*) AS count FROM workout_sessions").get()
        ?.count,
      0,
    );
    assert.deepEqual(await store.load(), data);
  } finally {
    sql.close();
  }
});

test("failed restore commit preserves deleted rows and comparison cache for retry", async () => {
  const sql = sqliteHarness();
  try {
    const store = createJournalStorage(sql.db);
    await store.load();
    const data = historyFixture(3);
    await store.write(data);
    const replacement = historyFixture(1);
    replacement.settings.unit = "kg";
    sql.failCommit();
    await assert.rejects(store.write(replacement), /commit failure/);
    assert.deepEqual(await createJournalStorage(sql.db).load(), data);
    await store.write(replacement);
    assert.deepEqual(await createJournalStorage(sql.db).load(), replacement);
  } finally {
    sql.close();
  }
});

test("concurrent launch reads share one migration and later reads see current data", async () => {
  const sql = sqliteHarness();
  try {
    const data = historyFixture(2);
    sql.native.exec(
      "CREATE TABLE app_state (id INTEGER PRIMARY KEY, value TEXT NOT NULL);",
    );
    sql.native
      .prepare("INSERT INTO app_state VALUES (1, ?)")
      .run(JSON.stringify(data));
    const store = createJournalStorage(sql.db);
    const first = store.load();
    const second = store.load();
    assert.equal(first, second);
    await Promise.all([first, second]);
    const edited = editLastSession(data, "110");
    await store.write(edited);
    assert.deepEqual(await store.load(), edited);
  } finally {
    sql.close();
  }
});
