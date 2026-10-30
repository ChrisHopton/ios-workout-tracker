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
const binding = (deviceId = DEVICE_A, generationId = GENERATION_A, installationId = INSTALLATION_A) => ({ schemaVersion: 3, enabled: true, deviceId, generationId, installationId });
const record = (revision = 1, source = "fixture", kind = "workout") => ({
  schemaVersion: 2, deviceId: DEVICE_A, generationId: GENERATION_A, installationId: INSTALLATION_A,
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
  const phoneA = environment.authenticatedContext(UID_A, { firebase: { sign_in_provider: "anonymous", identities: {} } }).firestore();
  const phoneB = environment.authenticatedContext(UID_B, { firebase: { sign_in_provider: "anonymous", identities: {} } }).firestore();
  const unsigned = environment.unauthenticatedContext().firestore();
  const root = `automaticUploads/${UID_A}`;
  const records = `${root}/records`;
  t.beforeEach(async () => {
    await environment.clearFirestore();
    await environment.withSecurityRulesDisabled(async (context) => {
      const store = context.firestore();
      await store.doc(`uploadAuthorizations/${UID_A}`).set({ enabled: true, deviceId: DEVICE_A, generationId: GENERATION_A });
      await store.doc(`uploadAuthorizations/${UID_B}`).set({ enabled: true, deviceId: DEVICE_B, generationId: GENERATION_B });
    });
  });
  async function enroll() {
    await environment.withSecurityRulesDisabled(async context => { await context.firestore().doc("uploadControl/automaticEnrollment").set({ enabled: true }); });
    await assertSucceeds(phoneA.doc(root).set(binding()));
  }
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
    await t.test("routine progress keeps the existing upload-only owner and generation fence", async () => {
      await enroll();
      const value = { ...record(1, "routine%3A0", "schedule_progress"), payload: {
        id: "routine:0", routineId: "routine", ordinal: 0, templateId: "plan", dueDate: "2026-10-26",
        resolvedDate: "2026-10-27", resolvedAt: "2026-10-27T12:00:00.000Z", outcome: "completed", sessionId: "session",
      } };
      const path = `${records}/${value.key}`;
      await assertSucceeds(phoneA.doc(path).set(value));
      await assertFails(phoneA.doc(path).get({ source: "server" }));
      await assertFails(phoneB.doc(path).set(value));
      await assertFails(unsigned.doc(path).set(value));
      await assertFails(phoneA.doc(path).set({ ...value, revision: 2, generationId: GENERATION_B }));
      await assertFails(phoneA.doc(path).set({ ...value, revision: 2, installationId: INSTALLATION_B }));
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
        { ...value, schemaVersion: 1 }, { ...value, extra: true }, { ...value, revision: 0 },
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
    await t.test("disabling the binding immediately rejects existing authenticated contexts", async () => {
      await enroll();
      await environment.withSecurityRulesDisabled(async (context) => {
        await context.firestore().doc(root).update({ enabled: false });
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
    const automaticUid = "automatic-phone-a";
    const otherAutomaticUid = "automatic-phone-b";
    const automaticA = environment.authenticatedContext(automaticUid, { firebase: { sign_in_provider: "anonymous", identities: {} } }).firestore();
    const automaticB = environment.authenticatedContext(otherAutomaticUid, { firebase: { sign_in_provider: "anonymous", identities: {} } }).firestore();
    const automaticRoot = "automaticUploads/" + automaticUid;
    const automaticRecords = automaticRoot + "/records";
    const automaticBinding = () => binding();
    const enrollmentControl = "uploadControl/automaticEnrollment";
    async function gate(enabled: boolean) {
      await environment.withSecurityRulesDisabled(async (context) => { await context.firestore().doc(enrollmentControl).set({ enabled }); });
    }
    async function enrollAutomatic() {
      await gate(true);
      await assertSucceeds(automaticA.doc(automaticRoot).set(automaticBinding()));
    }
    await t.test("automatic creation fails closed until owner enrollment gate opens and requires own anonymous UID", async () => {
      await assertFails(automaticA.doc(automaticRoot).set(automaticBinding()));
      await gate(false);
      await assertFails(automaticA.doc(automaticRoot).set(automaticBinding()));
      await gate(true);
      await assertFails(automaticB.doc(automaticRoot).set(automaticBinding()));
      await assertFails(unsigned.doc(automaticRoot).set(automaticBinding()));
      const passwordPhone = environment.authenticatedContext("password-phone", { firebase: { sign_in_provider: "password", identities: {} } }).firestore();
      await assertFails(passwordPhone.doc("automaticUploads/password-phone").set(automaticBinding()));
      for (const invalid of [
        { ...automaticBinding(), enabled: false }, { ...automaticBinding(), schemaVersion: 1 },
        { ...automaticBinding(), deviceId: "invalid" }, { ...automaticBinding(), generationId: "invalid" },
        { ...automaticBinding(), installationId: "invalid" }, { ...automaticBinding(), extra: true },
      ]) await assertFails(automaticA.doc(automaticRoot).set(invalid));
      await assertSucceeds(automaticA.doc(automaticRoot).set(automaticBinding()));
    });
    await t.test("automatic binding retries remain exact and succeed after new enrollment is disabled", async () => {
      await enrollAutomatic();
      await gate(false);
      await assertSucceeds(automaticA.doc(automaticRoot).set(automaticBinding()));
      const value = record();
      await assertSucceeds(automaticA.doc(automaticRecords + "/" + value.key).set(value));
      await assertFails(automaticB.doc("automaticUploads/" + otherAutomaticUid).set(automaticBinding()));
      await environment.withSecurityRulesDisabled(async (context) => { await context.firestore().doc(enrollmentControl).delete(); });
      await assertSucceeds(automaticA.doc(automaticRoot).set(automaticBinding()));
      for (const changed of [
        { ...automaticBinding(), deviceId: DEVICE_B }, { ...automaticBinding(), generationId: GENERATION_B },
        { ...automaticBinding(), installationId: INSTALLATION_B }, { ...automaticBinding(), enabled: false },
        { ...automaticBinding(), alias: "New alias" },
      ]) await assertFails(automaticA.doc(automaticRoot).set(changed));
      await assertFails(automaticA.doc(automaticRoot).delete());
      await assertFails(phoneA.doc(generation()).set({ schemaVersion: 1, deviceId: DEVICE_A, generationId: GENERATION_A, installationId: INSTALLATION_A }));
    });
    await t.test("UID-scoped automatic namespaces remain isolated with identical UUIDs and no first-two cap", async () => {
      await enrollAutomatic();
      const third = environment.authenticatedContext("automatic-phone-c", { firebase: { sign_in_provider: "anonymous", identities: {} } }).firestore();
      await assertSucceeds(automaticB.doc("automaticUploads/" + otherAutomaticUid).set(automaticBinding()));
      await assertSucceeds(third.doc("automaticUploads/automatic-phone-c").set(automaticBinding()));
      const value = record();
      await assertSucceeds(automaticA.doc(automaticRecords + "/" + value.key).set(value));
      await assertSucceeds(automaticB.doc("automaticUploads/" + otherAutomaticUid + "/records/" + value.key).set({ ...value, payload: { separate: true } }));
      await assertFails(automaticB.doc(automaticRecords + "/" + value.key).set({ ...value, revision: 2 }));
      await assertFails(automaticB.doc(automaticRoot).set(automaticBinding()));
      await assertFails(automaticA.doc(records + "/" + value.key).set(value));
      await assertFails(phoneA.doc(automaticRecords + "/" + value.key).set(value));
    });
    await t.test("automatic clients cannot read their data or administer enrollment and owner aliases", async () => {
      await enrollAutomatic();
      const value = record();
      await assertSucceeds(automaticA.doc(automaticRecords + "/" + value.key).set(value));
      for (const client of [automaticA, automaticB, unsigned]) {
        for (const path of [automaticRoot, automaticRecords + "/" + value.key, enrollmentControl, "uploadOwnerMetadata/automatic:" + automaticUid]) {
          await assertFails(client.doc(path).get({ source: "server" }));
        }
        await assertFails(client.collection("automaticUploads").get({ source: "server" }));
        await assertFails(client.collection(automaticRecords).get({ source: "server" }));
        await assertFails(client.doc(enrollmentControl).set({ enabled: true }));
        await assertFails(client.doc("uploadOwnerMetadata/automatic:" + automaticUid).set({ alias: "Owner" }));
      }
    });
    await t.test("automatic records require prior binding and every bound identity field", async () => {
      await gate(true);
      const value = record();
      const path = automaticRecords + "/" + value.key;
      await assertFails(automaticA.doc(path).set(value));
      const together = automaticA.batch();
      together.set(automaticA.doc(automaticRoot), automaticBinding());
      together.set(automaticA.doc(path), value);
      await assertFails(together.commit());
      await assertSucceeds(automaticA.doc(automaticRoot).set(automaticBinding()));
      for (const changed of [
        { ...value, deviceId: DEVICE_B }, { ...value, generationId: GENERATION_B },
        { ...value, installationId: INSTALLATION_B }, { ...value, revision: 0 },
        { ...value, deleted: true }, { ...value, schemaVersion: 1 }, { ...value, extra: true },
      ]) await assertFails(automaticA.doc(path).set(changed));
      await assertSucceeds(automaticA.doc(path).set(value));
      for (const kind of UPLOAD_KINDS) {
        const next = kind === "completion" ? { ...value, key: "completion", kind, payload: { initialUploadComplete: true } } : record(1, kind, kind);
        await assertSucceeds(automaticA.doc(automaticRecords + "/" + next.key).set(next));
      }
      await assertFails(automaticA.doc(path).delete());
    });
    await t.test("automatic exact retries monotonic revisions and tombstones preserve existing records", async () => {
      await enrollAutomatic();
      const value = record(3);
      const ref = automaticA.doc(automaticRecords + "/" + value.key);
      await assertSucceeds(ref.set(value));
      await assertSucceeds(ref.set(value));
      await assertFails(ref.set({ ...value, payload: { changed: true } }));
      await assertFails(ref.set({ ...value, revision: 2 }));
      const deleted = { ...value, revision: 4, deleted: true, payload: {} };
      await assertSucceeds(ref.set(deleted));
      await assertSucceeds(ref.set(deleted));
      await assertFails(ref.set(value));
    });
    await t.test("revoked automatic roots reject writes and cannot be deleted or reenabled by the same account", async () => {
      await enrollAutomatic();
      const value = record();
      await assertSucceeds(automaticA.doc(automaticRecords + "/" + value.key).set(value));
      await environment.withSecurityRulesDisabled(async (context) => { await context.firestore().doc(automaticRoot).update({ enabled: false }); });
      await assertFails(automaticA.doc(automaticRecords + "/" + value.key).set(value));
      await assertFails(automaticA.doc(automaticRoot).set(automaticBinding()));
      await assertFails(automaticA.doc(automaticRoot).set({ ...automaticBinding(), enabled: false }));
      await assertFails(automaticA.doc(automaticRoot).delete());
      await environment.withSecurityRulesDisabled(async (context) => {
        assert.equal((await context.firestore().doc(automaticRoot).get()).data()?.enabled, false);
        assert.equal((await context.firestore().doc(automaticRecords + "/" + value.key).get()).exists, true);
      });
    });
    await t.test("ten automatic records atomically retry and a denied batch retains neither write", async () => {
      await enrollAutomatic();
      for (let retry = 0; retry < 2; retry++) {
        const batch = automaticA.batch();
        for (let index = 0; index < 10; index++) {
          const value = record(1, String(index));
          batch.set(automaticA.doc(automaticRecords + "/" + value.key), value);
        }
        await assertSucceeds(batch.commit());
      }
      const allowed = record(1, "batch-allowed");
      const denied = { ...record(1, "batch-denied"), installationId: INSTALLATION_B };
      const batch = automaticA.batch();
      batch.set(automaticA.doc(automaticRecords + "/" + allowed.key), allowed);
      batch.set(automaticA.doc(automaticRecords + "/" + denied.key), denied);
      await assertFails(batch.commit());
      await environment.withSecurityRulesDisabled(async (context) => {
        assert.equal((await context.firestore().doc(automaticRecords + "/" + allowed.key).get()).exists, false);
        assert.equal((await context.firestore().collection(automaticRecords).get()).size, 10);
      });
    });
    await t.test("old releases cannot enroll or write even with live authentication and matching reset identity", async () => {
      await gate(true);
      await assertFails(automaticA.doc(automaticRoot).set({ ...binding(), schemaVersion: 2 }));
      await assertFails(phoneA.doc(generation()).set({ schemaVersion: 1, deviceId: DEVICE_A, generationId: GENERATION_A, installationId: INSTALLATION_A }));
      await assertFails(phoneA.doc(generation() + "/records/" + record().key).set({ ...record(), schemaVersion: 1 }));
      await environment.withSecurityRulesDisabled(async context => {
        await context.firestore().doc(automaticRoot).set({ ...binding(), schemaVersion: 2 });
      });
      await assertFails(automaticA.doc(automaticRecords + "/" + record().key).set(record()));
      await assertFails(automaticA.doc(automaticRoot).set(binding()));
      await environment.withSecurityRulesDisabled(async context => { await context.firestore().doc(automaticRoot).delete(); });
      const nextBinding = { ...binding(), generationId: GENERATION_B, installationId: INSTALLATION_B };
      await assertSucceeds(automaticA.doc(automaticRoot).set(nextBinding));
      await assertFails(automaticA.doc(automaticRecords + "/" + record().key).set(record()));
      const nextRecord = { ...record(), generationId: GENERATION_B, installationId: INSTALLATION_B };
      await assertFails(automaticA.doc(automaticRecords + "/" + record().key).set({ ...nextRecord, schemaVersion: 1 }));
      await assertSucceeds(automaticA.doc(automaticRecords + "/" + record().key).set(nextRecord));
    });
    await t.test("old revoked roots remain an enrollment tombstone after their records are purged", async () => {
      await gate(true);
      await environment.withSecurityRulesDisabled(async context => {
        await context.firestore().doc(automaticRoot).set({ ...binding(), schemaVersion: 2, enabled: false });
      });
      await assertFails(automaticA.doc(automaticRoot).set(binding()));
      await assertFails(automaticA.doc(automaticRecords + "/" + record().key).set(record()));
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
