import test from "node:test";
import assert from "node:assert/strict";
import { createAutomaticBootstrap } from "../src/sync/bootstrap";
import { SyncController, type SyncControllerOptions, type SyncSecrets } from "../src/sync/controller";
import { createUploadRuntime } from "../src/sync/runtime.web";
import { loadData, writeData, syncRepository } from "../src/data/persistence.web";
import { loadCredentials, saveCredentials, removeCredentials } from "../src/sync/credentials.web";
import { validateCredentials } from "../src/sync/protocol";
import type { SyncRequest, SyncTransport } from "../src/sync/transport";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
}
class Scheduler {
  now = Date.UTC(2026, 9, 19, 12);
  private nextId = 0;
  readonly jobs = new Map<number, { at: number; callback: () => void }>();
  readonly options: SyncControllerOptions = {
    now: () => this.now,
    setTimeout: (callback, delay) => {
      const id = ++this.nextId;
      this.jobs.set(id, { at: this.now + delay, callback });
      return id;
    },
    clearTimeout: (id) => { this.jobs.delete(id as number); },
  };
  runNext() {
    const job = [...this.jobs].sort(([, left], [, right]) => left.at - right.at)[0];
    assert.ok(job, "Automatic sync must schedule an upload");
    this.jobs.delete(job[0]);
    this.now = job[1].at;
    job[1].callback();
  }
}
async function completeScheduledSync(controller: SyncController, scheduler: Scheduler) {
  let unsubscribe = () => {};
  const completed = new Promise<void>((resolve, reject) => {
    unsubscribe = controller.subscribe(() => {
      const state = controller.getSnapshot();
      if (state.error) reject(new Error(state.error));
      if (state.status === "synced" && state.initialComplete && !state.busy) resolve();
    });
  });
  try {
    scheduler.runNext();
    await completed;
  } finally {
    unsubscribe();
  }
}

test("browser bootstrap uploads initial history and incremental edits entirely through its local mock", { timeout: 5_000 }, async () => {
  const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const originalFetch = globalThis.fetch;
  const storage = new MemoryStorage();
  const requests: SyncRequest[] = [];
  const scheduler = new Scheduler();
  const secrets: SyncSecrets = {
    load: loadCredentials, save: saveCredentials, remove: removeCredentials,
  };
  let controller: SyncController | undefined;
  let fetchCalls = 0;
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  globalThis.fetch = async () => {
    fetchCalls++;
    throw new Error("Browser preview must not contact the network");
  };
  try {
    const data = await loadData();
    const exercise = data.exercises[0];
    const history = {
      ...data,
      sessions: [{
        id: "history-session", date: "2026-10-18", title: "Previous workout",
        templateId: "history-plan", unit: "lb" as const, status: "completed" as const,
        startedAt: "2026-10-18T12:00:00.000Z", updatedAt: "2026-10-18T12:30:00.000Z",
        finishedAt: "2026-10-18T12:30:00.000Z",
        exercises: [{
          exercise,
          target: { exerciseId: exercise.id, sets: 1, repMin: 8, repMax: 12 },
          suggestion: { algorithmVersion: 2 as const, weights: [100], reason: "Logged workout" },
          sets: [{ classification: "working" as const, weight: "100", reps: "10", status: "completed" as const }],
        }],
      }],
    };
    await writeData(history);
    const runtime = createUploadRuntime();
    let nextId = 0;
    const bootstrap = createAutomaticBootstrap(syncRepository, secrets, {
      ...runtime,
      createId: () => "00000000-0000-4000-8000-" + String(++nextId).padStart(12, "0"),
    });

    assert.equal(await bootstrap(() => true), true);
    const credentials = await loadCredentials();
    assert.ok(credentials);
    assert.equal(validateCredentials(credentials).version, 3);
    assert.deepEqual(Object.keys(credentials).sort(), [
      "apiKey", "deviceId", "generationId", "layout", "projectId", "refreshToken", "uid", "version",
    ]);
    const staged = await syncRepository.pendingEnrollment();
    assert.ok(staged);
    assert.equal(staged.initialComplete, false);
    assert.equal(staged.label, "Browser preview · 000001");
    assert.equal(await syncRepository.state(), null);

    const transport: SyncTransport = async (request, identity, canSend) => {
      requests.push(structuredClone(request));
      return runtime.transport(request, identity, canSend);
    };
    controller = new SyncController(syncRepository, secrets, transport, scheduler.options);
    assert.equal(await controller.initialize(), true);
    assert.equal(controller.getSnapshot().initialComplete, false);
    await completeScheduledSync(controller, scheduler);

    const initialState = controller.getSnapshot();
    assert.equal(initialState.status, "synced");
    assert.equal(initialState.initialComplete, true);
    assert.equal(initialState.pending, 0);
    assert.equal(initialState.bound, true);
    assert.equal(initialState.error, null);
    assert.equal(await syncRepository.pendingEnrollment(), null);
    assert.equal(await syncRepository.pendingCount(), 0);
    assert.equal(await syncRepository.inFlight(), null);
    assert.equal(requests[0].action, "bind");
    const uploads = requests.filter((request) => request.action === "upload");
    const initialChanges = uploads.flatMap((request) => request.changes);
    assert.ok(uploads.every((request) => request.changes.length <= 10));
    assert.equal(initialChanges.length, data.exercises.length + 4);
    assert.equal(initialChanges.find((change) => change.kind === "workout")!.payload.id, "history-session");
    const loggedExercise = initialChanges.find((change) => change.kind === "workout_exercise");
    assert.ok(loggedExercise);
    assert.deepEqual(loggedExercise.payload.sets, history.sessions[0].exercises[0].sets);
    assert.deepEqual(uploads.at(-1)!.changes.map((change) => change.kind), ["completion"]);

    const requestCount = requests.length;
    const initialProfile = initialChanges.find((change) => change.kind === "profile")!;
    await writeData({ ...history, settings: { ...history.settings, gender: "Female" } });
    assert.equal(await syncRepository.pendingCount(), 1);
    controller.changed();
    await completeScheduledSync(controller, scheduler);

    const incremental = requests.slice(requestCount);
    assert.equal(incremental.length, 1);
    assert.equal(incremental[0].action, "upload");
    if (incremental[0].action !== "upload") throw new Error("Expected incremental upload");
    assert.equal(incremental[0].changes.length, 1);
    const profile = incremental[0].changes[0];
    assert.equal(profile.kind, "profile");
    assert.equal(profile.payload.gender, "Female");
    assert.equal(profile.key, initialProfile.key);
    assert.ok(profile.revision > initialProfile.revision);
    assert.equal(controller.getSnapshot().status, "synced");
    assert.equal(controller.getSnapshot().initialComplete, true);
    assert.equal(controller.getSnapshot().pending, 0);
    assert.equal(controller.getSnapshot().lastSyncedAt, new Date(scheduler.now).toISOString());
    assert.equal((await loadData()).settings.gender, "Female");
    assert.equal(scheduler.jobs.size, 0);
    assert.equal(fetchCalls, 0);
  } finally {
    controller?.dispose();
    await removeCredentials();
    globalThis.fetch = originalFetch;
    if (storageDescriptor) Object.defineProperty(globalThis, "localStorage", storageDescriptor);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});


test("browser fresh start removes old content once and preserves the new journal", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  try {
    storage.setItem("workout-browser-preview-v1", "old or corrupt personal journal");
    storage.setItem("workout-browser-before-v1-to-v2", "private recovery copy");
    const fresh = await loadData();
    assert.equal(fresh.schemaVersion, 3); assert.equal(fresh.sessions.length, 0); assert.equal(fresh.settings.firstName, "");
    assert.equal(storage.getItem("workout-browser-preview-v1"), null);
    assert.equal(storage.getItem("workout-browser-before-v1-to-v2"), null);
    const updated = { ...fresh, settings: { ...fresh.settings, firstName: "New profile" } };
    await writeData(updated); assert.deepEqual(await loadData(), updated);
    storage.removeItem("workout-browser-preview-v3");
    await assert.rejects(loadData(), /journal is missing/);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
