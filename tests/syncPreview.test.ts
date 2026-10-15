import test from "node:test";
import assert from "node:assert/strict";
import { createPreviewTransport } from "../src/sync/previewTransport";
import { makeDocumentKey, type DocumentChange, type SyncCredentials } from "../src/sync/protocol";

const DEVICE = "11111111-1111-4111-8111-111111111111";
const GENERATION = "22222222-2222-4222-8222-222222222222";
const INSTALLATION = "33333333-3333-4333-8333-333333333333";
const OTHER_INSTALLATION = "44444444-4444-4444-8444-444444444444";
const CREDENTIALS: SyncCredentials = {
  version: 1, projectId: "workout-test", apiKey: "a".repeat(39), deviceId: DEVICE,
  generationId: GENERATION, uid: "phone_one", email: "phone@example.com", password: "private-test-password",
};
function change(revision = 1, id = "one", payload = { title: "Workout" }): DocumentChange {
  return { key: makeDocumentKey("workout", DEVICE, id), kind: "workout", payload, revision, deleted: false };
}

test("preview binds one immutable installation and allows credentials to rotate in the same namespace", async () => {
  const transport = createPreviewTransport();
  await assert.rejects(transport({ action: "upload", installationId: INSTALLATION, changes: [change()] }, CREDENTIALS), /Connect/);
  assert.deepEqual(await transport({ action: "bind", installationId: INSTALLATION }, CREDENTIALS), { acknowledged: [] });
  await transport({ action: "bind", installationId: INSTALLATION }, { ...CREDENTIALS, uid: "rotated_uid" });
  await assert.rejects(transport({ action: "bind", installationId: OTHER_INSTALLATION }, CREDENTIALS), /already bound/);
  const other = { ...CREDENTIALS, generationId: OTHER_INSTALLATION };
  await transport({ action: "bind", installationId: OTHER_INSTALLATION }, other);
  assert.deepEqual(await transport({ action: "upload", installationId: OTHER_INSTALLATION, changes: [change()] }, other), {
    acknowledged: [{ key: change().key, revision: 1 }],
  });
});

test("preview rejects stale writes atomically and accepts exact duplicates regardless of object key order", async () => {
  const transport = createPreviewTransport();
  await transport({ action: "bind", installationId: INSTALLATION }, CREDENTIALS);
  const original = { ...change(2), payload: { first: 1, second: 2 } };
  await transport({ action: "upload", installationId: INSTALLATION, changes: [original] }, CREDENTIALS);
  await transport({
    action: "upload", installationId: INSTALLATION,
    changes: [{ ...original, payload: { second: 2, first: 1 } }],
  }, CREDENTIALS);
  const firstAttempt = change(1, "new", { title: "Rejected batch value" });
  await assert.rejects(transport({
    action: "upload", installationId: INSTALLATION, changes: [firstAttempt, change(1)],
  }, CREDENTIALS), /stale/);
  const nextAttempt = change(1, "new", { title: "Accepted after atomic rejection" });
  await transport({ action: "upload", installationId: INSTALLATION, changes: [nextAttempt] }, CREDENTIALS);
  await assert.rejects(transport({
    action: "upload", installationId: INSTALLATION, changes: [change(2)],
  }, CREDENTIALS), /stale or changed/);
});

test("preview retains tombstones so late retries cannot resurrect removed records", async () => {
  const transport = createPreviewTransport();
  await transport({ action: "bind", installationId: INSTALLATION }, CREDENTIALS);
  await transport({ action: "upload", installationId: INSTALLATION, changes: [change(2)] }, CREDENTIALS);
  const removed = { ...change(3), payload: {}, deleted: true };
  await transport({ action: "upload", installationId: INSTALLATION, changes: [removed] }, CREDENTIALS);
  await transport({ action: "upload", installationId: INSTALLATION, changes: [removed] }, CREDENTIALS);
  await assert.rejects(transport({ action: "upload", installationId: INSTALLATION, changes: [change(2)] }, CREDENTIALS), /stale/);
  await transport({ action: "upload", installationId: INSTALLATION, changes: [change(4)] }, CREDENTIALS);
});

test("preview handles large independent namespaces without network access", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Preview must never use network"); };
  try {
    const transport = createPreviewTransport();
    await transport({ action: "bind", installationId: INSTALLATION }, CREDENTIALS);
    for (let index = 0; index < 10_000; index += 10) {
      const changes = Array.from({ length: 10 }, (_, offset) => change(index + offset + 1, String(index + offset)));
      const receipt = await transport({ action: "upload", installationId: INSTALLATION, changes }, CREDENTIALS);
      assert.equal(receipt.acknowledged.length, 10);
    }
    const other = { ...CREDENTIALS, deviceId: OTHER_INSTALLATION, uid: "phone_two" };
    await transport({ action: "bind", installationId: OTHER_INSTALLATION }, other);
    const own = { ...change(), key: makeDocumentKey("workout", other.deviceId, "one") };
    await transport({ action: "upload", installationId: OTHER_INSTALLATION, changes: [own] }, other);
    await assert.rejects(transport({ action: "upload", installationId: OTHER_INSTALLATION, changes: [change()] }, other), /invalid/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("preview cancellation cannot establish a binding and completion has a separate receipt", async () => {
  const transport = createPreviewTransport();
  await assert.rejects(transport({ action: "bind", installationId: INSTALLATION }, CREDENTIALS, () => false), /paused/);
  await assert.rejects(transport({ action: "upload", installationId: INSTALLATION, changes: [change()] }, CREDENTIALS), /Connect/);
  await transport({ action: "bind", installationId: INSTALLATION }, CREDENTIALS);
  const completion: DocumentChange = {
    key: "completion", kind: "completion", payload: { initialUploadComplete: true }, revision: 2, deleted: false,
  };
  assert.deepEqual(await transport({ action: "upload", installationId: INSTALLATION, changes: [completion] }, CREDENTIALS), {
    acknowledged: [{ key: "completion", revision: 2 }],
  });
});
