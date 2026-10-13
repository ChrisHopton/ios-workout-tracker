import test from "node:test";
import assert from "node:assert/strict";
import { createJournalStorage } from "../src/data/journalStorage";
import { serializeBackup, parseBackup } from "../src/domain/backup";
import {
  editLastSession,
  historyFixture,
  sqliteHarness,
} from "./storageFixture";

const device = "00000000-0000-4000-8000-000000000001";
async function drain(store: ReturnType<typeof createJournalStorage>) {
  while (await store.sync.pendingCount()) {
    const rows = await store.sync.pending();
    await store.sync.acknowledge(
      rows.map(({ key, revision }) => ({ key, revision })),
      "2026-10-13T12:00:00.000Z",
    );
  }
}
test("sync outbox survives reopening and one set edit queues only changed rows", async () => {
  const sql = sqliteHarness();
  try {
    const store = createJournalStorage(sql.db);
    await store.load();
    const data = historyFixture(3);
    await store.write(data);
    await store.sync.connect(device, "Chris’s iPhone", 100);
    assert.ok((await store.sync.state())!.clock > 100);
    await drain(store);
    await store.write(editLastSession(data, "105"));
    const rows = await store.sync.pending();
    assert.ok(rows.length >= 2 && rows.length < 10);
    assert.ok(rows.every((row) => row.key.includes("session-2")));
    const reopened = createJournalStorage(sql.db);
    await reopened.load();
    assert.deepEqual(await reopened.sync.pending(), rows);
    assert.equal((await reopened.sync.state())!.label, "Chris’s iPhone");
  } finally {
    sql.close();
  }
});
test("failed local save rolls back journal data queue and revision clock together", async () => {
  const sql = sqliteHarness();
  try {
    const store = createJournalStorage(sql.db);
    await store.load();
    const data = historyFixture(1);
    await store.write(data);
    await store.sync.connect(device, "Phone", 0);
    await drain(store);
    const state = await store.sync.state();
    sql.failNext(2);
    await assert.rejects(
      store.write(editLastSession(data, "105")),
      /disk failure/,
    );
    assert.equal(await store.sync.pendingCount(), 0);
    assert.deepEqual(await store.sync.state(), state);
    assert.deepEqual(await store.load(), data);
    await store.write(editLastSession(data, "105"));
    assert.ok(await store.sync.pendingCount());
  } finally {
    sql.close();
  }
});
test("rapid saves coalesce and old acknowledgments cannot remove a newer edit", async () => {
  const sql = sqliteHarness();
  try {
    const store = createJournalStorage(sql.db);
    await store.load();
    let data = historyFixture(1);
    await store.write(data);
    await store.sync.connect(device, "Phone", 0);
    await drain(store);
    data = editLastSession(data, "105");
    await store.write(data);
    const old = await store.sync.pending();
    const key = old.find(
      (row) => row.table === "Sets" && row.values.includes("105"),
    )!.key;
    const before = await store.sync.pendingCount();
    for (const weight of ["110", "115", "120"]) {
      data = editLastSession(data, weight);
      await store.write(data);
    }
    assert.equal(await store.sync.pendingCount(), before);
    await store.sync.acknowledge(
      old.map(({ key, revision }) => ({ key, revision })),
      "2026-10-13T12:00:00.000Z",
    );
    const retained = (await store.sync.pending()).find(
      (row) => row.key === key,
    )!;
    assert.ok(retained.values.includes("120"));
    assert.ok(retained.revision > old.find((row) => row.key === key)!.revision);
  } finally {
    sql.close();
  }
});
test("cleared fields zero values and restored deletions remain distinct", async () => {
  const sql = sqliteHarness();
  try {
    const store = createJournalStorage(sql.db);
    await store.load();
    let data = historyFixture(2);
    await store.write(data);
    await store.sync.connect(device, "Phone", 0);
    await drain(store);
    data = editLastSession(data, "0");
    await store.write(data);
    const zero = (await store.sync.pending()).find((row) =>
      row.values.includes("0"),
    )!;
    assert.ok(zero);
    data = editLastSession(data, "");
    await store.write(data);
    const cleared = (await store.sync.pending()).find(
      (row) => row.key === zero.key,
    )!;
    assert.ok(cleared.values.includes(""));
    await drain(store);
    await store.write(parseBackup(serializeBackup(historyFixture(1))));
    const removed = (await store.sync.pending()).filter((row) => row.deleted);
    assert.ok(removed.length > 1);
    assert.ok(removed.every((row) => row.key.includes("session-1")));
    sql.failCommit();
    await assert.rejects(
      store.sync.acknowledge(removed, "2026-10-13T12:00:00.000Z"),
      /commit failure/,
    );
    assert.equal(
      (await store.sync.pending()).filter((row) => row.deleted).length,
      removed.length,
    );
  } finally {
    sql.close();
  }
});
test("disconnect preserves known cloud keys and reconnect queues offline removals", async () => {
  const sql = sqliteHarness();
  try {
    const store = createJournalStorage(sql.db);
    await store.load();
    await store.write(historyFixture(2));
    await store.sync.connect(device, "Phone", 100);
    await drain(store);
    await store.sync.disconnect();
    await store.write(historyFixture(1));
    assert.equal(await store.sync.pendingCount(), 0);
    await store.sync.connect(device, "Phone renamed", 900);
    const pending = await store.sync.pending();
    assert.ok(
      pending.some((row) => row.deleted && row.key.includes("session-1")),
    );
    assert.ok(pending.every((row) => row.revision > 900));
    assert.equal((await store.sync.state())!.label, "Phone renamed");
  } finally {
    sql.close();
  }
});
test("phone label updates only People and backup content excludes sync metadata", async () => {
  const sql = sqliteHarness();
  try {
    const store = createJournalStorage(sql.db);
    await store.load();
    const data = historyFixture(1);
    await store.write(data);
    await store.sync.connect(device, "Same name", 0);
    await drain(store);
    await store.sync.setLabel("Renamed");
    const pending = await store.sync.pending();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].table, "People");
    assert.equal(pending[0].values[0], "Renamed");
    const backup = serializeBackup(await store.load());
    assert.ok(!backup.includes(device));
    assert.ok(!backup.includes("sync_outbox"));
    assert.deepEqual(parseBackup(backup), data);
  } finally {
    sql.close();
  }
});
test("concurrent saves and sync operations serialize without losing current data", async () => {
  const sql = sqliteHarness();
  try {
    const store = createJournalStorage(sql.db);
    await store.load();
    const data = historyFixture(1);
    await store.write(data);
    await Promise.all([
      store.sync.connect(device, "Phone", 0),
      store.write(editLastSession(data, "150")),
    ]);
    assert.equal(
      (await store.load()).sessions[0].exercises[0].sets[0].weight,
      "150",
    );
    assert.ok(
      (await store.sync.pending()).some((row) => row.values.includes("150")),
    );
  } finally {
    sql.close();
  }
});

test("sync writes use the isolated transaction connection", async () => {
  const sql = sqliteHarness();
  let inside = false;
  try {
    const guarded = new Proxy(sql.db, {
      get(target, name: keyof typeof sql.db) {
        if (name === "withExclusiveTransactionAsync")
          return async (
            task: Parameters<typeof sql.db.withExclusiveTransactionAsync>[0],
          ) => {
            await sql.db.withExclusiveTransactionAsync(async (tx) => {
              inside = true;
              try {
                await task({ ...tx });
              } finally {
                inside = false;
              }
            });
          };
        const member = target[name];
        if (typeof member !== "function") return member;
        return (...args: unknown[]) => {
          assert.equal(
            inside,
            false,
            "original connection must not run inside an exclusive transaction",
          );
          return Reflect.apply(member, target, args);
        };
      },
    });
    const store = createJournalStorage(guarded);
    await store.load();
    const data = historyFixture(2);
    await store.write(data);
    await store.sync.connect(device, "Phone", 0);
    await drain(store);
    await store.write(editLastSession(data, "105"));
    await store.sync.setLabel("Renamed");
    await drain(store);
  } finally {
    sql.close();
  }
});
test("large initial upload space is reclaimed after durable acknowledgments", async () => {
  const sql = sqliteHarness();
  try {
    const store = createJournalStorage(sql.db);
    await store.load();
    const data = historyFixture(250);
    await store.write(data);
    await store.sync.connect(device, "Phone", 0);
    const peak = Number(
      sql.native.prepare("PRAGMA page_count").get()?.page_count,
    );
    await drain(store);
    const settled = Number(
      sql.native.prepare("PRAGMA page_count").get()?.page_count,
    );
    assert.ok(settled < peak);
    assert.equal(await store.sync.pendingCount(), 0);
    assert.deepEqual(await store.load(), data);
  } finally {
    sql.close();
  }
});
