import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import "firebase/compat/firestore";
import { UPLOAD_KINDS } from "../src/sync/protocol";

const DEVICE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DEVICE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const GENERATION_A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const GENERATION_B = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const INSTALLATION_A = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const INSTALLATION_B = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const UID_A = "rules-phone-a";
const UID_B = "rules-phone-b";
const generation = (deviceId = DEVICE_A, generationId = GENERATION_A) => `devices/${deviceId}/generations/${generationId}`;
const binding = (deviceId = DEVICE_A, generationId = GENERATION_A, installationId = INSTALLATION_A) => ({ schemaVersion: 1, deviceId, generationId, installationId });
const record = (revision = 1, source = "fixture", kind = "workout") => ({
  schemaVersion: 1, deviceId: DEVICE_A, generationId: GENERATION_A, installationId: INSTALLATION_A,
  key: `${kind}:${DEVICE_A}:${source}`, kind, revision, deleted: false,
  payload: { title: "Literal = text", exercises: [{ id: "squat", targets: [1, 2, 3] }], optional: null },
});

test("Firestore rules deny client reads and isolate authenticated upload namespaces", { skip: !process.env.FIRESTORE_EMULATOR_HOST, timeout: 120000 }, async (t) => {
  const address = process.env.FIRESTORE_EMULATOR_HOST!;
  assert.match(address, /^(127\.0\.0\.1|localhost):[0-9]+$/);
  const [host, port] = address.split(":");
  const environment = await initializeTestEnvironment({
    projectId: "demo-workout-sync", firestore: { host, port: Number(port), rules: readFileSync("firebase/firestore.rules", "utf8") },
  });
  const phoneA = environment.authenticatedContext(UID_A).firestore();
  const phoneB = environment.authenticatedContext(UID_B).firestore();
  const unsigned = environment.unauthenticatedContext().firestore();
  const root = generation();
  const records = `${root}/records`;
  t.beforeEach(async () => {
    await environment.clearFirestore();
    await environment.withSecurityRulesDisabled(async (context) => {
      const store = context.firestore();
      await store.doc(`uploadAuthorizations/${UID_A}`).set({ enabled: true, deviceId: DEVICE_A, generationId: GENERATION_A });
      await store.doc(`uploadAuthorizations/${UID_B}`).set({ enabled: true, deviceId: DEVICE_B, generationId: GENERATION_B });
    });
  });
  async function enroll() { await assertSucceeds(phoneA.doc(root).set(binding())); }
  try {
    await t.test("enrollment creates or repeats the exact immutable installation binding", async () => {
      await enroll();
      await assertSucceeds(phoneA.doc(root).set(binding()));
      await assertFails(phoneA.doc(root).set(binding(DEVICE_A, GENERATION_A, INSTALLATION_B)));
      await assertFails(phoneA.doc(root).set({ ...binding(), extra: true }));
      await assertFails(phoneA.doc(root).delete());
      await assertFails(phoneB.doc(root).set(binding()));
      await assertFails(unsigned.doc(root).set(binding()));
    });
    await t.test("every server read list registry write and unknown path is denied", async () => {
      await enroll();
      const value = record();
      await assertSucceeds(phoneA.doc(`${records}/${value.key}`).set(value));
      for (const client of [phoneA, phoneB, unsigned]) {
        for (const path of [root, `${records}/${value.key}`, `uploadAuthorizations/${UID_A}`]) await assertFails(client.doc(path).get({ source: "server" }));
        await assertFails(client.collection(records).get({ source: "server" }));
        await assertFails(client.collection("devices").get({ source: "server" }));
        await assertFails(client.doc(`uploadAuthorizations/${UID_A}`).set({ enabled: true, deviceId: DEVICE_A, generationId: GENERATION_A }));
        await assertFails(client.doc("unknown/document").set({ permitted: true }));
      }
    });
    await t.test("body-weight documents upload only within the authorized phone and remain unreadable", async () => {
      await enroll();
      const value = { ...record(1, "measurement", "body_weight"), payload: { id: "measurement", date: "2026-10-14", weightKg: 81.6466266, updatedAt: "2026-10-14T12:00:00.000Z" } };
      const path = `${records}/${value.key}`;
      await assertSucceeds(phoneA.doc(path).set(value));
      await assertFails(phoneA.doc(path).get({ source: "server" }));
      await assertFails(phoneB.doc(path).set(value));
      await assertFails(unsigned.doc(path).get({ source: "server" }));
      await assertSucceeds(phoneA.doc(path).set({ ...value, revision: 2, deleted: true, payload: {} }));
    });
    await t.test("records require prior enrollment and matching registry namespace and nonce", async () => {
      const value = record();
      await assertFails(phoneA.doc(`${records}/${value.key}`).set(value));
      await enroll();
      await assertFails(phoneB.doc(`${records}/${value.key}`).set(value));
      await assertFails(unsigned.doc(`${records}/${value.key}`).set(value));
      await assertFails(phoneA.doc(`${records}/${value.key}`).set({ ...value, installationId: INSTALLATION_B }));
      await assertFails(phoneA.doc(`${generation(DEVICE_A, GENERATION_B)}/records/${value.key}`).set({ ...value, generationId: GENERATION_B }));
      await assertSucceeds(phoneA.doc(`${records}/${value.key}`).set(value));
      await assertFails(phoneA.doc(`${records}/${value.key}`).delete());
    });
    await t.test("only a higher revision or exact duplicate can replace an existing record", async () => {
      await enroll();
      const value = record(3);
      const ref = phoneA.doc(`${records}/${value.key}`);
      await assertSucceeds(ref.set(value));
      await assertSucceeds(ref.set(value));
      await assertFails(ref.set({ ...value, payload: { title: "Changed at same revision" } }));
      await assertFails(ref.set({ ...value, revision: 2 }));
      await assertSucceeds(ref.set({ ...value, revision: 4, payload: { title: "Newer" } }));
    });
    await t.test("permanent tombstones reject stale resurrection and physical deletion", async () => {
      await enroll();
      const value = record(1);
      const ref = phoneA.doc(`${records}/${value.key}`);
      await assertSucceeds(ref.set(value));
      const deleted = { ...value, revision: 2, deleted: true, payload: {} };
      await assertFails(ref.set({ ...value, revision: 2, deleted: true }));
      await assertSucceeds(ref.set(deleted));
      await assertSucceeds(ref.set(deleted));
      await assertFails(ref.set(value));
      await assertFails(ref.delete());
      await environment.withSecurityRulesDisabled(async (context) => {
        const persisted = (await context.firestore().doc(`${records}/${value.key}`).get()).data();
        assert.equal(persisted?.revision, 2);
        assert.equal(persisted?.deleted, true);
        assert.deepEqual(persisted?.payload, {});
      });
    });
    await t.test("fixed envelope types kinds keys and completion data are enforced", async () => {
      await enroll();
      const value = record();
      for (const invalid of [
        { ...value, schemaVersion: 2 }, { ...value, extra: true }, { ...value, revision: 0 },
        { ...value, revision: 1.5 }, { ...value, revision: Number.MAX_SAFE_INTEGER + 1 },
        { ...value, deleted: "false" }, { ...value, payload: [1, 2] }, { ...value, kind: "unknown" },
        { ...value, deviceId: DEVICE_B }, { ...value, key: "different" },
      ]) await assertFails(phoneA.doc(`${records}/${value.key}`).set(invalid));
      for (const kind of UPLOAD_KINDS) {
        const next = kind === "completion" ? { ...value, key: "completion", kind, payload: { initialUploadComplete: true } } : record(1, kind, kind);
        await assertSucceeds(phoneA.doc(`${records}/${next.key}`).set(next));
      }
      await assertFails(phoneA.doc(`${records}/completion`).set({ ...record(2), key: "completion", kind: "completion", payload: { initialUploadComplete: false } }));
    });
    await t.test("disabling the registry immediately rejects existing authenticated contexts", async () => {
      await enroll();
      await environment.withSecurityRulesDisabled(async (context) => {
        await context.firestore().doc(`uploadAuthorizations/${UID_A}`).update({ enabled: false });
      });
      const value = record();
      await assertFails(phoneA.doc(`${records}/${value.key}`).set(value));
      await assertFails(phoneA.doc(root).set(binding()));
    });
    await t.test("a mixed allowed and denied batch commits none of its writes", async () => {
      await enroll();
      const allowed = record(1, "allowed");
      const rejected = { ...record(1, "denied"), installationId: INSTALLATION_B };
      const batch = phoneA.batch();
      batch.set(phoneA.doc(`${records}/${allowed.key}`), allowed);
      batch.set(phoneA.doc(`${records}/${rejected.key}`), rejected);
      await assertFails(batch.commit());
      await environment.withSecurityRulesDisabled(async (context) => {
        assert.equal((await context.firestore().doc(`${records}/${allowed.key}`).get()).exists, false);
        assert.equal((await context.firestore().doc(`${records}/${rejected.key}`).get()).exists, false);
      });
    });
    await t.test("ten records can be atomically committed and identically retried", async () => {
      await enroll();
      for (let retry = 0; retry < 2; retry++) {
        const batch = phoneA.batch();
        for (let index = 0; index < 10; index++) {
          const value = record(index + 1, String(index));
          batch.set(phoneA.doc(`${records}/${value.key}`), value);
        }
        await assertSucceeds(batch.commit());
      }
      await environment.withSecurityRulesDisabled(async (context) => {
        const result = await context.firestore().collection(records).get();
        assert.equal(result.size, 10);
        assert.equal(result.docs[0].data().payload.title, "Literal = text");
      });
    });
  } finally { await environment.cleanup(); }
});

test("Firebase deployment config exempts recursive payload indexing", () => {
  const config = JSON.parse(readFileSync("firebase.json", "utf8"));
  assert.equal(config.firestore.rules, "firebase/firestore.rules");
  assert.equal(config.emulators.firestore.host, "127.0.0.1");
  const indexes = JSON.parse(readFileSync(config.firestore.indexes, "utf8"));
  assert.deepEqual(indexes, { indexes: [], fieldOverrides: [{ collectionGroup: "records", fieldPath: "payload", indexes: [] }] });
});
