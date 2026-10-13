import test from "node:test";
import assert from "node:assert/strict";
import { SaveQueue } from "../src/data/saveQueue";
function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
test("serializes rapid writes so stale snapshots cannot overwrite newer snapshots", async () => {
  const gate = deferred();
  const events: string[] = [];
  let active = 0;
  const queue = new SaveQueue<number>(async (snapshot) => {
    assert.equal(active++, 0);
    events.push(`start ${snapshot}`);
    if (snapshot === 1) await gate.promise;
    events.push(`end ${snapshot}`);
    active--;
  });
  const first = queue.enqueue(1);
  await Promise.resolve();
  const second = queue.enqueue(2);
  const third = queue.enqueue(3);
  await Promise.resolve();
  assert.deepEqual(events, ["start 1"]);
  gate.release();
  await Promise.all([first, second, third]);
  await queue.flush();
  assert.deepEqual(events, ["start 1", "end 1", "start 3", "end 3"]);
});
test("flush exposes last failure and retry writes the latest snapshot", async () => {
  let fails = true;
  const values: number[] = [];
  const queue = new SaveQueue<number>(async (value) => {
    values.push(value);
    if (fails) throw new Error("disk full");
  });
  await assert.rejects(queue.enqueue(7), /disk full/);
  await assert.rejects(queue.flush(), /disk full/);
  fails = false;
  await queue.retry();
  await queue.flush();
  assert.deepEqual(values, [7, 7]);
});
test("failure does not poison a later save and newest success clears failure", async () => {
  const values: number[] = [];
  const queue = new SaveQueue<number>(async (value) => {
    values.push(value);
    if (value === 1) throw new Error("first fails");
  });
  const first = queue.enqueue(1);
  await Promise.resolve();
  const second = queue.enqueue(2);
  await assert.rejects(first, /first fails/);
  await second;
  await queue.flush();
  await queue.retry();
  assert.deepEqual(values, [1, 2, 2]);
});
test("retry chooses the newest failed snapshot rather than the earlier one", async () => {
  let fail = true;
  const values: number[] = [];
  const queue = new SaveQueue<number>(async (value) => {
    values.push(value);
    if (fail) throw new Error("offline storage");
  });
  const first = queue.enqueue(1).catch(() => undefined);
  await Promise.resolve();
  const second = queue.enqueue(2).catch(() => undefined);
  await Promise.all([first, second]);
  fail = false;
  await queue.retry();
  await queue.flush();
  assert.deepEqual(values, [1, 2, 2]);
});
test("flush includes writes enqueued while waiting and no-op retry before first write is safe", async () => {
  const gate = deferred();
  const written: number[] = [];
  const queue = new SaveQueue<number>(async (value) => {
    if (value === 1) await gate.promise;
    written.push(value);
  });
  await queue.retry();
  await queue.flush();
  const first = queue.enqueue(1);
  await Promise.resolve();
  const flush = queue.flush();
  const second = queue.enqueue(2);
  gate.release();
  await flush;
  assert.deepEqual(written, [1, 2]);
  await Promise.all([first, second]);
});
test("writer synchronous throws also recover", async () => {
  let fails = true;
  const queue = new SaveQueue<number>(() => {
    if (fails) throw new Error("synchronous error");
    return Promise.resolve();
  });
  await assert.rejects(queue.enqueue(1), /synchronous error/);
  fails = false;
  await queue.enqueue(2);
  await queue.flush();
});
test("successful restore updates the retry snapshot and never replays the old journal", async () => {
  let disk = "original";
  const written: string[] = [];
  const queue = new SaveQueue<string>(async (value) => {
    written.push(value);
    disk = value;
  });
  await queue.enqueue("edited");
  await queue.replace("imported", "edited");
  await queue.retry();
  await queue.flush();
  assert.equal(disk, "imported");
  assert.deepEqual(written, ["edited", "imported", "imported"]);
});
test("failed restore keeps current data and retry writes current, never imported", async () => {
  let disk = "current";
  const written: string[] = [];
  const queue = new SaveQueue<string>(async (value) => {
    written.push(value);
    if (value === "imported") throw new Error("restore failed");
    disk = value;
  });
  // Restore failure must recover even before the first edit
  await assert.rejects(queue.replace("imported", "current"), /restore failed/);
  assert.equal(disk, "current");
  await assert.rejects(queue.flush(), /restore failed/);
  await queue.retry();
  await queue.flush();
  assert.equal(disk, "current");
  assert.deepEqual(written, ["imported", "current"]);
});
test("restore waits for prior autosaves and blocks competing retry, edits, and restores", async () => {
  const gate = deferred();
  const written: string[] = [];
  const queue = new SaveQueue<string>(async (value) => {
    if (value === "editing") await gate.promise;
    written.push(value);
  });
  const save = queue.enqueue("editing");
  const restore = queue.replace("imported", "editing");
  await assert.rejects(queue.retry(), /finish restoring/);
  await assert.rejects(queue.enqueue("competing edit"), /finish restoring/);
  await assert.rejects(
    queue.replace("competing import", "editing"),
    /already running/,
  );
  assert.deepEqual(written, []);
  gate.release();
  await Promise.all([save, restore]);
  await queue.retry();
  assert.deepEqual(written, ["editing", "imported", "imported"]);
});
test("restore failure preserves the latest pre-restore draft even when its save failed", async () => {
  let failing = true;
  let disk = "original";
  const writes: string[] = [];
  const queue = new SaveQueue<string>(async (value) => {
    writes.push(value);
    if (failing) throw new Error("storage unavailable");
    disk = value;
  });
  await assert.rejects(queue.enqueue("unsaved draft"), /storage unavailable/);
  await assert.rejects(
    queue.replace("imported", "unsaved draft"),
    /storage unavailable/,
  );
  assert.equal(disk, "original");
  failing = false;
  await queue.retry();
  assert.equal(disk, "unsaved draft");
  assert.deepEqual(writes, ["unsaved draft", "imported", "unsaved draft"]);
});

test("a burst shares one pending save and settles only after its newest snapshot is durable", async () => {
  const gate = deferred();
  const written: number[] = [];
  const queue = new SaveQueue<number>(async (value) => {
    await gate.promise;
    written.push(value);
  });
  const saves = Array.from({ length: 100 }, (_, index) => queue.enqueue(index));
  let settled = false;
  void saves[0].then(() => {
    settled = true;
  });
  await Promise.resolve();
  assert.equal(settled, false);
  gate.release();
  await Promise.all(saves);
  await queue.flush();
  assert.deepEqual(written, [99]);
  assert.equal(settled, true);
});
