import assert from "node:assert/strict";
import test from "node:test";
import { parseBackup, serializeBackup, serializeStoredBackup, upgradeData, validateData, type LegacyV2AppData, type LegacyV3AppData, type StoredAppData } from "../src/domain/backup";
import { initialData } from "../src/domain/library";
import { snapshot } from "../src/data/snapshot";
import { canCancelWorkout, cancelWorkout, finishWorkout, moveWorkoutToToday } from "../src/domain/sessions";
import { createJournalStorage } from "../src/data/journalStorage";
import { projectData, changedDocuments } from "../src/sync/projection";
import { makeDocumentKey, validateDocument } from "../src/sync/protocol";
import { mergeWorkoutImport, previewWorkoutImport, validateWorkoutImport, type WorkoutImport } from "../src/domain/workoutImport";
import { FRESH_START_EPOCH } from "../src/sync/reset";
import type { AppData, WorkoutTemplate } from "../src/domain/types";
import { historyFixture, sqliteHarness } from "./storageFixture";

const at = "2026-10-29T12:00:00.000Z";
const deviceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const identity = { projectId: "workout-test", deviceId, generationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", layout: "automatic" as const, uid: "synthetic-owner" };
const installationId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
function template(id: string): WorkoutTemplate {
  return { id, title: id, archived: false, updatedAt: at, weekdays: [], recurrence: { kind: "weekly" },
    exercises: [{ exerciseId: initialData().exercises[0].id, sets: 3, repMin: 8, repMax: 12 }] };
}
function flexibleFixture(): AppData {
  const data = initialData();
  data.templates = [template("a"), template("b")];
  data.scheduleRevisions = [{ id: "revision", effectiveDate: "2026-10-26", anchorMonday: "2026-10-26", slots: [], templates: structuredClone(data.templates),
    routine: { mode: "flexible", id: "routine:one", weekdays: [0, 2, 4], sequence: ["a", "b", "a"], startIndex: 0, startDate: "2026-10-26" } }];
  const occurrence = { routineId: "routine:one", ordinal: 0, templateId: "a", dueDate: "2026-10-26" };
  data.sessions = [{ ...historyFixture(1).sessions[0], date: "2026-10-27", templateId: "a", routineOccurrence: occurrence }];
  data.routineProgress = [
    { ...occurrence, id: "routine:one:0", resolvedDate: "2026-10-27", resolvedAt: at, outcome: "completed", sessionId: data.sessions[0].id },
    { id: "routine:one:1", routineId: "routine:one", ordinal: 1, templateId: "b", dueDate: "2026-10-28", resolvedDate: "2026-10-29", resolvedAt: at, outcome: "skipped", sessionId: null },
  ];
  return data;
}
function previousFixture(): LegacyV3AppData {
  const data = historyFixture(2);
  data.settings.firstName = "Preserved";
  data.exercises[0].incrementLb = 1.25;
  data.bodyWeights = [{ id: "weight", date: "2020-01-01", weightKg: 80.25, updatedAt: at }];
  data.templates = [template("a")];
  data.scheduleRevisions = [{ id: "old-revision", effectiveDate: "2020-01-01", anchorMonday: "2019-12-30", slots: [], templates: structuredClone(data.templates), routine: { mode: "fixed" } }];
  data.sessions[0].exercises[0].sets[0].classification = "warmup";
  data.sessions[1] = { ...data.sessions[1], status: "in_progress", finishedAt: null, hasFinished: false };
  const { routineProgress: _progress, ...old } = data;
  return { ...old, schemaVersion: 3,
    scheduleRevisions: old.scheduleRevisions.map(({ routine: _routine, ...revision }) => revision),
    sessions: old.sessions.map(({ hasFinished: _finished, routineOccurrence: _occurrence, ...session }) => session),
  };
}
function seedJournal(sql: ReturnType<typeof sqliteHarness>, data: StoredAppData) {
  const { sessions, ...metadata } = data;
  sql.native.prepare("UPDATE journal_meta SET value = ? WHERE id = 1").run(JSON.stringify(metadata));
  sql.native.exec("DELETE FROM workout_sessions; PRAGMA user_version = 6;");
  sessions.forEach((session, index) => sql.native.prepare("INSERT INTO workout_sessions VALUES (?, ?, ?)").run(session.id, index, JSON.stringify(session)));
}
async function migrationFixture() {
  const sql = sqliteHarness();
  const original = previousFixture();
  const store = createJournalStorage(sql.db); await store.load();
  seedJournal(sql, original);
  sql.native.prepare("INSERT INTO upload_state VALUES (1, ?)").run(JSON.stringify({ ...identity, installationId, label: "Phone", clock: 5, lastSyncedAt: at, enabled: true, bound: true, initialComplete: true }));
  const docs = projectData(original, deviceId, "Phone");
  for (const doc of docs) {
    sql.native.prepare("INSERT INTO upload_records VALUES (?, ?)").run(doc.key, doc.kind);
    if (doc.kind === "schedule" || doc.kind === "workout")
      sql.native.prepare("INSERT INTO upload_outbox VALUES (?, ?, 5, 0, ?)").run(doc.key, doc.kind, JSON.stringify(doc.payload));
  }
  const frozen = (await store.sync.inFlight())!;
  return { sql, original, frozen };
}

test("v2 and v3 upgrades retain actuals, old warm-ups and settings while adding fixed/no-progress defaults", () => {
  const previous = previousFixture();
  const encoded = serializeStoredBackup(previous);
  const next = upgradeData(previous);
  assert.equal(serializeStoredBackup(previous), encoded);
  assert.equal(next.schemaVersion, 4);
  assert.deepEqual(next.routineProgress, []);
  assert.deepEqual(next.scheduleRevisions[0].routine, { mode: "fixed" });
  assert.deepEqual(next.sessions.map(session => session.hasFinished), [true, true]);
  assert.ok(next.sessions.every(session => session.routineOccurrence === null));
  assert.equal(next.sessions[0].exercises, previous.sessions[0].exercises);
  assert.equal(next.sessions[0].exercises[0].sets[0].classification, "warmup");
  assert.equal(next.settings, previous.settings);
  assert.equal(next.exercises[0].incrementLb, 1.25);
  assert.deepEqual(parseBackup(encoded), next);
  const v2: LegacyV2AppData = { ...previous, schemaVersion: 2, settings: { age: "30", gender: "male", heightCm: 180, unit: "kg" } };
  const upgradedV2 = upgradeData(v2);
  assert.equal(upgradedV2.schemaVersion, 4);
  assert.equal(upgradedV2.sessions[0].exercises[0].sets[0].classification, "warmup");
  assert.deepEqual(upgradedV2.bodyWeights, v2.bodyWeights);
  assert.ok(upgradedV2.sessions.every(session => session.hasFinished));
  assert.equal(upgradedV2.settings.gender, "Male");
});

test("legacy drafts and reopened workouts are protected from cancellation and movement without losing edits", () => {
  const legacy = previousFixture();
  const oldSession = legacy.sessions[1];
  oldSession.exercises[0].sets[1] = { ...oldSession.exercises[0].sets[1], weight: "", reps: "", status: "skipped" };
  const migrated = upgradeData(legacy);
  const session = migrated.sessions[1];
  assert.equal(session.status, "in_progress");
  assert.equal(session.finishedAt, null);
  assert.deepEqual(session.exercises, oldSession.exercises);
  assert.equal(canCancelWorkout(session), false);
  assert.throws(() => cancelWorkout(migrated, session.id), /cannot be cancelled/);
  assert.throws(() => moveWorkoutToToday(migrated, session.id, "2026-10-29"), /cannot be moved/);
  const finished = finishWorkout(migrated, session.id, true, "2026-10-29");
  assert.equal(finished.sessions[1].status, "completed");
  assert.equal(finished.sessions[1].hasFinished, true);
  assert.deepEqual(finished.routineProgress, []);
  assert.equal(finished.sessions[1].date, oldSession.date);
});

test("flexible backup roundtrip preserves duplicate sequence entries and frozen progress on recording edits", () => {
  const data = snapshot(flexibleFixture());
  assert.deepEqual(parseBackup(serializeBackup(data)), data);
  const edited = snapshot({ ...data, sessions: data.sessions.map(session => ({ ...session, status: "in_progress", finishedAt: null })) }, data);
  assert.equal(edited.routineProgress, data.routineProgress);
  assert.equal(edited.scheduleRevisions, data.scheduleRevisions);
  assert.ok(Object.isFrozen(edited.routineProgress[0]));
  assert.equal(edited.sessions[0].hasFinished, true);
  validateData(edited);
});

test("routine validation rejects gaps, forged dates, missing links and mutable configuration", () => {
  const mutations: ((data: AppData) => void)[] = [
    data => { data.routineProgress[1].ordinal = 3; data.routineProgress[1].id = "routine:one:3"; data.routineProgress[1].templateId = "a"; },
    data => { data.routineProgress[0].resolvedDate = "2026-10-25"; data.sessions[0].date = "2026-10-25"; },
    data => { data.routineProgress[1].resolvedDate = "2026-10-26"; },
    data => { data.routineProgress[1].dueDate = "2026-10-30"; },
    data => { data.routineProgress[0].sessionId = "missing"; },
    data => { data.routineProgress[1].sessionId = data.sessions[0].id; },
    data => { data.sessions[0].routineOccurrence = null; },
    data => { data.sessions[0].hasFinished = false; },
    data => { data.routineProgress.push({ ...data.routineProgress[0] }); },
    data => { const revision = structuredClone(data.scheduleRevisions[0]); revision.id = "later"; revision.effectiveDate = "2026-11-02"; if (revision.routine.mode === "flexible") revision.routine.sequence.reverse(); data.scheduleRevisions.push(revision); if (revision.routine.mode === "flexible") revision.routine.startIndex = 1; },
  ];
  for (const mutate of mutations) {
    const data = flexibleFixture(); mutate(data);
    assert.throws(() => validateData(data), /Invalid backup/);
  }
});

test("only one unresolved session may link to the next deterministic occurrence", () => {
  const data = flexibleFixture();
  const pending = { ...data.sessions[0], id: "pending", date: "2026-10-30", status: "in_progress" as const, finishedAt: null, hasFinished: false,
    routineOccurrence: { routineId: "routine:one", ordinal: 2, templateId: "a", dueDate: "2026-10-30" } };
  data.sessions.push(pending); validateData(data);
  data.sessions.push({ ...pending, id: "other", date: "2026-11-02" });
  assert.throws(() => validateData(data), /unique per routine occurrence/);
  data.sessions.pop(); pending.routineOccurrence.dueDate = "2026-11-02";
  assert.throws(() => validateData(data), /next unresolved/);
});

test("v6 journal migration commits projection revisions without changing identity, lifecycle or frozen batch bytes", async () => {
  const { sql, original, frozen } = await migrationFixture();
  try {
    const clock = 5;
    const store = createJournalStorage(sql.db);
    const data = await store.load();
    assert.deepEqual(data, upgradeData(original));
    assert.equal(sql.native.prepare("PRAGMA user_version").get()!.user_version, 7);
    assert.equal(sql.native.prepare("SELECT epoch FROM app_lifecycle").get()!.epoch, FRESH_START_EPOCH);
    assert.deepEqual(JSON.parse(sql.native.prepare("SELECT value FROM journal_recovery WHERE schema_version = 3").get()!.value as string), original);
    assert.deepEqual(await store.sync.inFlight(), frozen);
    const state = (await store.sync.state())!;
    assert.equal(state.clock, clock + 1); assert.equal(state.deviceId, identity.deviceId); assert.equal(state.generationId, identity.generationId); assert.equal(state.installationId, installationId);
    const delta = changedDocuments(projectData(original, deviceId, "Phone"), projectData(data, deviceId, "Phone"));
    assert.deepEqual(new Set(delta.map(item => item.kind)), new Set(["schedule", "workout"]));
    await store.sync.acknowledge(frozen.id, frozen.changes.map(({ key, revision }) => ({ key, revision })), at);
    assert.equal(await store.sync.pendingCount(), delta.length, "old acknowledgments retain migrated revisions");
    const retry = await createJournalStorage(sql.db).load(); assert.deepEqual(retry, data);
    assert.equal((await store.sync.state())!.clock, clock + 1, "restart must not queue migration again");
  } finally { sql.close(); }
});

test("migration commit failure preserves the original journal, outbox and clock, then retries from its recovery copy", async () => {
  const { sql, original, frozen } = await migrationFixture();
  try {
    const beforeQueue = sql.native.prepare("SELECT * FROM upload_outbox ORDER BY key").all();
    const beforeState = sql.native.prepare("SELECT value FROM upload_state").get()!.value;
    let backups = 0;
    const store = createJournalStorage(sql.db, { beforeMigration: async () => { if (++backups === 1) sql.failCommit(); } });
    await assert.rejects(store.load(), /commit failure/);
    assert.equal(sql.native.prepare("PRAGMA user_version").get()!.user_version, 6);
    assert.equal(JSON.parse(sql.native.prepare("SELECT value FROM journal_meta").get()!.value as string).schemaVersion, 3);
    assert.deepEqual(sql.native.prepare("SELECT * FROM upload_outbox ORDER BY key").all(), beforeQueue);
    assert.equal(sql.native.prepare("SELECT value FROM upload_state").get()!.value, beforeState);
    assert.deepEqual(await store.sync.inFlight(), frozen);
    assert.deepEqual(JSON.parse(sql.native.prepare("SELECT value FROM journal_recovery").get()!.value as string), original);
    assert.deepEqual(await store.load(), upgradeData(original));
  } finally { sql.close(); }
});

test("failure to preserve a recovery copy blocks migration without resetting the journal", async () => {
  const { sql, original } = await migrationFixture();
  try {
    const store = createJournalStorage(sql.db, { beforeMigration: async () => { throw new Error("recovery unavailable"); } });
    await assert.rejects(store.load(), /recovery unavailable/);
    assert.equal(sql.native.prepare("PRAGMA user_version").get()!.user_version, 6);
    assert.deepEqual(JSON.parse(sql.native.prepare("SELECT value FROM journal_recovery").get()!.value as string), original);
    assert.equal(sql.native.prepare("SELECT epoch FROM app_lifecycle").get()!.epoch, FRESH_START_EPOCH);
  } finally { sql.close(); }
});

test("routine progress uploads as its own detached document and removal emits an empty tombstone", () => {
  const data = flexibleFixture();
  const documents = projectData(data, deviceId, "Phone");
  const progress = documents.filter(doc => doc.kind === "schedule_progress");
  assert.equal(progress.length, 2);
  assert.equal(progress[0].key, makeDocumentKey("schedule_progress", deviceId, "routine:one:0"));
  for (const doc of documents) validateDocument(doc, deviceId);
  const removed = changedDocuments(documents, projectData({ ...data, routineProgress: [] }, deviceId, "Phone"));
  assert.equal(removed.length, 2); assert.ok(removed.every(doc => doc.deleted && Object.keys(doc.payload).length === 0));
  const schedule = documents.find(doc => doc.kind === "schedule")!;
  (schedule.payload.routine as { sequence: string[] }).sequence[0] = "changed";
  assert.equal(data.scheduleRevisions[0].routine.mode === "flexible" && data.scheduleRevisions[0].routine.sequence[0], "a");
});

test("additive imports in a live flexible routine preserve progress and import history without links", () => {
  const current = snapshot(flexibleFixture());
  const plan = { ...template("import-plan"), weekdays: [1] };
  const original = previousFixture().sessions[0];
  const source: WorkoutImport = { type: "workout-import", version: 1, sourceId: "synthetic", importId: "synthetic-v1", exercises: current.exercises,
    templates: [plan], sessions: [{ ...original, id: "old-history", date: "2019-12-01" }] };
  const preview = previewWorkoutImport(current, source, "2026-10-29");
  assert.equal(preview.plansUnscheduled, 1); assert.match(preview.conflicts[0].message, /on demand.*progress will stay unchanged/);
  assert.throws(() => mergeWorkoutImport(current, source, { effectiveDate: "2026-10-29" }), /confirm importing/);
  const merged = mergeWorkoutImport(current, source, { effectiveDate: "2026-10-29", allowUnscheduledPlans: true });
  assert.equal(merged.routineProgress, current.routineProgress); assert.equal(merged.scheduleRevisions, current.scheduleRevisions);
  assert.equal(merged.settings, current.settings); assert.equal(merged.sessions[0], current.sessions[0]);
  assert.deepEqual(merged.templates.at(-1)!.weekdays, []);
  assert.equal(merged.sessions.at(-1)!.routineOccurrence, null); assert.equal(merged.sessions.at(-1)!.hasFinished, true);
  assert.equal(mergeWorkoutImport(merged, source, { effectiveDate: "2026-10-29" }), merged);
  assert.throws(() => validateWorkoutImport({ ...source, sessions: [current.sessions[0]] }), /cannot contain routine occurrence links/);
});


test("legacy imports protect unknown completion history while explicit modern draft state is retained", () => {
  const oldSession = previousFixture().sessions[1];
  const source: WorkoutImport = { type: "workout-import", version: 1, sourceId: "legacy-import", importId: "legacy-import-v1",
    exercises: initialData().exercises, templates: [], sessions: [oldSession] };
  const original = JSON.stringify(source);
  const imported = mergeWorkoutImport(initialData(), source, { effectiveDate: "2026-10-29" });
  const session = imported.sessions[0];
  assert.equal(session.status, "in_progress");
  assert.equal(session.finishedAt, null);
  assert.equal(session.hasFinished, true);
  assert.equal(session.routineOccurrence, null);
  assert.deepEqual(session.exercises, oldSession.exercises);
  assert.equal(canCancelWorkout(session), false);
  assert.throws(() => cancelWorkout(imported, session.id), /cannot be cancelled/);
  assert.throws(() => moveWorkoutToToday(imported, session.id, "2026-10-29"), /cannot be moved/);
  assert.equal(mergeWorkoutImport(imported, source, { effectiveDate: "2026-10-29" }), imported);
  assert.equal(JSON.stringify(source), original);
  const modern = validateWorkoutImport({ ...source, sessions: [{ ...oldSession, hasFinished: false, routineOccurrence: null }] });
  assert.equal(modern.sessions[0].hasFinished, false);
  assert.equal(canCancelWorkout(modern.sessions[0]), true);
});

test("progress, workout and outbox commit atomically and capture a progress-only skip", async () => {
  const sql = sqliteHarness();
  try {
    const complete = flexibleFixture();
    const initial = { ...complete, sessions: [], routineProgress: [] };
    const store = createJournalStorage(sql.db); await store.load(); await store.write(initial);
    const candidate = await store.sync.prepareEnrollment(identity, "Phone", installationId);
    await store.sync.activateEnrollment(candidate);
    for (;;) {
      const batch = await store.sync.inFlight(); if (!batch) break;
      await store.sync.acknowledge(batch.id, batch.changes.map(({ key, revision }) => ({ key, revision })), at);
    }
    const first = { ...complete, routineProgress: complete.routineProgress.slice(0, 1) };
    sql.failCommit(); await assert.rejects(store.write(first), /commit failure/);
    assert.equal(await store.sync.pendingCount(), 0);
    assert.deepEqual(await createJournalStorage(sql.db).load(), initial);
    await store.write(first);
    const batch = (await store.sync.inFlight())!;
    assert.ok(batch.changes.some(doc => doc.kind === "schedule_progress"));
    assert.ok(batch.changes.some(doc => doc.kind === "workout" && doc.payload.hasFinished === true));
    assert.equal(new Set(batch.changes.map(doc => doc.revision)).size, 1);
    await store.sync.acknowledge(batch.id, batch.changes.map(({ key, revision }) => ({ key, revision })), at);
    await store.write(complete);
    const skipped = (await store.sync.inFlight())!;
    assert.equal(skipped.changes.length, 1);
    assert.equal(skipped.changes[0].kind, "schedule_progress");
    assert.equal(skipped.changes[0].payload.outcome, "skipped");
    assert.equal(skipped.changes[0].payload.sessionId, null);
  } finally { sql.close(); }
});

test("browser schema upgrade keeps the stable data slot and original recovery copy across failed writes", async () => {
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const values = new Map<string, string>();
  let failData = false;
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { if (failData && key === "workout-browser-preview-v3") throw new Error("disk full"); values.set(key, value); },
    removeItem: (key: string) => values.delete(key),
  } });
  try {
    const browser = await import("../src/data/persistence.web");
    await browser.loadData();
    const original = previousFixture(); const encoded = serializeStoredBackup(original);
    values.set("workout-browser-preview-v3", encoded);
    failData = true;
    await assert.rejects(browser.loadData(), /disk full/);
    assert.equal(values.get("workout-browser-preview-v3"), encoded);
    assert.equal(values.get("workout-browser-before-v3-to-v4"), encoded);
    assert.equal(values.get("workout-browser-lifecycle"), FRESH_START_EPOCH);
    failData = false;
    const next = await browser.loadData(); assert.deepEqual(next, upgradeData(original));
    const after = values.get("workout-browser-preview-v3");
    assert.deepEqual(await browser.loadData(), next);
    assert.equal(values.get("workout-browser-preview-v3"), after);
    assert.equal(values.get("workout-browser-before-v3-to-v4"), encoded);
  } finally {
    if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
