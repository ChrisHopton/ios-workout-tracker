import { initialData } from "../src/domain/library";
import test from "node:test";
import assert from "node:assert/strict";
import { validateData } from "../src/domain/backup";
import { AppData, WorkoutSession, WorkoutTemplate } from "../src/domain/types";
import {
  BATCH_METADATA_RESERVE_BYTES, byteLength, DocumentChange, JsonObject, encodedBatchBytes,
  encodeFirestoreDocument, encodeFirestoreValue, makeBatch, makeDocumentKey,
  MAX_BATCH_BYTES, MAX_BATCH_DOCUMENTS, MAX_DOCUMENT_KEY_BYTES, parseCommitReceipt,
  parseConnectionCode, recordDocumentName, SyncCredentials, validateCredentials,
  validateDocument, validateDocumentChange, validateIdentity,
} from "../src/sync/protocol";
import {
  changedDocuments, changedRows, makeCompletionDocument, makeProfileDocument,
  projectData, projectMetadata, projectSession,
} from "../src/sync/projection";

const DEVICE_A = "11111111-1111-4111-8111-111111111111";
const DEVICE_B = "22222222-2222-4222-8222-222222222222";
const GENERATION = "33333333-3333-4333-8333-333333333333";
const INSTALLATION = "44444444-4444-4444-8444-444444444444";
const credentials: SyncCredentials = {
  version: 1, projectId: "workout-test", apiKey: "fake-api-key-for-local-tests-only",
  deviceId: DEVICE_A, generationId: GENERATION, uid: "fake-owner-uid",
  email: "fake-phone@example.invalid", password: "fake-password-for-local-tests-only",
};
const timestamp = "2025-03-09T12:34:56.000Z";
function fixture(): AppData {
  const template: WorkoutTemplate = {
    id: "plan:one/日本", title: "=SUM(1,2)",
    exercises: [{ exerciseId: "exercise:one/日本", sets: 2, repMin: 8, repMax: 12 }],
    recurrence: { kind: "weekly" },
    weekdays: [6, 0], archived: false, updatedAt: timestamp,
  };
  const unused: WorkoutTemplate = {
    id: "plan:unused", title: "=SUM(1,2)",
    exercises: [{ exerciseId: "exercise:bodyweight", sets: 1, repMin: 5, repMax: 9 }],
    recurrence: { kind: "weekly" },
    weekdays: [], archived: true, updatedAt: "2024-12-31T01:00:00.000Z",
  };
  const session: WorkoutSession = {
    id: "session:old/🧪", date: "2025-03-09", title: "Old title", templateId: template.id,
    unit: "kg", status: "in_progress", hasFinished: false, routineOccurrence: null, startedAt: timestamp, updatedAt: timestamp, finishedAt: null,
    exercises: [
      {
        exercise: { id: "exercise:one/日本", name: "Historical lift", group: "Back", equipment: "barbell", incrementLb: 10, incrementKg: 5 },
        target: { exerciseId: "exercise:one/日本", sets: 2, repMin: 3, repMax: 7 },
        suggestion: { algorithmVersion: 1, weights: [0, 52.5], reason: "=literal suggestion 🧪" },
        sets: [{ classification: "working", weight: "0", reps: "007", status: "completed" }, { classification: "working", weight: "", reps: "", status: "pending" }],
      },
      {
        exercise: { id: "exercise:bodyweight", name: "Old push-up", group: "Chest", equipment: "bodyweight", incrementLb: 5, incrementKg: 2.5 },
        target: { exerciseId: "exercise:bodyweight", sets: 2, repMin: 10, repMax: 15 },
        suggestion: { algorithmVersion: 1, weights: [null, null], reason: "Bodyweight reps only" },
        sets: [{ classification: "working", weight: "", reps: "12", status: "completed" }, { classification: "working", weight: "", reps: "", status: "skipped" }],
      },
    ],
  };
  return {
    schemaVersion: 4, routineProgress: [], bodyWeights: [], settings: { ...initialData().settings, firstName: "+literal name", gender: "Male", heightCm: 181.5, unit: "lb" },
    exercises: [
      { ...session.exercises[0].exercise, name: "Current lift", incrementLb: 5, incrementKg: 2.5 },
      { ...session.exercises[1].exercise, name: "Current push-up" },
    ],
    templates: [template, unused],
    scheduleRevisions: [{
      id: "revision:old", routine: { mode: "fixed" }, effectiveDate: "2025-03-09", anchorMonday: "2025-03-03",
      slots: [{ weekday: 6, workoutIds: [template.id, template.id] }, { weekday: 0, workoutIds: [null, null] }],
      templates: [{ ...template, title: "Historical plan", exercises: [{ ...template.exercises[0], sets: 4 }] }, unused],
    }],
    sessions: [session],
  };
}
function change(index: number, text = ""): DocumentChange {
  return { key: makeDocumentKey("exercise", DEVICE_A, `id-${index}`), kind: "exercise", payload: { id: `id-${index}`, name: text, index }, revision: index + 1, deleted: false };
}
function encodeCode(value: unknown): string {
  return `WORKOUTFB1.${Buffer.from(JSON.stringify(value), "utf8").toString("base64url")}`;
}
function worstCaseFixture(): AppData {
  const exercises = Array.from({ length: 100 }, (_, index) => ({
    id: "界".repeat(97) + String(index).padStart(3, "0"), name: "界".repeat(120),
    group: "Back" as const, equipment: "barbell" as const, incrementLb: 1000, incrementKg: 1000,
  }));
  const template: WorkoutTemplate = {
    id: "界".repeat(100), title: "界".repeat(120),
    exercises: exercises.map((exercise) => ({ exerciseId: exercise.id, sets: 30, repMin: 1, repMax: 1000 })),
    recurrence: { kind: "weekly" },
    weekdays: [0, 1, 2, 3, 4, 5, 6], archived: false, updatedAt: timestamp,
  };
  const session: WorkoutSession = {
    id: "語".repeat(100), date: "2025-03-09", title: "界".repeat(120), templateId: template.id,
    unit: "lb", status: "completed", hasFinished: true, routineOccurrence: null, startedAt: timestamp, updatedAt: timestamp, finishedAt: timestamp,
    exercises: exercises.map((exercise, index) => ({
      exercise, target: template.exercises[index], suggestion: { algorithmVersion: 1, weights: Array.from({ length: 30 }, () => 100000), reason: "界".repeat(2000) },
      sets: Array.from({ length: 30 }, () => ({ classification: "working" as const, weight: "9999.12345678901", reps: "0000000000000999", status: "completed" as const })),
    })),
  };
  const data: AppData = {
    schemaVersion: 4, routineProgress: [], bodyWeights: [], settings: { ...initialData().settings, firstName: "界".repeat(80), gender: "Female", heightCm: 300, unit: "kg" },
    exercises, templates: [template], sessions: [session],
    scheduleRevisions: [{
      id: "史".repeat(100), routine: { mode: "fixed" }, effectiveDate: "2025-03-09", anchorMonday: "2025-03-03",
      slots: Array.from({ length: 7 }, (_, weekday) => ({ weekday, workoutIds: [template.id, template.id] })),
      templates: [structuredClone(template), { ...structuredClone(template), id: "unused", archived: true }],
    }],
  };
  validateData(data);
  return data;
}

test("projection is deterministic detached from input and namespaced by device identity", () => {
  const data = fixture();
  const original = JSON.stringify(data);
  const documents = projectData(data, DEVICE_A, "=literal phone 🧪");
  assert.equal(new Set(documents.map((item) => item.key)).size, documents.length);
  documents.forEach((item) => {
    assert.deepEqual(validateDocument(item, DEVICE_A), item);
    assert.ok(item.key.startsWith(`${item.kind}:${DEVICE_A}:`));
    assert.ok(!item.key.includes("/"));
    for (const part of item.key.split(":")) assert.equal(encodeURIComponent(decodeURIComponent(part)), part);
  });
  assert.deepEqual(documents[0], { key: `profile:${DEVICE_A}:settings`, kind: "profile", payload: { phoneLabel: "=literal phone 🧪", ...data.settings } });
  assert.deepEqual(projectData(data, DEVICE_A, "=literal phone 🧪"), documents);
  assert.equal(JSON.stringify(data), original);
  assert.deepEqual(projectData(data, DEVICE_A, "Phone"), [...projectMetadata(data, DEVICE_A, "Phone"), ...projectSession(data.sessions[0], DEVICE_A)]);
  data.sessions[0].exercises[0].sets[0].weight = "999";
  data.scheduleRevisions[0].slots[1].workoutIds.push("changed");
  assert.equal(((documents.find((item) => item.kind === "workout_exercise")!.payload.sets as { classification: "working", weight: string }[])[0]).weight, "0");
  assert.deepEqual((documents.find((item) => item.kind === "schedule")!.payload.slots as { workoutIds: string[] }[])[1].workoutIds, [null, null]);
});

test("projection retains every field needed to reconstruct ordered history and current settings", () => {
  const data = fixture();
  const documents = projectData(data, DEVICE_A, "Phone");
  const { phoneLabel, ...settings } = documents.find((item) => item.kind === "profile")!.payload;
  assert.equal(phoneLabel, "Phone");
  assert.deepEqual(settings, data.settings);
  assert.deepEqual(documents.filter((item) => item.kind === "exercise").map(({ payload: { index, ...exercise } }) => exercise), data.exercises);
  assert.deepEqual(documents.filter((item) => item.kind === "plan").map(({ payload: { index, ...template } }) => template), data.templates);
  const revision = documents.find((item) => item.kind === "schedule")!.payload;
  const { index: revisionIndex, templateCount, ...revisionHeader } = revision;
  assert.equal(revisionIndex, 0);
  assert.equal(templateCount, 2);
  const snapshotDocuments = documents.filter((item) => item.kind === "schedule_template");
  assert.deepEqual(snapshotDocuments.map((item) => item.payload.index), [0, 1]);
  assert.deepEqual({ ...revisionHeader, templates: snapshotDocuments.map((item) => item.payload.template) }, data.scheduleRevisions[0]);
  const header = documents.find((item) => item.kind === "workout")!.payload;
  const { exerciseCount, ...workoutHeader } = header;
  assert.equal(exerciseCount, 2);
  const exerciseDocuments = documents.filter((item) => item.kind === "workout_exercise");
  assert.deepEqual(exerciseDocuments.map((item) => [item.payload.sessionId, item.payload.index]), [[data.sessions[0].id, 0], [data.sessions[0].id, 1]]);
  assert.deepEqual({ ...workoutHeader, exercises: exerciseDocuments.map(({ payload: { sessionId, index, ...entry } }) => entry) }, data.sessions[0]);
});

test("historical snapshots empty slots unassigned templates and literal text survive current edits", () => {
  const data = fixture();
  const before = projectData(data, DEVICE_A, "Phone");
  const changed = structuredClone(data);
  changed.settings.unit = "kg";
  changed.exercises[0].name = "New current name";
  changed.templates[0].title = "New current plan";
  changed.templates[0].exercises[0].sets = 3;
  const delta = changedDocuments(before, projectData(changed, DEVICE_A, "Phone"));
  assert.deepEqual(new Set(delta.map((item) => item.kind)), new Set(["profile", "exercise", "plan"]));
  const schedule = before.find((item) => item.kind === "schedule")!;
  assert.deepEqual((schedule.payload.slots as { workoutIds: string[] }[])[1].workoutIds, [null, null]);
  const snapshots = before.filter((item) => item.kind === "schedule_template");
  assert.equal((snapshots[1].payload.template as { archived: boolean }).archived, true);
  assert.deepEqual((snapshots[1].payload.template as { weekdays: number[] }).weekdays, []);
  assert.equal((snapshots[0].payload.template as { title: string }).title, "Historical plan");
  const plans = before.filter((item) => item.kind === "plan");
  assert.equal(plans[0].payload.title, "=SUM(1,2)");
  assert.equal(plans[1].payload.title, "=SUM(1,2)");
  assert.notEqual(plans[0].key, plans[1].key);
});

test("one workout exercise contains ordered sets with exact drafts zero null and bodyweight unit", () => {
  const data = fixture();
  const documents = projectSession(data.sessions[0], DEVICE_A);
  assert.equal(documents.length, 3);
  assert.equal(documents[0].payload.unit, "kg");
  assert.equal(documents[0].payload.date, "2025-03-09");
  assert.equal(documents[0].payload.finishedAt, null);
  assert.deepEqual(documents[1].payload, { sessionId: data.sessions[0].id, index: 0, ...data.sessions[0].exercises[0] });
  assert.deepEqual(documents[2].payload, { sessionId: data.sessions[0].id, index: 1, ...data.sessions[0].exercises[1] });
  const entry = documents[2].payload;
  assert.equal((entry.exercise as { equipment: string }).equipment, "bodyweight");
  assert.deepEqual((entry.suggestion as { weights: (number | null)[] }).weights, [null, null]);
  assert.deepEqual((entry.sets as { classification: "working", weight: string; reps: string }[]).map((set) => [set.weight, set.reps]), [["", "12"], ["", ""]]);
  const completed = { ...data.sessions[0], status: "completed" as const, finishedAt: timestamp };
  assert.equal(projectSession(completed, DEVICE_A)[0].payload.finishedAt, timestamp);
});

test("clear versus zero updates one exercise document and tombstones clear personal payload", () => {
  const data = fixture();
  const before = projectData(data, DEVICE_A, "Phone");
  const cleared = structuredClone(data);
  cleared.sessions[0].exercises[0].sets[0].weight = "";
  const delta = changedDocuments(before, projectData(cleared, DEVICE_A, "Phone"));
  assert.equal(delta.length, 1);
  assert.equal(delta[0].kind, "workout_exercise");
  assert.equal(delta[0].deleted, false);
  assert.equal((delta[0].payload.sets as { classification: "working", weight: string }[])[0].weight, "");
  const tombstones = changedDocuments(before, projectMetadata(data, DEVICE_A, "Phone"));
  assert.equal(tombstones.length, 3);
  assert.ok(tombstones.every((item) => item.deleted));
  assert.deepEqual(tombstones.map(({ deleted, ...item }) => item), projectSession(data.sessions[0], DEVICE_A).map((item) => ({ ...item, payload: {} })));
  assert.ok(tombstones.every((item) => Object.keys(item.payload).length === 0));
  assert.ok(!JSON.stringify(tombstones).includes("Historical lift"));
  assert.deepEqual(changedDocuments(before, before), []);
  assert.deepEqual(changedRows(before, before), []);
  assert.deepEqual(changedDocuments([], before), before.map((item) => ({ ...item, deleted: false })));
  const reordered = before.map((item) => ({ ...item, payload: Object.fromEntries(Object.entries(item.payload).reverse()) }));
  assert.deepEqual(changedDocuments(before, reordered), []);
});

test("cleared profile values remain exact and completion markers have their fixed shape", () => {
  const profile = makeProfileDocument({ ...initialData().settings, unit: "kg" }, DEVICE_A, "Phone");
  assert.deepEqual(profile.payload, { phoneLabel: "Phone", ...initialData().settings, unit: "kg" });
  const completion = { ...makeCompletionDocument(), revision: 1, deleted: false };
  assert.deepEqual(validateDocumentChange(completion, DEVICE_A), completion);
  for (const item of [{ ...completion, deleted: true }, { ...completion, payload: { initialUploadComplete: false } }, { ...completion, payload: { initialUploadComplete: true, extra: 1 } }])
    assert.throws(() => validateDocumentChange(item), /Invalid upload document/);
  assert.throws(() => makeDocumentKey("exercise", DEVICE_A, Infinity), /Invalid upload document key/);
});

test("same records on two phones never collide and profile rename updates only profile", () => {
  const data = fixture();
  data.sessions = Array.from({ length: 200 }, (_, index) => ({ ...data.sessions[0], id: `history-${index}` }));
  const a = projectData(data, DEVICE_A, "Same name");
  const b = projectData(data, DEVICE_B, "Same name");
  assert.equal(new Set([...a, ...b].map((item) => item.key)).size, a.length * 2);
  assert.deepEqual(a.map((item) => item.payload), b.map((item) => item.payload));
  const renamed = changedDocuments(a, projectData(data, DEVICE_A, "New name"));
  assert.equal(renamed.length, 1);
  assert.equal(renamed[0].kind, "profile");
  assert.equal(renamed[0].payload.phoneLabel, "New name");
  assert.deepEqual(makeCompletionDocument(), { key: "completion", kind: "completion", payload: { initialUploadComplete: true } });
  assert.ok(!a.some((item) => item.kind === "completion"));
});

test("maximum valid domain payloads and Unicode IDs fit individual Firestore documents", () => {
  const data = worstCaseFixture();
  const documents = projectData(data, DEVICE_A, "界".repeat(80));
  assert.equal(documents.filter((item) => item.kind === "workout_exercise").length, 100);
  assert.equal(documents.filter((item) => item.kind === "schedule_template").length, 2);
  for (const document of documents) {
    assert.ok(byteLength(document.key) <= MAX_DOCUMENT_KEY_BYTES);
    const change = { ...document, revision: Number.MAX_SAFE_INTEGER, deleted: false };
    assert.ok(encodedBatchBytes(credentials, INSTALLATION, [change]) + BATCH_METADATA_RESERVE_BYTES <= MAX_BATCH_BYTES);
    assert.equal(makeBatch(credentials, [change], INSTALLATION).changes.length, 1);
  }
  const plan = documents.find((item) => item.kind === "plan")!;
  const large = Array.from({ length: 10 }, (_, index) => ({ ...plan, key: makeDocumentKey("plan", DEVICE_A, `plan-${index}`), revision: index + 1, deleted: false }));
  const batch = makeBatch(credentials, large, INSTALLATION);
  assert.ok(batch.changes.length > 0 && batch.changes.length < 10);
  assert.ok(encodedBatchBytes(credentials, INSTALLATION, batch.changes) + BATCH_METADATA_RESERVE_BYTES <= MAX_BATCH_BYTES);
  assert.ok(encodedBatchBytes(credentials, INSTALLATION, large.slice(0, batch.changes.length + 1)) + BATCH_METADATA_RESERVE_BYTES > MAX_BATCH_BYTES);
});

test("Firestore envelope matches generation path contains no credentials and keeps drafts literal", () => {
  const item = { ...projectSession(fixture().sessions[0], DEVICE_A)[1], revision: 7, deleted: false };
  const encoded = encodeFirestoreDocument(credentials, INSTALLATION, item);
  assert.equal(encoded.name, `projects/workout-test/databases/(default)/documents/devices/${DEVICE_A}/generations/${GENERATION}/records/${item.key}`);
  assert.equal(recordDocumentName(credentials, item.key), encoded.name);
  assert.deepEqual(Object.keys(encoded.fields), ["schemaVersion", "deviceId", "generationId", "installationId", "key", "kind", "revision", "deleted", "payload"]);
  assert.deepEqual(encoded.fields.schemaVersion, { integerValue: "2" });
  assert.deepEqual(encoded.fields.revision, { integerValue: "7" });
  assert.deepEqual(encoded.fields.deleted, { booleanValue: false });
  assert.deepEqual(encoded.fields.payload, encodeFirestoreValue(item.payload));
  const wire = JSON.stringify(encoded);
  for (const secret of [credentials.apiKey, credentials.uid, credentials.email, credentials.password]) assert.ok(!wire.includes(secret));
  assert.ok(wire.includes('"weight":{"stringValue":"0"}'));
  assert.ok(wire.includes('"weight":{"stringValue":""}'));
  assert.ok(wire.includes('"reps":{"stringValue":"007"}'));
  const otherGeneration = { ...credentials, generationId: "55555555-5555-4555-8555-555555555555" };
  assert.notEqual(recordDocumentName(otherGeneration, item.key), encoded.name);
});

test("Firestore scalar maps and ordered arrays use supported REST encodings", () => {
  assert.deepEqual(encodeFirestoreValue({ blank: "", zero: 0, fraction: 2.5, literal: "=SUM(1,2)", absent: null, flag: false, ordered: [{ weights: [null, 0] }, true], empty: [] }), {
    mapValue: { fields: {
      blank: { stringValue: "" }, zero: { integerValue: "0" }, fraction: { doubleValue: 2.5 }, literal: { stringValue: "=SUM(1,2)" },
      absent: { nullValue: null }, flag: { booleanValue: false },
      ordered: { arrayValue: { values: [{ mapValue: { fields: { weights: { arrayValue: { values: [{ nullValue: null }, { integerValue: "0" }] } } } } }, { booleanValue: true }] } },
      empty: { arrayValue: { values: [] } },
    } },
  });
  const cycle: Record<string, unknown> = {}; cycle.self = cycle;
  for (const value of [undefined, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, 1n, new Date(), [[1]], Array(1), { __reserved__: 1 }, { "": 1 }, cycle])
    assert.throws(() => encodeFirestoreValue(value), /Invalid upload payload/);
});

test("batch selection caps record count exact encoded UTF8 bytes and detaches frozen retry input", () => {
  const changes = Array.from({ length: 15 }, (_, index) => change(index));
  const batch = makeBatch(credentials, changes, INSTALLATION);
  assert.equal(batch.changes.length, MAX_BATCH_DOCUMENTS);
  assert.deepEqual(batch.changes, changes.slice(0, 10));
  changes[0].payload.name = "Changed after selection";
  assert.equal(batch.changes[0].payload.name, "");
  const unicode = Array.from({ length: 10 }, (_, index) => change(index, "界".repeat(30000)));
  const bounded = makeBatch(credentials, unicode, INSTALLATION);
  assert.ok(bounded.changes.length > 0 && bounded.changes.length < 10);
  assert.deepEqual(bounded.changes, unicode.slice(0, bounded.changes.length));
  assert.ok(encodedBatchBytes(credentials, INSTALLATION, bounded.changes) + BATCH_METADATA_RESERVE_BYTES <= MAX_BATCH_BYTES);
  assert.ok(encodedBatchBytes(credentials, INSTALLATION, unicode.slice(0, bounded.changes.length + 1)) + BATCH_METADATA_RESERVE_BYTES > MAX_BATCH_BYTES);
  assert.deepEqual(makeBatch(credentials, [], INSTALLATION), { changes: [] });
  for (const text of ["", "ascii", "é", "日本", "🧪", "aé日本🧪z", "\ud800", "\udfff", "\ud800A"]) assert.equal(byteLength(text), Buffer.byteLength(text, "utf8"));
});

test("malformed cross device duplicate and oversized documents cannot enter a batch", () => {
  const first = Array.from({ length: 10 }, (_, index) => change(index));
  assert.throws(() => makeBatch(credentials, [...first, change(10, "界".repeat(100000))], INSTALLATION), /exceeds the upload size limit/);
  assert.throws(() => makeBatch(credentials, [change(0), change(0)], INSTALLATION), /Duplicate upload document/);
  for (const item of [
    { ...change(0), revision: 0 }, { ...change(0), revision: Number.MAX_SAFE_INTEGER + 1 },
    { ...change(0), key: makeDocumentKey("exercise", DEVICE_B, "id-0") },
    { ...change(0), key: `exercise:${DEVICE_A}:lower%2fslash` },
    { ...change(0), kind: "plan" }, { ...change(0), payload: [] },
    { ...change(0), extra: true }, { ...change(0), payload: { value: Infinity } }, { ...change(0), deleted: true },
  ]) assert.throws(() => makeBatch(credentials, [item as DocumentChange], INSTALLATION), /Invalid upload/);
  assert.throws(() => encodeFirestoreDocument(credentials, "not-a-uuid", change(0)), /Invalid installation identity/);
  assert.deepEqual(validateDocumentChange(change(0), DEVICE_A), change(0));
  const tombstone = { ...change(0), deleted: true, payload: {} };
  assert.deepEqual(validateDocumentChange(tombstone, DEVICE_A), tombstone);
});

test("Firestore credentials and codes require bounded canonical versioned exact fields", () => {
  assert.deepEqual(validateCredentials(credentials), credentials);
  assert.deepEqual(validateIdentity(credentials), { projectId: "workout-test", deviceId: DEVICE_A, generationId: GENERATION });
  const code = encodeCode(credentials);
  assert.deepEqual(parseConnectionCode(code), credentials);
  assert.deepEqual(parseConnectionCode(` ${code}\n`), credentials);
  for (const value of [
    { ...credentials, version: 2 }, { ...credentials, projectId: "https://example.invalid" },
    { ...credentials, projectId: "UPPER-project" }, { ...credentials, projectId: "short" },
    { ...credentials, apiKey: "bad key with space" }, { ...credentials, deviceId: "not-a-uuid" },
    { ...credentials, generationId: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA" },
    { ...credentials, uid: "bad/uid" }, { ...credentials, email: "missing-at-sign" },
    { ...credentials, password: "short" }, { ...credentials, password: "contains\nnewline" },
    { ...credentials, extra: true }, { ...credentials, apiKey: undefined },
  ]) assert.throws(() => parseConnectionCode(encodeCode(value)), /Invalid Firestore connection code/);
  for (const invalid of ["", code.replace("WORKOUTFB1.", "WORKOUT1."), `${code}=`, "WORKOUTFB1._w", "WORKOUTFB1.A", `WORKOUTFB1.${"A".repeat(4096)}`, null])
    assert.throws(() => parseConnectionCode(invalid), /Invalid Firestore connection code/);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let noncanonical = code;
  if ((noncanonical.length - 11) % 4 === 0) noncanonical = encodeCode({ ...credentials, uid: `${credentials.uid}x` });
  const last = noncanonical.at(-1)!;
  noncanonical = noncanonical.slice(0, -1) + alphabet[alphabet.indexOf(last) + 1];
  assert.throws(() => parseConnectionCode(noncanonical), /Invalid Firestore connection code/);
});

test("commit receipts acknowledge only the exact frozen key revision sequence", () => {
  const changes = [change(0), change(1)];
  const receipt = { acknowledged: changes.map(({ key, revision }) => ({ key, revision })) };
  assert.deepEqual(parseCommitReceipt(receipt, changes), receipt);
  assert.deepEqual(parseCommitReceipt({ acknowledged: [] }, []), { acknowledged: [] });
  for (const value of [
    null, [], { ...receipt, extra: true }, { acknowledged: [] },
    { acknowledged: [...receipt.acknowledged].reverse() },
    { acknowledged: [receipt.acknowledged[0], receipt.acknowledged[0]] },
    { acknowledged: [receipt.acknowledged[0], { ...receipt.acknowledged[1], revision: 0 }] },
    { acknowledged: [receipt.acknowledged[0], { ...receipt.acknowledged[1], revision: 3 }] },
    { acknowledged: [receipt.acknowledged[0], { key: makeDocumentKey("exercise", DEVICE_B, "id-1"), revision: 2 }] },
    { acknowledged: [receipt.acknowledged[0], { ...receipt.acknowledged[1], extra: true }] },
  ]) assert.throws(() => parseCommitReceipt(value, changes), /Invalid upload receipt/);
  const completion = { ...makeCompletionDocument(), revision: 99, deleted: false };
  assert.deepEqual(parseCommitReceipt({ acknowledged: [{ key: "completion", revision: 99 }] }, [completion]), { acknowledged: [{ key: "completion", revision: 99 }] });
});

test("legacy recurrence arrays are detached from both plan and historical upload snapshots", () => {
  const data = fixture();
  const recurrence = { kind: "legacy" as const, anchorMonday: "2025-03-03", weekdaysA: [0], weekdaysB: [6] };
  data.templates[0].recurrence = recurrence;
  data.scheduleRevisions[0].templates[0].recurrence = recurrence;
  const docs = projectData(data, DEVICE_A, "Phone");
  recurrence.weekdaysA.push(2);
  const plan = docs.find(doc => doc.kind === "plan")!;
  const snapshot = docs.find(doc => doc.kind === "schedule_template")!;
  assert.deepEqual((plan.payload.recurrence as { weekdaysA: number[] }).weekdaysA, [0]);
  assert.deepEqual(((snapshot.payload.template as JsonObject).recurrence as { weekdaysA: number[] }).weekdaysA, [0]);
});
