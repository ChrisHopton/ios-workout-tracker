import test from "node:test";
import assert from "node:assert/strict";
import { createResetBackend, runProfileReset, verifyDeployedResetFence, type ResetTarget, type ResetBackend } from "../scripts/firebaseReset";
import type { Firestore } from "firebase-admin/firestore";
const active: ResetTarget = { kind: "automatic", path: "automaticUploads/fixture-active", exists: true, enabled: true, schemaVersion: 2, records: 50 };
function fixture() {
  let targets = [structuredClone(active), { ...active, path: "automaticUploads/fixture-revoked", enabled: false, records: 3 },
    { kind: "legacy" as const, path: "devices/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", exists: false, enabled: true, records: 2 }];
  const calls: string[] = [];
  let fenced = true;
  let failDelete = false;
  const backend: ResetBackend = {
    verifyFence: async () => { calls.push("verify"); if (!fenced) throw new Error("Not fenced"); },
    targets: async () => structuredClone(targets),
    inspect: async target => structuredClone(targets.find(value => value.path === target.path)!),
    deleteRecords: async target => { if (failDelete) { failDelete = false; throw new Error("Temporary failure"); } calls.push("records:" + target.path); targets.find(value => value.path === target.path)!.records = 0; },
    deleteActiveRoot: async target => { calls.push("root:" + target.path); targets = targets.filter(value => value.path !== target.path); },
    retireLegacyMetadata: async () => { calls.push("metadata"); },
  };
  return { backend, calls, targets: () => targets, unfence: () => { fenced = false; }, failOnce: () => { failDelete = true; } };
}
test("reset dry run returns counts only and never changes reporting or authorization data", async () => {
  const f = fixture(); const before = structuredClone(f.targets());
  assert.deepEqual(await runProfileReset(f.backend, false), { apply: false, installations: 3, reportingRecords: 55, revokedBindingsRetained: 1 });
  assert.deepEqual(f.targets(), before); assert.deepEqual(f.calls, ["verify"]);
});
test("reset removes records before active roots, preserves revocation, and is retryable", async () => {
  const f = fixture(); await runProfileReset(f.backend, true);
  assert.deepEqual(f.targets(), [{ ...active, path: "automaticUploads/fixture-revoked", enabled: false, records: 0 }]);
  assert.ok(f.calls.indexOf("records:" + active.path) < f.calls.indexOf("root:" + active.path));
  assert.equal(f.calls.some(value => value === "root:automaticUploads/fixture-revoked"), false);
  await runProfileReset(f.backend, true);
  assert.equal(f.targets().length, 1);
});
test("reset never applies without the fence and refuses all new profile roots before deletion", async () => {
  const f = fixture(); f.unfence(); await assert.rejects(runProfileReset(f.backend, true));
  assert.deepEqual(f.calls, ["verify"]);
  for (const target of [{ ...active, schemaVersion: 3 }, { ...active, schemaVersion: 4 }, { ...active, path: "other/path" }]) {
    const next = fixture(); next.targets().push(target);
    await assert.rejects(runProfileReset(next.backend, true), /refused/);
    assert.deepEqual(next.calls, ["verify"]);
  }
});
test("reset rechecks roots to protect data created after inventory and can resume deletion failures", async () => {
  const f = fixture(); f.backend.inspect = async target => ({ ...target, schemaVersion: 3 });
  await assert.rejects(runProfileReset(f.backend, true), /refused/);
  assert.equal(f.calls.some(value => value.startsWith("records:")), false);
  const retry = fixture(); retry.failOnce(); await assert.rejects(runProfileReset(retry.backend, true));
  await runProfileReset(retry.backend, true); assert.equal(retry.targets()[0].enabled, false);
});
test("reset verifies exact deployed tested rule source without returning private responses", async () => {
  const rules = "enrollment.schemaVersion == 3\ndata.schemaVersion == 2";
  const credential = { getAccessToken: async () => ({ access_token: "fixture-owner", expires_in: 100 }) };
  for (const [source, passes] of [[rules, true], [rules.replace(/\n/g, "\r\n"), true], [rules + " changed", false]] as const) {
    const calls: string[] = [];
    const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push(String(url)); assert.equal(init?.redirect, "error");
      return new Response(JSON.stringify(calls.length === 1 ? { rulesetName: "projects/demo-workout-sync/rulesets/fixture" } : { source: { files: [{ content: source }] } }));
    }) as typeof fetch;
    const result = verifyDeployedResetFence("demo-workout-sync", credential, rules, fetcher);
    if (passes) await result; else await assert.rejects(result, /tested profile-reset fence/);
    assert.equal(calls.length, 2);
  }
  await assert.rejects(verifyDeployedResetFence("demo-workout-sync", credential, rules, (async () => new Response(JSON.stringify({ rulesetName: "projects/another-project/rulesets/fixture" }))) as typeof fetch), /tested profile-reset fence/);
});

type FakeDocument = Record<string, unknown>;
type FakeWrite = { kind: "create" | "delete"; path: string; value?: FakeDocument };

function adapterFixture(initial: Record<string, FakeDocument>) {
  const documents = new Map<string, FakeDocument>(Object.entries(structuredClone(initial)));
  const versions = new Map<string, number>();
  const calls: FakeWrite[] = [];
  const recursiveCalls: string[] = [];
  const hooks: {
    beforeCommit?: (writes: readonly FakeWrite[]) => Promise<void> | void;
    afterCommit?: (writes: readonly FakeWrite[]) => Promise<void> | void;
  } = {};
  const put = (path: string, value: FakeDocument) => {
    documents.set(path, structuredClone(value));
    versions.set(path, (versions.get(path) ?? 0) + 1);
  };
  const remove = (path: string) => {
    documents.delete(path);
    versions.set(path, (versions.get(path) ?? 0) + 1);
  };
  const snapshot = (path: string) => {
    const value = structuredClone(documents.get(path));
    return { exists: value !== undefined, data: () => value };
  };
  const document = (path: string) => ({
    path,
    get: async () => snapshot(path),
    collection: (id: string) => collection(path + "/" + id),
    listCollections: async () => {
      const depth = path.split("/").length;
      const ids = [...new Set([...documents.keys()]
        .filter(key => key.startsWith(path + "/"))
        .map(key => key.split("/")[depth]))];
      return ids.map(id => collection(path + "/" + id));
    },
    set: async (value: FakeDocument, options?: { merge?: boolean }) =>
      put(path, options?.merge ? { ...documents.get(path), ...value } : value),
    delete: async () => remove(path),
  });
  const collection = (path: string) => ({
    path,
    id: path.split("/").at(-1)!,
    listDocuments: async () => {
      const depth = path.split("/").length + 1;
      return [...new Set([...documents.keys()].filter(key => key.startsWith(path + "/"))
        .map(key => key.split("/").slice(0, depth).join("/")))].map(document);
    },
  });
  const store = {
    doc: document,
    collection,
    recursiveDelete: async (ref: { path: string }) => {
      recursiveCalls.push(ref.path);
      for (const path of [...documents.keys()]) {
        if (path === ref.path || path.startsWith(ref.path + "/")) remove(path);
      }
    },
    runTransaction: async (operation: (tx: {
      get: (ref: { path: string }) => Promise<ReturnType<typeof snapshot>>;
      create: (ref: { path: string }, value: FakeDocument) => void;
      delete: (ref: { path: string }) => void;
    }) => Promise<void>) => {
      for (let attempt = 0; attempt < 5; attempt++) {
        const reads = new Map<string, number>();
        const writes: FakeWrite[] = [];
        await operation({
          get: async ref => {
            reads.set(ref.path, versions.get(ref.path) ?? 0);
            return snapshot(ref.path);
          },
          create: (ref, value) => { writes.push({ kind: "create", path: ref.path, value }); },
          delete: ref => { writes.push({ kind: "delete", path: ref.path }); },
        });
        await hooks.beforeCommit?.(writes);
        // Model Firestore's retry when a document read by the transaction changes.
        if ([...reads].some(([path, version]) => (versions.get(path) ?? 0) !== version)) continue;
        if (writes.some(write => write.kind === "create" && documents.has(write.path))) continue;
        for (const write of writes) {
          calls.push(write);
          if (write.kind === "create") put(write.path, write.value!);
          else remove(write.path);
        }
        await hooks.afterCommit?.(writes);
        return;
      }
      throw new Error("Transaction retries exhausted");
    },
  };
  return {
    documents, put, remove, calls, recursiveCalls, hooks,
    backend: createResetBackend(store as unknown as Firestore, async () => {}),
  };
}

const legacyRoot = "devices/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const reservedRoot = "automaticUploads/fixture-orphan";

test("concrete reset adapter refuses unexpected children before deleting any data", async () => {
  for (const unexpected of [
    reservedRoot + "/unexpected/private",
    reservedRoot + "/records/old/descendants/private",
    legacyRoot + "/unexpected/private",
    legacyRoot + "/generations/old/unexpected/private",
    legacyRoot + "/generations/old/records/old/descendants/private",
    "uploadOwnerMetadata/automatic:fixture-orphan/descendants/private",
    "uploadAuthorizations/fixture-orphan/descendants/private",
  ]) {
    const f = adapterFixture({
      [reservedRoot + "/records/old"]: { old: true },
      [unexpected]: { private: true },
    });
    const before = structuredClone([...f.documents]);
    await assert.rejects(runProfileReset(f.backend, true), /unexpected child collections/);
    assert.deepEqual([...f.documents], before);
    assert.equal(f.calls.length, 0);
    assert.equal(f.recursiveCalls.length, 0);
  }
});

test("concrete adapter reserves orphan namespaces, pages deletes, and preserves disabled roots", async () => {
  const disabled = { schemaVersion: 2, enabled: false, deviceId: "fixture-device" };
  const initial: Record<string, FakeDocument> = {
    [active.path]: { schemaVersion: 2, enabled: true },
    [active.path + "/records/old"]: { old: true },
    ["automaticUploads/fixture-revoked"]: disabled,
    ["automaticUploads/fixture-revoked/records/old"]: { old: true },
    [legacyRoot + "/generations/old"]: { schemaVersion: 1 },
    [legacyRoot + "/generations/old/records/old"]: { old: true },
    "uploadAuthorizations/legacy": { enabled: true, deviceId: "fixture-device" },
    "uploadOwnerMetadata/automatic:fixture-orphan": { alias: "fixture" },
  };
  for (let index = 0; index < 405; index++) initial[reservedRoot + "/records/" + index] = { old: true };
  const f = adapterFixture(initial);
  let reserved = false;
  let orphanDeletePages = 0;
  f.hooks.beforeCommit = writes => {
    const deletes = writes.filter(write => write.kind === "delete" && write.path.startsWith(reservedRoot + "/records/"));
    if (deletes.length) {
      orphanDeletePages += 1;
      assert.ok(deletes.length <= 200);
      assert.deepEqual(f.documents.get(reservedRoot), {
        schemaVersion: 2, enabled: true, profileResetPending: true,
      });
      reserved = true;
    }
  };
  await runProfileReset(f.backend, true);
  assert.equal(reserved, true);
  assert.equal(orphanDeletePages, 3);
  assert.deepEqual(f.documents.get("automaticUploads/fixture-revoked"), disabled);
  assert.deepEqual(f.documents.get("uploadAuthorizations/legacy"), { enabled: false, deviceId: "fixture-device" });
  assert.equal(f.documents.size, 2);
  assert.equal(f.recursiveCalls.some(path => path.startsWith("automaticUploads/")), false);
  await runProfileReset(f.backend, true);
  assert.equal(f.documents.size, 2);
});

test("an orphan reservation is durable and a failed delete resumes without preserving it as a tombstone", async () => {
  const f = adapterFixture({ [reservedRoot + "/records/old"]: { old: true } });
  f.hooks.beforeCommit = writes => {
    if (writes.some(write => write.kind === "delete")) throw new Error("Interrupted cleanup");
  };
  await assert.rejects(runProfileReset(f.backend, true), /Interrupted cleanup/);
  assert.deepEqual(f.documents.get(reservedRoot), {
    schemaVersion: 2, enabled: true, profileResetPending: true,
  });
  assert.ok(f.documents.has(reservedRoot + "/records/old"));
  f.hooks.beforeCommit = undefined;
  await runProfileReset(f.backend, true);
  assert.equal(f.documents.size, 0);
});

test("a new binding created during orphan reservation wins the transaction and is never purged", async () => {
  const f = adapterFixture({ [reservedRoot + "/records/old"]: { old: true } });
  let raced = false;
  f.hooks.beforeCommit = writes => {
    if (!raced && writes.some(write => write.kind === "create" && write.path === reservedRoot)) {
      raced = true;
      f.put(reservedRoot, { schemaVersion: 3, enabled: true });
      f.put(reservedRoot + "/records/new-profile", { schemaVersion: 2, profile: true });
    }
  };
  await assert.rejects(runProfileReset(f.backend, true), /new-version data/);
  assert.equal(raced, true);
  assert.deepEqual(f.documents.get(reservedRoot), { schemaVersion: 3, enabled: true });
  assert.deepEqual(f.documents.get(reservedRoot + "/records/new-profile"), { schemaVersion: 2, profile: true });
  assert.ok(f.documents.has(reservedRoot + "/records/old"));
  assert.equal(f.calls.length, 0);
});

test("stale deletion pages cannot delete a new profile after another cleanup releases the namespace", async () => {
  const recordPath = reservedRoot + "/records/profile";
  const f = adapterFixture({ [recordPath]: { schemaVersion: 1, old: true } });
  let raced = false;
  f.hooks.beforeCommit = writes => {
    if (!raced && writes.some(write => write.kind === "delete" && write.path === recordPath)) {
      raced = true;
      // Another cleanup finishes and releases its root; a v3 installation then
      // enrolls and reuses the old profile document ID before this page commits.
      f.remove(recordPath);
      f.remove(reservedRoot);
      f.put(reservedRoot, { schemaVersion: 3, enabled: true });
      f.put(recordPath, { schemaVersion: 2, profile: "new" });
    }
  };
  await assert.rejects(runProfileReset(f.backend, true), /authorization changed/);
  assert.equal(raced, true);
  assert.deepEqual(f.documents.get(recordPath), { schemaVersion: 2, profile: "new" });
  assert.deepEqual(f.documents.get(reservedRoot), { schemaVersion: 3, enabled: true });
  assert.equal(f.calls.some(write => write.kind === "delete"), false);
});

test("a reservation blocks new enrollment until record deletion and root cleanup finish", async () => {
  const f = adapterFixture({ [reservedRoot + "/records/old"]: { old: true } });
  let attempted = false;
  f.hooks.afterCommit = writes => {
    if (writes.some(write => write.kind === "create" && write.path === reservedRoot)) {
      attempted = true;
      // Existing v2 roots cannot be replaced with a v3 binding under the rules.
      const canCreateBinding = !f.documents.has(reservedRoot);
      assert.equal(canCreateBinding, false);
    }
  };
  await runProfileReset(f.backend, true);
  assert.equal(attempted, true);
  assert.equal(f.documents.size, 0);
});

test("a revocation during record deletion is retained as an authorization tombstone", async () => {
  const root = { schemaVersion: 2, enabled: true, deviceId: "fixture-device" };
  const f = adapterFixture({
    [active.path]: root,
    [active.path + "/records/old"]: { old: true },
  });
  let revoked = false;
  f.hooks.beforeCommit = writes => {
    if (!revoked && writes.some(write => write.kind === "delete" && write.path.includes("/records/"))) {
      revoked = true;
      f.put(active.path, { ...root, enabled: false });
    }
  };
  await runProfileReset(f.backend, true);
  assert.equal(revoked, true);
  assert.deepEqual(f.documents.get(active.path), { ...root, enabled: false });
  assert.equal(f.documents.size, 1);
});
