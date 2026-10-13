import test from "node:test";
import assert from "node:assert/strict";
import {
  SyncController,
  type SyncControllerOptions,
  type SyncLocalState,
  type SyncRepository,
  type SyncSecrets,
} from "../src/sync/controller";
import { SyncError, type SyncTransport } from "../src/sync/transport";
import {
  makeRowKey,
  type RowChange,
  type SyncCredentials,
  type SyncRequest,
  type SyncResponse,
} from "../src/sync/protocol";

const DEVICE = "11111111-1111-4111-8111-111111111111";
const NEXT_DEVICE = "22222222-2222-4222-8222-222222222222";
const CREDENTIALS: SyncCredentials = {
  version: 1,
  endpoint: "https://script.google.com/macros/s/test_deployment/exec",
  deviceId: DEVICE,
  token: "a".repeat(64),
};

function code(credentials = CREDENTIALS): string {
  return `WORKOUT1.${Buffer.from(JSON.stringify(credentials)).toString("base64url")}`;
}

function row(revision = 1, id = "one", deviceId = DEVICE): RowChange {
  return {
    table: "Exercises",
    key: makeRowKey("Exercises", deviceId, id),
    values: [id, 0, "Squat", "Legs", "Barbell", 5, 2.5],
    revision,
    deleted: false,
  };
}

function success(request: SyncRequest, maxRevision = 100): SyncResponse {
  return {
    version: 1,
    ok: true,
    deviceId: request.deviceId,
    maxRevision,
    acknowledged: (request.changes ?? []).map(({ key, revision }) => ({ key, revision })),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function settle(): Promise<void> {
  for (let count = 0; count < 40; count++) await Promise.resolve();
}

class FakeTime {
  time = Date.UTC(2026, 9, 13);
  nextId = 1;
  jobs = new Map<number, { at: number; callback: () => void }>();
  options: SyncControllerOptions = {
    now: () => this.time,
    setTimeout: (callback, delay) => {
      const id = this.nextId++;
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

class PersistentRepository implements SyncRepository {
  local: SyncLocalState | null = {
    deviceId: DEVICE, label: "My phone", clock: 1, lastSyncedAt: null, enabled: true,
  };
  rows = new Map<string, RowChange>();
  acknowledgements: { key: string; revision: number }[][] = [];
  events: string[] = [];

  put(change: RowChange): void { this.rows.set(change.key, structuredClone(change)); }
  async state() { return this.local ? { ...this.local } : null; }
  async connect(deviceId: string, label: string, floor: number) {
    this.events.push("connect");
    this.local = { deviceId, label, clock: floor + 1, lastSyncedAt: null, enabled: true };
    this.rows.clear();
    this.put(row(floor + 1, "one", deviceId));
  }
  async disconnect() {
    this.events.push("disconnect");
    if (this.local) this.local.enabled = false;
  }
  async setLabel(label: string) {
    if (!this.local) throw new Error();
    this.events.push("label");
    this.local.label = label;
    this.local.clock++;
    this.put(row(this.local.clock, "label", this.local.deviceId));
  }
  async pendingCount() { return this.rows.size; }
  async pending() { return structuredClone([...this.rows.values()].slice(0, 100)); }
  async acknowledge(acks: { key: string; revision: number }[], at: string) {
    this.acknowledgements.push(acks);
    for (const ack of acks) {
      if (this.rows.get(ack.key)?.revision === ack.revision) this.rows.delete(ack.key);
    }
    if (this.local) this.local.lastSyncedAt = at;
  }
}

class Secrets implements SyncSecrets {
  saved: SyncCredentials | null = { ...CREDENTIALS };
  saves = 0;
  removals = 0;
  async load() { return this.saved ? { ...this.saved } : null; }
  async save(value: SyncCredentials) { this.saved = { ...value }; this.saves++; }
  async remove() { this.saved = null; this.removals++; }
}

function setup(transport: SyncTransport = async (request) => success(request)) {
  const repository = new PersistentRepository();
  const secrets = new Secrets();
  const time = new FakeTime();
  const controller = new SyncController(repository, secrets, transport, time.options);
  return { repository, secrets, time, controller };
}

test("failed uploads survive a restart and never expose fetch secrets", async () => {
  const first = setup(async () => {
    throw new Error(`Offline ${CREDENTIALS.endpoint} ${CREDENTIALS.token}`);
  });
  first.repository.put(row());
  await first.controller.initialize();
  await assert.rejects(first.controller.syncNow(), /could not finish/);
  assert.equal(first.repository.rows.size, 1);
  assert.equal(first.controller.getSnapshot().status, "error");
  assert.ok(!first.controller.getSnapshot().error!.includes(CREDENTIALS.token));
  first.controller.dispose();
  const restarted = new SyncController(
    first.repository, first.secrets, async (request) => success(request), first.time.options,
  );
  await restarted.initialize();
  await restarted.syncNow();
  assert.equal(first.repository.rows.size, 0);
  assert.equal(restarted.getSnapshot().status, "synced");
  assert.equal(restarted.getSnapshot().lastSyncedAt, new Date(first.time.time).toISOString());
  restarted.dispose();
});

test("debounces edits for ten seconds and caps continuous editing at sixty seconds", async () => {
  const requests: SyncRequest[] = [];
  const app = setup(async (request) => { requests.push(request); return success(request); });
  await app.controller.initialize();
  await app.controller.syncNow();
  app.repository.put(row());
  app.controller.changed();
  await app.time.advance(9_999);
  assert.equal(requests.length, 0);
  await app.time.advance(1);
  assert.equal(requests.length, 1);
  app.repository.put(row(2));
  app.controller.changed();
  for (let index = 0; index < 11; index++) {
    await app.time.advance(5_000);
    app.repository.put(row(index + 3));
    app.controller.changed();
  }
  assert.equal(requests.length, 1);
  await app.time.advance(5_000);
  assert.equal(requests.length, 2);
  app.repository.put(row(20));
  app.controller.changed(true);
  await app.time.advance(0);
  assert.equal(requests.length, 3);
  app.controller.dispose();
});

test("background pauses uploads and a resume retries unacknowledged in-flight rows", async () => {
  const gate = deferred<SyncResponse>();
  const requests: SyncRequest[] = [];
  const app = setup(async (request) => {
    requests.push(request);
    return requests.length === 1 ? gate.promise : success(request);
  });
  app.controller.setActive(false);
  app.repository.put(row());
  await app.controller.initialize();
  app.controller.changed(true);
  await app.time.advance(60_000);
  assert.equal(requests.length, 0);
  app.controller.setActive(true);
  await app.time.advance(0);
  assert.equal(requests.length, 1);
  app.controller.setActive(false);
  gate.resolve(success(requests[0]));
  await settle();
  assert.equal(app.repository.acknowledgements.length, 0);
  assert.equal(app.repository.rows.size, 1);
  await app.time.advance(60_000);
  assert.equal(requests.length, 1);
  app.controller.setActive(true);
  await app.time.advance(0);
  assert.equal(requests.length, 2);
  assert.equal(app.repository.rows.size, 0);
  app.controller.dispose();
});

test("an acknowledgement for an older revision preserves an edit made during upload", async () => {
  const gate = deferred<SyncResponse>();
  const nextGate = deferred<SyncResponse>();
  const requests: SyncRequest[] = [];
  let active = 0;
  const app = setup(async (request) => {
    assert.equal(active++, 0);
    requests.push(request);
    const response = requests.length === 1 ? await gate.promise : await nextGate.promise;
    active--;
    return response;
  });
  app.repository.put(row());
  await app.controller.initialize();
  const upload = app.controller.syncNow();
  await settle();
  app.repository.put(row(2));
  app.controller.changed(true);
  await app.time.advance(0);
  gate.resolve(success(requests[0]));
  await settle();
  assert.equal(app.repository.rows.get(row().key)?.revision, 2);
  assert.deepEqual(app.repository.acknowledgements[0], [{ key: row().key, revision: 1 }]);
  nextGate.resolve(success(requests[1]));
  await upload;
  assert.deepEqual(requests.map((request) => request.changes![0].revision), [1, 2]);
  assert.equal(app.repository.rows.size, 0);
  app.controller.dispose();
});

test("drains a persistent outbox even when the repository returns only one hundred rows", async () => {
  const requests: SyncRequest[] = [];
  const app = setup(async (request) => {
    requests.push(request);
    if (requests.length === 1) {
      app.repository.put(row(2, "new"));
      app.controller.changed();
    }
    return success(request);
  });
  for (let index = 0; index < 201; index++) app.repository.put(row(1, String(index)));
  await app.controller.initialize();
  await app.controller.syncNow();
  assert.deepEqual(requests.map((request) => request.changes!.length), [100, 100, 2]);
  assert.equal(app.repository.rows.size, 0);
  app.controller.dispose();
});

test("retry delays double from fifteen seconds and stop at five minutes", async () => {
  let calls = 0;
  const app = setup(async () => {
    calls++;
    throw new SyncError("Offline", true);
  });
  app.repository.put(row());
  await app.controller.initialize();
  await assert.rejects(app.controller.syncNow(), /Offline/);
  for (const delay of [15_000, 30_000, 60_000, 120_000, 240_000, 300_000, 300_000]) {
    const before = calls;
    await app.time.advance(delay - 1);
    assert.equal(calls, before);
    await app.time.advance(1);
    assert.equal(calls, before + 1);
  }
  assert.equal(app.repository.rows.size, 1);
  app.controller.dispose();
});

test("nonretryable authentication failures stop automatic retries and sanitize server errors", async () => {
  let calls = 0;
  const app = setup(async () => {
    calls++;
    return { version: 1, ok: false, error: CREDENTIALS.token, retryable: false };
  });
  app.repository.put(row());
  await app.controller.initialize();
  await assert.rejects(app.controller.syncNow(), /Reconnect/);
  app.controller.changed(true);
  await app.time.advance(600_000);
  app.controller.setActive(false);
  app.controller.setActive(true);
  await app.time.advance(0);
  assert.equal(calls, 1);
  assert.ok(!app.controller.getSnapshot().error!.includes(CREDENTIALS.token));
  assert.equal(app.repository.rows.size, 1);
  app.controller.dispose();
});

test("missing, duplicate, and unexpected acknowledgements cannot clear the outbox", async () => {
  for (const acknowledgements of [
    [],
    [{ key: row().key, revision: 2 }],
    [{ key: row().key, revision: 1 }, { key: row().key, revision: 1 }],
    [{ key: row(1, "other").key, revision: 1 }],
  ]) {
    const app = setup(async (request) => ({
      version: 1, ok: true, deviceId: request.deviceId,
      maxRevision: 100, acknowledged: acknowledgements,
    }));
    app.repository.put(row());
    await app.controller.initialize();
    await assert.rejects(app.controller.syncNow(), /invalid response/);
    assert.equal(app.repository.acknowledgements.length, 0);
    assert.equal(app.repository.rows.size, 1);
    assert.equal(app.controller.getSnapshot().lastSyncedAt, null);
    app.controller.dispose();
  }
});

test("connection validates hello before saving credentials or enabling the repository", async () => {
  for (const response of [
    { version: 1, ok: true, deviceId: NEXT_DEVICE, maxRevision: 8, acknowledged: [] },
    { version: 1, ok: true, deviceId: DEVICE, maxRevision: -1, acknowledged: [] },
    { version: 1, ok: true, deviceId: DEVICE, maxRevision: Number.MAX_SAFE_INTEGER, acknowledged: [] },
    { version: 1, ok: true, deviceId: DEVICE, maxRevision: 8, acknowledged: [{ key: row().key, revision: 1 }] },
  ]) {
    const app = setup(async () => response as SyncResponse);
    app.secrets.saved = null;
    app.repository.local = null;
    await app.controller.initialize();
    await assert.rejects(app.controller.connect(code(), "Phone"), /invalid/);
    assert.equal(app.secrets.saves, 0);
    assert.equal(app.repository.local, null);
    assert.equal(app.controller.getSnapshot().busy, false);
    app.controller.dispose();
  }
});

test("duplicate connection buttons cannot interleave configuration mutations", async () => {
  const gate = deferred<SyncResponse>();
  let request!: SyncRequest;
  const app = setup(async (value) => { request = value; return gate.promise; });
  app.secrets.saved = null;
  app.repository.local = null;
  await app.controller.initialize();
  const connect = app.controller.connect(code(), "Phone");
  await assert.rejects(app.controller.connect(code(), "Other"), /already being checked/);
  await settle();
  gate.resolve(success(request, 40));
  await connect;
  assert.equal(app.secrets.saves, 1);
  const connected = await app.repository.state();
  assert.equal(connected?.label, "Phone");
  assert.equal(connected?.clock, 41);
  app.controller.dispose();
});

test("disconnect cancels an in-flight acknowledgement before a queued reconnect", async () => {
  const gate = deferred<SyncResponse>();
  const requests: SyncRequest[] = [];
  let active = 0;
  const app = setup(async (request) => {
    assert.equal(active++, 0);
    requests.push(request);
    const response = requests.length === 1
      ? await gate.promise
      : success(request, request.action === "hello" ? 40 : 100);
    active--;
    return response;
  });
  app.repository.put(row());
  await app.controller.initialize();
  const upload = app.controller.syncNow();
  await settle();
  const disconnect = app.controller.disconnect();
  const nextCredentials = { ...CREDENTIALS, deviceId: NEXT_DEVICE, token: "b".repeat(64) };
  const reconnect = app.controller.connect(code(nextCredentials), "New phone");
  gate.resolve(success(requests[0]));
  await Promise.all([upload, disconnect, reconnect]);
  assert.equal(app.repository.acknowledgements.length, 0);
  assert.deepEqual(app.repository.events, ["disconnect", "connect"]);
  assert.equal(app.secrets.saved?.deviceId, NEXT_DEVICE);
  await app.time.advance(0);
  assert.equal(app.repository.rows.size, 0);
  assert.equal(app.controller.getSnapshot().deviceLabel, "New phone");
  app.controller.dispose();
});

test("label changes wait for an upload, cancel its stale acknowledgement, and sync immediately", async () => {
  const gate = deferred<SyncResponse>();
  const requests: SyncRequest[] = [];
  const app = setup(async (request) => {
    requests.push(request);
    return requests.length === 1 ? gate.promise : success(request);
  });
  app.repository.put(row());
  await app.controller.initialize();
  const upload = app.controller.syncNow();
  await settle();
  const label = app.controller.setLabel("Desk phone");
  assert.equal(app.repository.local?.label, "My phone");
  gate.resolve(success(requests[0]));
  await Promise.all([upload, label]);
  assert.equal(app.repository.acknowledgements.length, 0);
  await app.time.advance(0);
  assert.equal(app.repository.rows.size, 0);
  assert.equal(app.controller.getSnapshot().deviceLabel, "Desk phone");
  app.controller.dispose();
});

test("credentials without matching local state require a reconnect and never upload", async () => {
  for (const state of [null, { deviceId: NEXT_DEVICE }, { enabled: false }]) {
    let calls = 0;
    const app = setup(async (request) => { calls++; return success(request); });
    app.repository.local = state === null
      ? null
      : { ...app.repository.local!, ...state };
    await app.controller.initialize();
    await app.time.advance(600_000);
    assert.equal(calls, 0);
    assert.equal(app.controller.getSnapshot().status, "disconnected");
    assert.match(app.controller.getSnapshot().error!, /Reconnect/);
    app.controller.dispose();
  }
});

test("subscriptions receive snapshots and stop after unsubscribe or disposal", async () => {
  const app = setup();
  let calls = 0;
  const unsubscribe = app.controller.subscribe(() => { calls++; });
  await app.controller.initialize();
  assert.ok(calls > 0);
  unsubscribe();
  const before = calls;
  await app.controller.syncNow();
  assert.equal(calls, before);
  app.controller.dispose();
  app.controller.changed(true);
  await app.time.advance(600_000);
  assert.equal(app.time.jobs.size, 0);
});
test("continuous edits yield after one hundred batches and finish on the next pass", async () => {
  let calls = 0;
  const app = setup(async (request) => {
    calls++;
    if (calls < 105) {
      app.repository.put(row(calls + 1));
      app.controller.changed();
    }
    return success(request, 1_000);
  });
  app.repository.put(row());
  await app.controller.initialize();
  await app.controller.syncNow();
  assert.equal(calls, 100);
  assert.equal(app.repository.rows.get(row().key)?.revision, 101);
  assert.equal(app.controller.getSnapshot().busy, false);
  await app.time.advance(0);
  assert.equal(calls, 105);
  assert.equal(app.repository.rows.size, 0);
  app.controller.dispose();
});

test("backgrounding during credential loading still permits sync after resume", async () => {
  const gate = deferred<SyncCredentials | null>();
  let calls = 0;
  const app = setup(async (request) => { calls++; return success(request); });
  app.repository.put(row());
  app.secrets.load = () => gate.promise;
  const initialization = app.controller.initialize();
  await settle();
  app.controller.setActive(false);
  gate.resolve(CREDENTIALS);
  await initialization;
  await app.time.advance(60_000);
  assert.equal(calls, 0);
  assert.equal(app.controller.getSnapshot().status, "pending");
  app.controller.setActive(true);
  await app.time.advance(0);
  assert.equal(calls, 1);
  assert.equal(app.repository.rows.size, 0);
  app.controller.dispose();
});

test("a queued upload is cancelled if disconnect was requested before it starts", async () => {
  let calls = 0;
  const app = setup(async (request) => { calls++; return success(request); });
  app.repository.put(row());
  await app.controller.initialize();
  const upload = app.controller.syncNow();
  const disconnect = app.controller.disconnect();
  await Promise.all([upload, disconnect]);
  assert.equal(calls, 0);
  assert.equal(app.repository.rows.size, 1);
  assert.equal(app.repository.local?.enabled, false);
  assert.equal(app.secrets.saved, null);
  await app.time.advance(600_000);
  assert.equal(app.controller.getSnapshot().error, null);
  assert.equal(app.time.jobs.size, 0);
  app.controller.dispose();
});

test("backgrounding during the hello response preserves a validated connection without uploading", async () => {
  const gate = deferred<SyncResponse>();
  const requests: SyncRequest[] = [];
  const app = setup(async (request) => {
    requests.push(request);
    return request.action === "hello" ? gate.promise : success(request);
  });
  app.secrets.saved = null;
  app.repository.local = null;
  await app.controller.initialize();
  const connection = app.controller.connect(code(), "x".repeat(80));
  await settle();
  app.controller.setActive(false);
  gate.resolve(success(requests[0], 40));
  await connection;
  assert.equal((await app.secrets.load())?.deviceId, DEVICE);
  assert.equal(app.controller.getSnapshot().deviceLabel.length, 80);
  await app.time.advance(60_000);
  assert.equal(requests.length, 1);
  app.controller.setActive(true);
  await app.time.advance(0);
  assert.equal(requests.length, 2);
  assert.equal(app.repository.rows.size, 0);
  await assert.rejects(app.controller.setLabel("x".repeat(81)), /80 characters/);
  app.controller.dispose();
});
test("transient storage reads cannot restart authentication retries or hide the reconnect error", async () => {
  let requests = 0;
  let mode: "auth" | "offline" | "success" = "auth";
  const app = setup(async (request) => {
    requests++;
    if (mode === "auth") {
      return { version: 1, ok: false, error: "Unauthorized", retryable: false };
    }
    if (mode === "offline") throw new SyncError("Temporary network failure", true);
    return success(request);
  });
  app.repository.put(row());
  await app.controller.initialize();
  await assert.rejects(app.controller.syncNow(), /Reconnect/);
  const reconnectError = app.controller.getSnapshot().error;
  let failRead = true;
  app.repository.pendingCount = async () => {
    if (failRead) {
      failRead = false;
      throw new Error("Temporary storage failure");
    }
    return app.repository.rows.size;
  };
  app.controller.changed(true);
  await settle();
  await app.time.advance(600_000);
  assert.equal(requests, 1);
  assert.equal(app.controller.getSnapshot().error, reconnectError);
  assert.equal(app.controller.getSnapshot().status, "error");
  app.controller.setActive(false);
  app.controller.setActive(true);
  await app.time.advance(0);
  assert.equal(requests, 1);
  mode = "offline";
  await assert.rejects(app.controller.syncNow(), /Temporary network failure/);
  await app.time.advance(600_000);
  assert.equal(requests, 2);
  assert.equal(app.controller.getSnapshot().error, reconnectError);
  mode = "success";
  await app.controller.syncNow();
  assert.equal(requests, 3);
  assert.equal(app.controller.getSnapshot().error, null);
  assert.equal(app.controller.getSnapshot().status, "synced");
  app.repository.put(row(2));
  app.controller.changed(true);
  await app.time.advance(0);
  assert.equal(requests, 4);
  app.controller.dispose();
});