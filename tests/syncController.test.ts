import test from "node:test";
import assert from "node:assert/strict";
import {
  SyncController, type SyncControllerOptions, type SyncLocalState,
  type SyncRepository, type SyncSecrets,
} from "../src/sync/controller";
import {
  makeCommitBody, SyncError, type SyncRequest, type SyncTransport,
} from "../src/sync/transport";
import {
  makeBatch, makeDocumentKey, type CommitReceipt, type DocumentChange,
  type SyncCredentials, type SyncIdentity, type UploadBatch,
} from "../src/sync/protocol";
import { createPreviewTransport } from "../src/sync/previewTransport";

const DEVICE = "11111111-1111-4111-8111-111111111111";
const GENERATION = "22222222-2222-4222-8222-222222222222";
const INSTALLATION = "33333333-3333-4333-8333-333333333333";
const OTHER_INSTALLATION = "44444444-4444-4444-8444-444444444444";
const CREDENTIALS: SyncCredentials = {
  version: 1, projectId: "workout-test", apiKey: "a".repeat(39),
  deviceId: DEVICE, generationId: GENERATION, uid: "phone_one",
  email: "phone-one@example.com", password: "private-test-password",
};
function code(value = CREDENTIALS): string {
  return `WORKOUTFB1.${Buffer.from(JSON.stringify(value)).toString("base64url")}`;
}
function change(revision = 1, id = "one", deviceId = DEVICE): DocumentChange {
  return {
    key: makeDocumentKey("workout", deviceId, id), kind: "workout",
    payload: { title: "Workout", value: String(revision) }, revision, deleted: false,
  };
}
function success(request: SyncRequest): CommitReceipt {
  return { acknowledged: request.action === "bind" ? [] :
    request.changes.map(({ key, revision }) => ({ key, revision })) };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
async function settle(): Promise<void> {
  for (let index = 0; index < 80; index++) await Promise.resolve();
}
class FakeTime {
  time = Date.UTC(2026, 9, 13, 12);
  id = 0;
  jobs = new Map<number, { at: number; callback: () => void }>();
  options: SyncControllerOptions = {
    now: () => this.time, createInstallationId: () => INSTALLATION,
    setTimeout: (callback, delay) => {
      const id = ++this.id;
      this.jobs.set(id, { at: this.time + delay, callback });
      return id;
    },
    clearTimeout: (handle) => { this.jobs.delete(handle as number); },
  };
  async advance(milliseconds: number): Promise<void> {
    const end = this.time + milliseconds;
    for (;;) {
      const next = [...this.jobs].filter(([, job]) => job.at <= end)
        .sort((left, right) => left[1].at - right[1].at)[0];
      if (!next) break;
      this.time = next[1].at;
      this.jobs.delete(next[0]);
      next[1].callback();
      await settle();
    }
    this.time = end;
    await settle();
  }
}
function same(left: SyncIdentity | null, right: SyncIdentity): boolean {
  return left !== null && left.projectId === right.projectId &&
    left.deviceId === right.deviceId && left.generationId === right.generationId;
}
class PersistentRepository implements SyncRepository {
  local: SyncLocalState | null = {
    projectId: CREDENTIALS.projectId, deviceId: DEVICE, generationId: GENERATION,
    installationId: INSTALLATION, label: "My phone", clock: 1,
    lastSyncedAt: null, enabled: true, bound: true, initialComplete: true,
  };
  staged: SyncLocalState | null = null;
  rows = new Map<string, DocumentChange>();
  frozen: UploadBatch | null = null;
  batchId = 0;
  acknowledgements: { id: string; acks: CommitReceipt["acknowledged"] }[] = [];
  reservations: { writes: number; at: number }[] = [];
  remaining = 8_000;
  resetAt = Number.MAX_SAFE_INTEGER;
  events: string[] = [];
  put(row: DocumentChange): void {
    this.rows.set(row.key, structuredClone(row));
    if (this.local) this.local.clock = Math.max(this.local.clock, row.revision);
  }
  async state() { return structuredClone(this.local); }
  async pendingEnrollment() { return structuredClone(this.staged); }
  async prepareEnrollment(identity: SyncIdentity, label: string, installationId: string) {
    this.events.push("prepare");
    const existing = same(this.local, identity) ? this.local :
      same(this.staged, identity) ? this.staged : null;
    this.staged = {
      ...identity, installationId: existing?.installationId ?? installationId,
      label, clock: existing?.clock ?? 0, lastSyncedAt: existing?.lastSyncedAt ?? null,
      enabled: false, bound: false, initialComplete: existing?.initialComplete ?? false,
    };
    return structuredClone(this.staged);
  }
  async activateEnrollment(staged: SyncLocalState) {
    this.events.push("activate");
    const rotation = same(this.local, staged) && this.local!.enabled;
    const previousLabel = this.local?.label;
    this.local = { ...staged, enabled: true, bound: true };
    this.staged = null;
    if (!rotation) {
      this.rows.clear();
      this.frozen = null;
      this.local.clock++;
      this.local.initialComplete = false;
      this.put(change(this.local.clock, "one", staged.deviceId));
    } else if (previousLabel !== staged.label) {
      await this.setLabel(staged.label);
    }
  }
  async disconnect() {
    this.events.push("disconnect");
    if (this.local) this.local.enabled = false;
    this.staged = null;
  }
  async setLabel(label: string) {
    this.events.push("label");
    if (!this.local) throw new Error();
    this.local.label = label;
    this.put({
      key: makeDocumentKey("profile", this.local.deviceId, "profile"), kind: "profile",
      payload: { phoneLabel: label }, revision: ++this.local.clock, deleted: false,
    });
  }
  async pendingCount() { return this.rows.size; }
  async inFlight(): Promise<UploadBatch | null> {
    if (this.frozen) return structuredClone(this.frozen);
    if (this.rows.size === 0 && this.local && !this.local.initialComplete) {
      this.put({
        key: "completion", kind: "completion", payload: { initialUploadComplete: true },
        revision: ++this.local.clock, deleted: false,
      });
    }
    if (this.rows.size === 0) return null;
    this.frozen = {
      id: `batch-${++this.batchId}`,
      changes: makeBatch(this.local!, [...this.rows.values()], this.local!.installationId).changes,
    };
    return structuredClone(this.frozen);
  }
  async reserveAttempt(writes: number, at: number) {
    this.reservations.push({ writes, at });
    if (at >= this.resetAt) { this.remaining = 8_000; this.resetAt = Number.MAX_SAFE_INTEGER; }
    if (writes > this.remaining) return { allowed: false, retryAt: this.resetAt };
    this.remaining -= writes;
    return { allowed: true, retryAt: null };
  }
  async acknowledge(id: string, acks: CommitReceipt["acknowledged"], at: string) {
    assert.equal(id, this.frozen?.id);
    this.acknowledgements.push({ id, acks });
    for (const ack of acks) {
      if (this.rows.get(ack.key)?.revision === ack.revision) this.rows.delete(ack.key);
      if (ack.key === "completion" && this.local) this.local.initialComplete = true;
    }
    this.frozen = null;
    if (this.local) this.local.lastSyncedAt = at;
  }
}
class Secrets implements SyncSecrets {
  saved: SyncCredentials | null = { ...CREDENTIALS };
  saves = 0;
  async load() { return structuredClone(this.saved); }
  async save(value: SyncCredentials) { this.saved = { ...value }; this.saves++; }
  async remove() { this.saved = null; }
}
function setup(transport: SyncTransport = async (request) => success(request)) {
  const repository = new PersistentRepository();
  const secrets = new Secrets();
  const time = new FakeTime();
  const controller = new SyncController(repository, secrets, transport, time.options);
  return { repository, secrets, time, controller };
}

test("restarts replay the exact frozen batch before a newer coalesced edit", async () => {
  const bodies: string[] = [];
  const app = setup(async (request, credentials) => {
    bodies.push(makeCommitBody(request, credentials));
    throw new Error(`Network failed ${credentials.password} ${credentials.email}`);
  });
  app.repository.put(change());
  await app.controller.initialize();
  await assert.rejects(app.controller.syncNow(), /remain saved/);
  assert.equal(app.repository.frozen!.changes[0].revision, 1);
  assert.ok(!app.controller.getSnapshot().error!.includes(CREDENTIALS.password));
  app.repository.put(change(2));
  app.controller.dispose();
  const restarted = new SyncController(app.repository, app.secrets, async (request, credentials) => {
    bodies.push(makeCommitBody(request, credentials));
    return success(request);
  }, app.time.options);
  await restarted.initialize();
  await restarted.syncNow();
  assert.equal(bodies[0], bodies[1]);
  assert.notEqual(bodies[1], bodies[2]);
  assert.deepEqual(app.repository.acknowledgements.map(({ acks }) => acks[0].revision), [1, 2]);
  assert.equal(app.repository.rows.size, 0);
  assert.equal(restarted.getSnapshot().status, "synced");
  restarted.dispose();
});

test("debounces ten seconds, caps continuous edits at sixty, and immediately uploads a finish", async () => {
  let calls = 0;
  const app = setup(async (request) => { calls++; return success(request); });
  await app.controller.initialize();
  await app.controller.syncNow();
  app.repository.put(change());
  app.controller.changed();
  await app.time.advance(9_999);
  assert.equal(calls, 0);
  await app.time.advance(1);
  assert.equal(calls, 1);
  app.repository.put(change(2));
  app.controller.changed();
  for (let index = 0; index < 11; index++) {
    await app.time.advance(5_000);
    app.repository.put(change(index + 3));
    app.controller.changed();
  }
  assert.equal(calls, 1);
  await app.time.advance(5_000);
  assert.equal(calls, 2);
  app.repository.put(change(30));
  app.controller.changed(true);
  await app.time.advance(0);
  assert.equal(calls, 3);
  app.controller.dispose();
});

test("background response leaves its batch frozen and resume safely retries it", async () => {
  const gate = deferred<CommitReceipt>();
  const requests: SyncRequest[] = [];
  const app = setup(async (request) => {
    requests.push(structuredClone(request));
    return requests.length === 1 ? gate.promise : success(request);
  });
  app.repository.put(change());
  await app.controller.initialize();
  const upload = app.controller.syncNow();
  await settle();
  app.controller.setActive(false);
  gate.resolve(success(requests[0]));
  await upload;
  assert.equal(app.repository.acknowledgements.length, 0);
  assert.ok(app.repository.frozen);
  await app.time.advance(60_000);
  assert.equal(requests.length, 1);
  app.controller.setActive(true);
  await app.time.advance(0);
  assert.deepEqual(requests[0], requests[1]);
  assert.equal(app.repository.rows.size, 0);
  app.controller.dispose();
});

test("old acknowledgements preserve edits made during upload and requests never overlap", async () => {
  const first = deferred<CommitReceipt>();
  const second = deferred<CommitReceipt>();
  const requests: SyncRequest[] = [];
  let active = 0;
  const app = setup(async (request) => {
    assert.equal(active++, 0);
    requests.push(structuredClone(request));
    const receipt = requests.length === 1 ? await first.promise : await second.promise;
    active--;
    return receipt;
  });
  app.repository.put(change());
  await app.controller.initialize();
  const upload = app.controller.syncNow();
  await settle();
  app.repository.put(change(2));
  app.controller.changed(true);
  await app.time.advance(0);
  first.resolve(success(requests[0]));
  await settle();
  assert.equal(app.repository.rows.get(change().key)?.revision, 2);
  assert.equal(app.repository.acknowledgements[0].acks[0].revision, 1);
  second.resolve(success(requests[1]));
  await upload;
  assert.equal(app.repository.rows.size, 0);
  app.controller.dispose();
});

test("drains ten-document batches and yields after one hundred batches during continuous edits", async () => {
  const sizes: number[] = [];
  const app = setup(async (request) => {
    if (request.action === "upload") sizes.push(request.changes.length);
    return success(request);
  });
  for (let index = 0; index < 201; index++) app.repository.put(change(1, String(index)));
  await app.controller.initialize();
  await app.controller.syncNow();
  assert.deepEqual(sizes, [...Array<number>(20).fill(10), 1]);
  app.controller.dispose();
  let calls = 0;
  const busy = setup(async (request) => {
    calls++;
    if (calls < 105) { busy.repository.put(change(calls + 1)); busy.controller.changed(); }
    return success(request);
  });
  busy.repository.put(change());
  await busy.controller.initialize();
  await busy.controller.syncNow();
  assert.equal(calls, 100);
  assert.equal(busy.controller.getSnapshot().busy, false);
  await busy.time.advance(0);
  assert.equal(calls, 105);
  assert.equal(busy.repository.rows.size, 0);
  busy.controller.dispose();
});

test("network retries double from fifteen seconds to a five-minute maximum", async () => {
  let calls = 0;
  const app = setup(async () => { calls++; throw new SyncError("Offline", true); });
  app.repository.put(change());
  await app.controller.initialize();
  await assert.rejects(app.controller.syncNow(), /Offline/);
  for (const delay of [15_000, 30_000, 60_000, 120_000, 240_000, 300_000, 300_000]) {
    const before = calls;
    await app.time.advance(delay - 1);
    assert.equal(calls, before);
    await app.time.advance(1);
    assert.equal(calls, before + 1);
  }
  assert.equal(app.repository.frozen!.changes[0].revision, 1);
  assert.equal(app.repository.reservations.length, calls);
  app.controller.dispose();
});

test("authentication rejection stays visible after a temporary storage read failure", async () => {
  let calls = 0;
  let mode: "auth" | "offline" | "success" = "auth";
  const app = setup(async (request) => {
    calls++;
    if (mode === "auth") throw new SyncError("Ask the owner for a replacement code.", false, "auth");
    if (mode === "offline") throw new SyncError("Offline", true);
    return success(request);
  });
  app.repository.put(change());
  await app.controller.initialize();
  await assert.rejects(app.controller.syncNow(), /replacement/);
  const error = app.controller.getSnapshot().error;
  let fails = true;
  app.repository.pendingCount = async () => {
    if (fails) { fails = false; throw new Error("Temporary storage read failure"); }
    return app.repository.rows.size;
  };
  app.controller.changed(true);
  await settle();
  app.controller.setActive(false);
  app.controller.setActive(true);
  await app.time.advance(600_000);
  assert.equal(calls, 1);
  assert.equal(app.controller.getSnapshot().error, error);
  mode = "offline";
  await assert.rejects(app.controller.syncNow(), /Offline/);
  await app.time.advance(600_000);
  assert.equal(calls, 2);
  assert.equal(app.controller.getSnapshot().error, error);
  mode = "success";
  await app.controller.syncNow();
  assert.equal(app.controller.getSnapshot().error, null);
  assert.equal(app.controller.getSnapshot().status, "synced");
  app.controller.dispose();
});

test("daily budget pauses survive edits, manual retries, and background resume", async () => {
  let calls = 0;
  const app = setup(async (request) => { calls++; return success(request); });
  app.repository.put(change());
  app.repository.remaining = 0;
  app.repository.resetAt = app.time.time + 2_000;
  await app.controller.initialize();
  await assert.rejects(app.controller.syncNow(), /quota resets/);
  assert.equal(app.controller.getSnapshot().status, "paused");
  assert.equal(app.controller.getSnapshot().pausedUntil, new Date(app.repository.resetAt).toISOString());
  await assert.rejects(app.controller.syncNow(), /quota resets/);
  app.controller.changed(true);
  app.controller.setActive(false);
  app.controller.setActive(true);
  await app.time.advance(1_999);
  assert.equal(calls, 0);
  assert.equal(app.repository.reservations.length, 1);
  await app.time.advance(1);
  assert.equal(calls, 1);
  assert.equal(app.controller.getSnapshot().pausedUntil, null);
  assert.equal(app.repository.rows.size, 0);
  app.controller.dispose();
});

test("invalid receipts never clear the frozen batch or report successful upload", async () => {
  for (const acknowledged of [
    [], [{ key: change().key, revision: 2 }],
    [{ key: change().key, revision: 1 }, { key: change().key, revision: 1 }],
    [{ key: change(1, "other").key, revision: 1 }],
  ]) {
    const app = setup(async () => ({ acknowledged }));
    app.repository.put(change());
    await app.controller.initialize();
    await assert.rejects(app.controller.syncNow(), /could not be verified/);
    assert.ok(app.repository.frozen);
    assert.equal(app.repository.acknowledgements.length, 0);
    assert.equal(app.controller.getSnapshot().lastSyncedAt, null);
    app.controller.dispose();
  }
});

test("connection persists enrollment and credentials before binding then confirms initial completion separately", async () => {
  const gate = deferred<CommitReceipt>();
  const requests: SyncRequest[] = [];
  const app = setup(async (request) => {
    requests.push(request);
    return request.action === "bind" ? gate.promise : success(request);
  });
  app.repository.local = null;
  app.secrets.saved = null;
  await app.controller.initialize();
  const connecting = app.controller.connect(code(), "Phone");
  await settle();
  assert.equal((await app.secrets.load())?.uid, CREDENTIALS.uid);
  assert.equal(app.repository.staged?.installationId, INSTALLATION);
  assert.equal(app.repository.local, null);
  assert.equal(app.repository.reservations[0].writes, 1);
  gate.resolve(success(requests[0]));
  await connecting;
  assert.equal(app.controller.getSnapshot().bound, true);
  assert.equal(app.controller.getSnapshot().initialComplete, false);
  await app.time.advance(0);
  assert.equal(app.controller.getSnapshot().initialComplete, true);
  assert.equal(app.controller.getSnapshot().status, "synced");
  const completion = requests.find((request) => request.action === "upload" &&
    request.changes.some((item) => item.kind === "completion"));
  assert.ok(completion);
  app.controller.dispose();
});

test("a crash after binding preserves staged identity so initialization replays the same enrollment", async () => {
  const gate = deferred<CommitReceipt>();
  let original!: SyncRequest;
  const app = setup(async (request) => { original = request; return gate.promise; });
  app.repository.local = null;
  app.secrets.saved = null;
  await app.controller.initialize();
  const connection = app.controller.connect(code(), "Phone");
  await settle();
  app.controller.dispose();
  gate.resolve(success(original));
  await connection;
  assert.equal(app.repository.local, null);
  const requests: SyncRequest[] = [];
  const restarted = new SyncController(app.repository, app.secrets, async (request) => {
    requests.push(request);
    return success(request);
  }, { ...app.time.options, createInstallationId: () => OTHER_INSTALLATION });
  await restarted.initialize();
  await restarted.syncNow();
  assert.deepEqual(requests[0], original);
  assert.equal((await app.repository.state())?.installationId, INSTALLATION);
  assert.equal(restarted.getSnapshot().initialComplete, true);
  restarted.dispose();
});

test("reusing a code after identity loss is rejected without adopting an old generation", async () => {
  const preview = createPreviewTransport();
  await preview({ action: "bind", installationId: INSTALLATION }, CREDENTIALS);
  const app = setup(preview);
  app.repository.local = null;
  app.secrets.saved = null;
  app.time.options.createInstallationId = () => OTHER_INSTALLATION;
  const fresh = new SyncController(app.repository, app.secrets, preview, app.time.options);
  await fresh.initialize();
  await assert.rejects(fresh.connect(code(), "Replacement"), /already bound/);
  assert.equal(app.repository.local, null);
  assert.equal(await app.secrets.load(), null);
  fresh.dispose();
  app.controller.dispose();
});

test("credential rotation preserves installation, counter, and an existing frozen batch", async () => {
  const app = setup();
  app.repository.put(change(50));
  const frozen = await app.repository.inFlight();
  await app.controller.initialize();
  const rotated = { ...CREDENTIALS, uid: "phone_rotated", email: "rotated@example.com", password: "rotated-private-password" };
  await app.controller.connect(code(rotated), "My phone");
  assert.equal((await app.repository.state())?.installationId, INSTALLATION);
  assert.equal((await app.repository.state())?.clock, 50);
  assert.deepEqual(app.repository.frozen, frozen);
  assert.equal((await app.secrets.load())?.uid, rotated.uid);
  await app.controller.syncNow();
  assert.equal(app.repository.rows.size, 0);
  app.controller.dispose();
});

test("duplicate connection buttons and disconnect races never interleave mutation or stale acknowledgements", async () => {
  const gate = deferred<CommitReceipt>();
  let request!: SyncRequest;
  const initial = setup(async (value) => { request = value; return gate.promise; });
  initial.repository.local = null;
  initial.secrets.saved = null;
  await initial.controller.initialize();
  const first = initial.controller.connect(code(), "Phone");
  await assert.rejects(initial.controller.connect(code(), "Other"), /already being checked/);
  await settle();
  const disconnect = initial.controller.disconnect();
  gate.resolve(success(request));
  await Promise.all([first, disconnect]);
  assert.equal(initial.repository.local, null);
  assert.equal(await initial.secrets.load(), null);
  await initial.time.advance(600_000);
  assert.equal(initial.time.jobs.size, 0);
  initial.controller.dispose();
  const uploadGate = deferred<CommitReceipt>();
  const requests: SyncRequest[] = [];
  const app = setup(async (value) => {
    requests.push(value);
    return requests.length === 1 ? uploadGate.promise : success(value);
  });
  app.repository.put(change());
  await app.controller.initialize();
  const upload = app.controller.syncNow();
  await settle();
  const stop = app.controller.disconnect();
  const next = { ...CREDENTIALS, generationId: "55555555-5555-4555-8555-555555555555", uid: "replacement" };
  const reconnect = app.controller.connect(code(next), "New phone");
  uploadGate.resolve(success(requests[0]));
  await Promise.all([upload, stop, reconnect]);
  assert.equal(app.repository.acknowledgements.length, 0);
  assert.equal((await app.repository.state())?.generationId, next.generationId);
  await app.time.advance(0);
  assert.equal(app.controller.getSnapshot().initialComplete, true);
  app.controller.dispose();
});

test("backgrounding credential initialization still permits resume and a queued upload cancels before disconnect", async () => {
  const gate = deferred<SyncCredentials | null>();
  let calls = 0;
  const app = setup(async (request) => { calls++; return success(request); });
  app.repository.put(change());
  app.secrets.load = () => gate.promise;
  const initialization = app.controller.initialize();
  await settle();
  app.controller.setActive(false);
  gate.resolve(CREDENTIALS);
  await initialization;
  await app.time.advance(60_000);
  assert.equal(calls, 0);
  app.controller.setActive(true);
  const queued = app.controller.syncNow();
  const disconnected = app.controller.disconnect();
  await Promise.all([queued, disconnected]);
  await app.time.advance(600_000);
  assert.equal(calls, 0);
  assert.equal(app.controller.getSnapshot().error, null);
  app.controller.dispose();
});

test("missing or mismatched saved identities never silently create a writer generation", async () => {
  for (const state of [null, { projectId: "another-project" }, { generationId: OTHER_INSTALLATION }, { enabled: false }]) {
    let calls = 0;
    const app = setup(async (request) => { calls++; return success(request); });
    app.repository.local = state === null ? null : { ...app.repository.local!, ...state };
    await app.controller.initialize();
    await app.time.advance(600_000);
    assert.equal(calls, 0);
    assert.equal(app.controller.getSnapshot().status, "disconnected");
    assert.match(app.controller.getSnapshot().error!, /replacement/);
    app.controller.dispose();
  }
});

test("label changes wait for the frozen batch and subscriptions end cleanly", async () => {
  const gate = deferred<CommitReceipt>();
  const requests: SyncRequest[] = [];
  const app = setup(async (request) => {
    requests.push(request);
    return requests.length === 1 ? gate.promise : success(request);
  });
  let calls = 0;
  const unsubscribe = app.controller.subscribe(() => { calls++; });
  app.repository.put(change());
  await app.controller.initialize();
  const upload = app.controller.syncNow();
  await settle();
  const label = app.controller.setLabel("x".repeat(80));
  gate.resolve(success(requests[0]));
  await Promise.all([upload, label]);
  assert.equal(app.repository.acknowledgements.length, 0);
  await app.time.advance(0);
  assert.deepEqual(requests[0], requests[1]);
  assert.equal(app.controller.getSnapshot().deviceLabel.length, 80);
  await assert.rejects(app.controller.setLabel("x".repeat(81)), /80 characters/);
  assert.ok(calls > 0);
  unsubscribe();
  const before = calls;
  await app.controller.syncNow();
  assert.equal(calls, before);
  app.controller.dispose();
});
test("a failed local enrollment activation restores the previous secure credential and frozen queue", async () => {
  const app = setup();
  app.repository.put(change(5));
  const frozen = await app.repository.inFlight();
  app.repository.activateEnrollment = async () => { throw new Error("Disk write failed"); };
  await app.controller.initialize();
  const rotated = { ...CREDENTIALS, uid: "rotated_uid", email: "rotated@example.com" };
  await assert.rejects(app.controller.connect(code(rotated), "New label"), /remain saved/);
  assert.equal((await app.secrets.load())?.uid, CREDENTIALS.uid);
  assert.equal((await app.repository.state())?.label, "My phone");
  assert.deepEqual(app.repository.frozen, frozen);
  assert.equal(app.controller.getSnapshot().busy, false);
  app.controller.dispose();
});

test("initial completion stays false until its separate frozen marker is acknowledged", async () => {
  let failCompletion = true;
  const app = setup(async (request) => {
    if (failCompletion && request.action === "upload" && request.changes[0].kind === "completion") {
      throw new SyncError("Marker response lost", true);
    }
    return success(request);
  });
  app.repository.local = null;
  app.secrets.saved = null;
  await app.controller.initialize();
  await app.controller.connect(code(), "Phone");
  await assert.rejects(app.controller.syncNow(), /Marker response lost/);
  assert.equal(app.controller.getSnapshot().bound, true);
  assert.equal(app.controller.getSnapshot().initialComplete, false);
  assert.equal(app.repository.frozen!.changes[0].kind, "completion");
  failCompletion = false;
  await app.controller.syncNow();
  assert.equal(app.controller.getSnapshot().initialComplete, true);
  assert.equal(app.controller.getSnapshot().status, "synced");
  app.controller.dispose();
});
