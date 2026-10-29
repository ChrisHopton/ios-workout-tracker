import { initialData } from "../src/domain/library";
import test from "node:test";
import assert from "node:assert/strict";
import { createJournalStorage } from "../src/data/journalStorage";
import {
  MAX_BACKUP_BYTES, parseBackup, serializeBackup, serializeStoredBackup,
  upgradeData, validateLegacyData,
} from "../src/domain/backup";
import { historyFixture, sqliteHarness } from "./storageFixture";

function largeLegacyJournal() {
  const data: any = historyFixture(3500);
  data.schemaVersion = 1;
  data.settings = { age: "", gender: "", heightCm: null, unit: "lb" };
  delete data.bodyWeights;
  for (const session of data.sessions) for (const entry of session.exercises) {
    delete entry.suggestion.algorithmVersion;
    for (const set of entry.sets) delete set.classification;
  }
  return validateLegacyData(data);
}

test("large old journals reset without making recovery copies or relaxing portable backup limits", async (t) => {
  const original = largeLegacyJournal();
  const text = JSON.stringify(original);
  assert.ok(Buffer.byteLength(text) > MAX_BACKUP_BYTES);
  assert.equal(serializeStoredBackup(original), text);
  assert.throws(() => parseBackup(text), /10 MiB/);
  assert.throws(() => serializeBackup(upgradeData(original)), /10 MiB/);

  for (const layout of ["app_state", "journal_meta"] as const) {
    await t.test(layout, async () => {
      const sql = sqliteHarness();
      try {
        const version = layout === "app_state" ? 1 : 4;
        const { sessions, ...metadata } = original;
        if (layout === "app_state") {
          sql.native.exec("CREATE TABLE app_state (id INTEGER PRIMARY KEY, value TEXT NOT NULL); PRAGMA user_version = 1;");
          sql.native.prepare("INSERT INTO app_state VALUES (1, ?)").run(text);
        } else {
          sql.native.exec("CREATE TABLE journal_meta (id INTEGER PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE workout_sessions (id TEXT PRIMARY KEY, position INTEGER NOT NULL, value TEXT NOT NULL); PRAGMA user_version = 4;");
          sql.native.prepare("INSERT INTO journal_meta VALUES (1, ?)").run(JSON.stringify(metadata));
          const insert = sql.native.prepare("INSERT INTO workout_sessions VALUES (?, ?, ?)");
          for (const [position, session] of sessions.entries()) insert.run(session.id, position, JSON.stringify(session));
        }
        let backups = 0;
        const store = createJournalStorage(sql.db, { beforeMigration: async () => { backups++; } });
        await store.sync.state();
        sql.failCommit();
        await assert.rejects(store.load(), /commit failure/);
        assert.equal(sql.native.prepare("PRAGMA user_version").get()!.user_version, version);
        if (layout === "app_state") assert.equal(sql.native.prepare("SELECT value FROM app_state").get()!.value, text);
        else assert.equal(sql.native.prepare("SELECT COUNT(*) AS count FROM workout_sessions").get()!.count, sessions.length);
        const result = await store.load();
        assert.deepEqual(result, initialData());
        assert.equal(backups, 0);
        assert.equal(sql.native.prepare("PRAGMA user_version").get()!.user_version, 6);
        assert.deepEqual(await createJournalStorage(sql.db).load(), result);
      } finally { sql.close(); }
    });
  }
});
