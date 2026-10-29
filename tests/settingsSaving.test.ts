import test from "node:test";
import assert from "node:assert/strict";
import { SaveAction } from "../src/components/saveAction";
import { convertBodyWeightDraft, removeBodyWeightDraft, saveBodyWeightDraft, type BodyWeightDraft, type SavedBodyWeightDraft } from "../src/components/bodyWeightDraft";
import { SaveQueue } from "../src/data/saveQueue";
import { snapshot } from "../src/data/snapshot";
import { initialData } from "../src/domain/library";
import { removeBodyWeight } from "../src/domain/bodyWeight";
import { convertWeight } from "../src/domain/recommendations";
import type { AppData } from "../src/domain/types";

const TODAY = "2026-10-22";
function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function draft(weight = "180") {
  return { date: TODAY, weight, unit: "lb" as const, canonicalKg: null };
}

test("save feedback waits for the durable flush and ignores repeated taps while writing", async () => {
  const gate = deferred();
  const action = new SaveAction();
  const queue = new SaveQueue<number>(async () => gate.promise);
  let mutations = 0;
  const change = () => { mutations++; void queue.enqueue(mutations).catch(() => {}); };
  const first = action.run(change, () => queue.flush());
  assert.equal(action.getSnapshot().status, "saving");
  assert.equal(await action.run(change, () => queue.flush()), false);
  action.edited();
  assert.equal(action.getSnapshot().status, "saving");
  assert.equal(mutations, 1);
  await Promise.resolve();
  assert.equal(action.getSnapshot().status, "saving");
  gate.resolve();
  assert.equal(await first, true);
  assert.deepEqual(action.getSnapshot(), { status: "saved", error: null });
  await Promise.resolve();
  assert.equal(action.getSnapshot().status, "saved");
  action.edited();
  assert.deepEqual(action.getSnapshot(), { status: "idle", error: null });
});

test("a delayed failure preserves draft and record identity, then retry reports saved only after flush", async () => {
  const firstWrite = deferred();
  const retryWrite = deferred();
  const action = new SaveAction();
  let data = initialData();
  let attempts = 0;
  const input = draft("182.5");
  const queue = new SaveQueue<AppData>(async () => {
    attempts++;
    await (attempts === 1 ? firstWrite.promise : retryWrite.promise);
  });
  const change = () => {
    data = saveBodyWeightDraft(data, input, TODAY).data;
    void queue.enqueue(data).catch(() => {});
  };
  const first = action.run(change, () => queue.flush());
  const id = data.bodyWeights[0].id;
  firstWrite.reject(new Error("Disk full"));
  assert.equal(await first, false);
  assert.deepEqual(action.getSnapshot(), { status: "error", error: "Disk full" });
  assert.equal(input.weight, "182.5");
  assert.equal(data.bodyWeights[0].id, id);

  const retried = action.run(change, () => queue.flush());
  assert.equal(action.getSnapshot().status, "saving");
  assert.equal(data.bodyWeights.length, 1);
  assert.equal(data.bodyWeights[0].id, id);
  retryWrite.resolve();
  assert.equal(await retried, true);
  assert.equal(action.getSnapshot().status, "saved");
  assert.equal(attempts, 2);
});

test("validation failures do not flush and edits clear only the affected form's feedback", async () => {
  const profile = new SaveAction();
  const measurement = new SaveAction();
  let flushes = 0;
  assert.equal(await profile.run(() => {}, async () => {}), true);
  assert.equal(await measurement.run(() => { throw new Error("Enter a valid weight"); }, async () => { flushes++; }), false);
  assert.equal(flushes, 0);
  assert.equal(measurement.getSnapshot().status, "error");
  measurement.edited();
  assert.equal(measurement.getSnapshot().error, null);
  assert.equal(profile.getSnapshot().status, "saved");
});

test("quick today's saves update the existing measurement without replacing its ID", () => {
  const first = saveBodyWeightDraft(initialData(), draft("180"), TODAY);
  const second = saveBodyWeightDraft(first.data, draft("181"), TODAY);
  assert.equal(second.data.bodyWeights.length, 1);
  assert.equal(second.entry.id, first.entry.id);
  assert.equal(second.entry.date, TODAY);
  assert.equal(second.entry.weightKg, convertWeight(181, "lb", "kg"));
  const nextDay = saveBodyWeightDraft(second.data, { ...draft("182"), date: "2026-10-23" }, "2026-10-23");
  assert.equal(nextDay.data.bodyWeights.length, 2);
  assert.notEqual(nextDay.entry.id, first.entry.id);
});

test("history edits preserve IDs, reject occupied dates, and retain precise kilograms", () => {
  const precise = 81.23456789;
  const older = saveBodyWeightDraft(initialData(), {
    date: "2026-10-20", weight: String(precise), unit: "kg", canonicalKg: null,
  }, TODAY);
  const current = saveBodyWeightDraft(older.data, draft("181"), TODAY);
  const pounds = convertBodyWeightDraft(String(precise), "kg", "lb", precise);
  const moved = saveBodyWeightDraft(current.data, {
    date: "2026-10-21", weight: pounds.weight, unit: "lb",
    id: older.entry.id, canonicalKg: pounds.canonicalKg,
  }, TODAY);
  assert.equal(moved.entry.id, older.entry.id);
  assert.equal(moved.entry.weightKg, precise);
  assert.equal(moved.data.bodyWeights.length, 2);
  assert.throws(() => saveBodyWeightDraft(moved.data, {
    ...draft("185"), id: older.entry.id,
  }, TODAY), /already exists/);
  assert.throws(() => saveBodyWeightDraft(moved.data, {
    ...draft(), date: "2026-10-21",
  }, TODAY), /already exists/);
  assert.equal(removeBodyWeight(moved.data, older.entry.id).bodyWeights.length, 1);
  assert.throws(() => saveBodyWeightDraft(removeBodyWeight(moved.data, older.entry.id), {
    ...draft(), id: older.entry.id,
  }, TODAY), /no longer exists/);
});

test("repeated unit toggles preserve canonical kg and malformed text remains editable", () => {
  let value = { weight: "179.123456", canonicalKg: null as number | null };
  const exact = convertWeight(Number(value.weight), "lb", "kg");
  for (let index = 0; index < 20; index++) {
    value = convertBodyWeightDraft(value.weight, "lb", "kg", value.canonicalKg);
    value = convertBodyWeightDraft(value.weight, "kg", "lb", value.canonicalKg);
  }
  const saved = saveBodyWeightDraft(initialData(), {
    ...draft(value.weight), canonicalKg: value.canonicalKg,
  }, TODAY);
  assert.equal(saved.entry.weightKg, exact);
  assert.deepEqual(convertBodyWeightDraft("bad input", "lb", "kg", null), { weight: "bad input", canonicalKg: null });
  for (const weight of ["", "-1", "0", "no", "1200"]) {
    assert.throws(() => saveBodyWeightDraft(initialData(), draft(weight), TODAY));
  }
  assert.throws(() => saveBodyWeightDraft(initialData(), { ...draft(), date: "2026-10-23" }, TODAY), /future/);
  assert.throws(() => saveBodyWeightDraft(initialData(), { ...draft(), date: "invalid" }, TODAY));
});

test("a failed delete remains retryable without changing a separate measurement draft", async () => {
  const saved = saveBodyWeightDraft(initialData(), draft(), TODAY);
  const input = { ...draft("184"), date: "2026-10-21" };
  let data = saved.data;
  let fail = true;
  const action = new SaveAction();
  const queue = new SaveQueue<AppData>(async () => { if (fail) throw new Error("Storage unavailable"); });
  const change = () => {
    data = removeBodyWeight(data, saved.entry.id);
    void queue.enqueue(data).catch(() => {});
  };
  assert.equal(await action.run(change, () => queue.flush()), false);
  assert.equal(action.getSnapshot().status, "error");
  assert.equal(input.weight, "184");
  assert.equal(input.date, "2026-10-21");
  fail = false;
  assert.equal(await action.run(change, () => queue.flush()), true);
  assert.equal(data.bodyWeights.length, 0);
  assert.equal(action.getSnapshot().status, "saved");
});

test("backdated optimistic insertion survives delayed flush failure, retry, and later edits with one ID", async () => {
  const action = new SaveAction();
  let retained: SavedBodyWeightDraft | null = null;
  const failedWrite = deferred();
  let data = snapshot(initialData());
  let attempts = 0;
  let input = { ...draft("183"), date: "2026-10-20" };
  const queue = new SaveQueue<AppData>(async () => {
    attempts++;
    if (attempts === 1) await failedWrite.promise;
  });
  const change = () => {
    const result = saveBodyWeightDraft(data, input, TODAY, retained);
    retained = { id: result.entry.id, date: result.entry.date };
    data = snapshot(result.data, data);
    void queue.enqueue(data).catch(() => {});
  };
  const first = action.run(change, () => queue.flush());
  const insertedId = data.bodyWeights[0].id;
  assert.equal((retained as SavedBodyWeightDraft | null)?.id, insertedId);
  failedWrite.reject(new Error("Delayed write failed"));
  assert.equal(await first, false);
  assert.equal(action.getSnapshot().status, "error");
  assert.equal(data.bodyWeights.length, 1);

  assert.equal(await action.run(change, () => queue.flush()), true);
  assert.equal(data.bodyWeights.length, 1);
  assert.equal(data.bodyWeights[0].id, insertedId);
  input = { ...input, weight: "184" };
  action.edited();
  assert.equal(await action.run(change, () => queue.flush()), true);
  assert.equal(data.bodyWeights.length, 1);
  assert.equal(data.bodyWeights[0].id, insertedId);
  assert.equal(data.bodyWeights[0].weightKg, convertWeight(184, "lb", "kg"));
});

test("a retained quick entry ID is not reused after midnight", () => {
  let retained: SavedBodyWeightDraft | null = null;
  const first = saveBodyWeightDraft(initialData(), draft(), TODAY, retained);
  retained = { id: first.entry.id, date: first.entry.date };
  const nextDate = "2026-10-23";
  const second = saveBodyWeightDraft(first.data, { ...draft("181"), date: nextDate }, nextDate, retained);
  retained = { id: second.entry.id, date: second.entry.date };
  assert.equal(second.data.bodyWeights.length, 2);
  assert.notEqual(second.entry.id, first.entry.id);
  assert.equal(second.data.bodyWeights[0].date, TODAY);
  const third = saveBodyWeightDraft(second.data, { ...draft("182"), date: nextDate }, nextDate, retained);
  assert.equal(third.data.bodyWeights.length, 2);
  assert.equal(third.entry.id, second.entry.id);
});

test("profile retry re-enqueues the same draft after an optimistic snapshot's flush failed", async () => {
  const action = new SaveAction();
  let data = snapshot(initialData());
  const profileDraft = { dateOfBirth: "1993-01-01", gender: "Female" as const, heightCm: 177.123456 };
  let writes = 0;
  const queue = new SaveQueue<AppData>(async () => {
    if (++writes === 1) throw new Error("Disk full");
  });
  const change = () => {
    const next = snapshot({ ...data, settings: { ...data.settings, ...profileDraft } }, data);
    assert.notEqual(next, data);
    data = next;
    void queue.enqueue(data).catch(() => {});
  };
  assert.equal(await action.run(change, () => queue.flush()), false);
  assert.equal(action.getSnapshot().status, "error");
  assert.deepEqual(profileDraft, { dateOfBirth: "1993-01-01", gender: "Female" as const, heightCm: 177.123456 });
  assert.equal(await action.run(change, () => queue.flush()), true);
  assert.equal(writes, 2);
  assert.equal(action.getSnapshot().status, "saved");
  assert.equal(data.settings.gender, profileDraft.gender);
  assert.equal(data.settings.heightCm, profileDraft.heightCm);
});

for (const editingHistory of [false, true]) {
  test(`${editingHistory ? "history" : "quick"} draft can save after its deletion fails and the global queue retries`, async () => {
    const measurement = new SaveAction();
    const deletion = new SaveAction();
    let retained: SavedBodyWeightDraft | null = null;
    let input: BodyWeightDraft = { ...draft("180"), date: editingHistory ? "2026-10-21" : TODAY };
    let data = snapshot(initialData());
    let persisted = data;
    let writes = 0;
    const queue = new SaveQueue<AppData>(async (next) => {
      if (++writes === 2) throw new Error("Storage unavailable");
      persisted = next;
    });
    const save = () => measurement.run(() => {
      const result = saveBodyWeightDraft(data, input, TODAY, retained);
      retained = { id: result.entry.id, date: result.entry.date };
      data = snapshot(result.data, data);
      void queue.enqueue(data).catch(() => {});
    }, () => queue.flush());
    assert.equal(await save(), true);
    const originalId = data.bodyWeights[0].id;
    if (editingHistory) input = { ...input, id: originalId };

    assert.equal(await deletion.run(() => {
      const result = removeBodyWeightDraft(data, originalId, input.id, retained);
      retained = result.saved;
      input = { ...input, id: result.id };
      if (result.detached) measurement.edited();
      data = snapshot(result.data, data);
      void queue.enqueue(data).catch(() => {});
    }, () => queue.flush()), false);
    assert.equal(data.bodyWeights.length, 0);
    assert.equal(persisted.bodyWeights.length, 1);
    assert.equal(retained, null);
    assert.equal(input.id, undefined);
    assert.equal(input.weight, "180");
    assert.equal(input.date, editingHistory ? "2026-10-21" : TODAY);
    assert.equal(measurement.getSnapshot().status, "idle");

    await queue.retry();
    await queue.flush();
    assert.equal(persisted.bodyWeights.length, 0);
    input = { ...input, weight: "181" };
    measurement.edited();
    assert.equal(await save(), true);
    assert.equal(persisted.bodyWeights.length, 1);
    assert.notEqual(persisted.bodyWeights[0].id, originalId);
    assert.equal(persisted.bodyWeights[0].date, input.date);
    assert.equal(persisted.bodyWeights[0].weightKg, convertWeight(181, "lb", "kg"));
  });
}