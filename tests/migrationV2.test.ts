import test from "node:test";
import assert from "node:assert/strict";
import { initialData } from "../src/domain/library";
import { LegacyAppData, LegacyTemplate, parseBackup, serializeBackup, serializeStoredBackup, upgradeData, validateData, validateLegacyData, validateStoredData } from "../src/domain/backup";
import { saveTemplate, scheduleForDate } from "../src/domain/schedule";

const timestamp = "2025-01-06T12:00:00.000Z";
function oldPlan(id: string, weekdays: number[]): LegacyTemplate {
  return {
    id, title: id, weekdays, archived: false, updatedAt: timestamp,
    exercises: [{ exerciseId: "exercise-barbell-squat", sets: 2, repMin: 8, repMax: 12 }],
  };
}
function legacyFixture(): LegacyAppData {
  const base = initialData();
  const a = oldPlan("a", [0, 2]);
  const b = oldPlan("b", [2]);
  const c = oldPlan("c", [4]);
  const d = oldPlan("d", [4]);
  const manual = oldPlan("manual", []);
  return {
    schemaVersion: 1, settings: base.settings, exercises: base.exercises,
    templates: [a, b, c, d, manual],
    scheduleRevisions: [{
      id: "revision-old", effectiveDate: "2025-01-06", anchorMonday: "2025-01-06",
      templates: structuredClone([a, b, c, d, manual]),
      slots: [
        { weekday: 0, workoutIds: ["a"] },
        { weekday: 1, workoutIds: [] },
        { weekday: 2, workoutIds: ["a", "b"] },
        { weekday: 4, workoutIds: ["c", "d"] },
      ],
    }],
    sessions: [{
      id: "record-old", date: "2025-01-06", title: "Historical title", templateId: "a", unit: "lb",
      status: "in_progress", startedAt: timestamp, updatedAt: timestamp, finishedAt: null,
      exercises: [{
        exercise: { ...base.exercises[0] }, target: { ...a.exercises[0] },
        suggestion: { weights: [22.25, null], reason: "Historical advice" },
        sets: [{ weight: "22.25", reps: "12", status: "completed" }, { weight: "", reps: "", status: "pending" }],
      }],
    }],
  };
}

test("v1 migration preserves each old slot and derives weekly, fortnightly and mixed recurrence", () => {
  const legacy = legacyFixture();
  const original = JSON.stringify(legacy);
  const data = upgradeData(legacy);
  assert.equal(JSON.stringify(legacy), original);
  assert.equal(data.schemaVersion, 2);
  assert.deepEqual(data.bodyWeights, []);
  assert.deepEqual(data.scheduleRevisions[0].slots.map((slot) => slot.workoutIds), [["a", "a"], [null, null], ["a", "b"], ["c", "d"]]);
  assert.deepEqual(data.templates[0].recurrence, {
    kind: "legacy", anchorMonday: "2025-01-06", weekdaysA: [0, 2], weekdaysB: [0],
  });
  assert.deepEqual(data.templates[1].recurrence, { kind: "biweekly", anchorMonday: "2025-01-13" });
  assert.deepEqual(data.templates[2].recurrence, { kind: "biweekly", anchorMonday: "2025-01-06" });
  assert.deepEqual(data.templates[4].recurrence, { kind: "weekly" });
  for (const [date, id] of [
    ["2025-01-06", "a"], ["2025-01-07", undefined], ["2025-01-08", "a"], ["2025-01-10", "c"],
    ["2025-01-13", "a"], ["2025-01-15", "b"], ["2025-01-17", "d"], ["2025-01-20", "a"],
  ]) assert.equal(scheduleForDate(data, date!)?.id, id);
  assert.deepEqual(parseBackup(JSON.stringify(legacy)), data);
  assert.deepEqual(parseBackup(serializeBackup(data)), data);
});

test("migration preserves saved suggestions and values while tagging legacy sets as working", () => {
  const legacy = legacyFixture();
  const data = upgradeData(legacy);
  const entry = data.sessions[0].exercises[0];
  assert.deepEqual(entry.suggestion, { ...legacy.sessions[0].exercises[0].suggestion, algorithmVersion: 1 });
  assert.deepEqual(entry.sets, legacy.sessions[0].exercises[0].sets.map((set) => ({ ...set, classification: "working" })));
  assert.equal(data.sessions[0].title, "Historical title");
  assert.equal(data.sessions[0].updatedAt, timestamp);
  const edited = saveTemplate(data, { ...data.templates[0], title: "New current title" }, "2025-01-09");
  assert.equal(edited.sessions, data.sessions);
  assert.equal(edited.scheduleRevisions[0], data.scheduleRevisions[0]);
  assert.equal(scheduleForDate(edited, "2025-01-08")?.title, "a");
  assert.equal(scheduleForDate(edited, "2025-01-13")?.title, "New current title");
  assert.equal(scheduleForDate(edited, "2025-01-15")?.id, "b");
  validateData(edited);
});

test("recovery serialization validates each schema without upgrading original legacy fields", () => {
  const legacy = legacyFixture();
  assert.equal(validateStoredData(legacy), legacy);
  const text = serializeStoredBackup(legacy);
  assert.equal(text, JSON.stringify(legacy));
  const retained = JSON.parse(text);
  assert.equal(retained.schemaVersion, 1);
  assert.equal("bodyWeights" in retained, false);
  assert.equal("recurrence" in retained.templates[0], false);
  assert.equal("algorithmVersion" in retained.sessions[0].exercises[0].suggestion, false);
  assert.equal("classification" in retained.sessions[0].exercises[0].sets[0], false);
  assert.deepEqual(retained.scheduleRevisions[0].slots[0].workoutIds, ["a"]);
  const current = upgradeData(legacy);
  assert.equal(validateStoredData(current), current);
  assert.equal(serializeStoredBackup(current), serializeBackup(current));
  assert.throws(() => validateStoredData({ ...current, schemaVersion: 3 }), /schemaVersion/);
  assert.throws(() => serializeStoredBackup({ ...legacy, settings: { ...legacy.settings, age: "invalid" } }), /settings.age/);
});

test("opposite weekday phases remain legacy and current cadence uses the latest revision", () => {
  const legacy = legacyFixture();
  legacy.templates = [oldPlan("a", [0, 2]), oldPlan("b", [0, 2])];
  legacy.scheduleRevisions = [
    { id: "first", effectiveDate: "2025-01-06", anchorMonday: "2025-01-06", templates: structuredClone(legacy.templates), slots: [{ weekday: 0, workoutIds: ["a", "b"] }, { weekday: 2, workoutIds: ["a", "b"] }] },
    { id: "second", effectiveDate: "2025-01-14", anchorMonday: "2025-01-06", templates: structuredClone(legacy.templates), slots: [{ weekday: 0, workoutIds: ["a", "b"] }, { weekday: 2, workoutIds: ["b", "a"] }] },
  ];
  const data = upgradeData(legacy);
  assert.deepEqual(data.templates[0].recurrence, { kind: "legacy", anchorMonday: "2025-01-06", weekdaysA: [0], weekdaysB: [2] });
  assert.deepEqual(data.scheduleRevisions[0].templates[0].recurrence, { kind: "biweekly", anchorMonday: "2025-01-06" });
  assert.equal(scheduleForDate(data, "2025-01-08")?.id, "a");
  assert.equal(scheduleForDate(data, "2025-01-15")?.id, "a");
  assert.equal(scheduleForDate(data, "2025-01-20")?.id, "a");
  assert.equal(scheduleForDate(data, "2025-01-22")?.id, "b");
});

test("migration validates legacy input before adding fields and retains old data on failure", () => {
  const legacy = legacyFixture();
  const original = JSON.stringify(legacy);
  assert.equal(validateLegacyData(legacy), legacy);
  for (const change of [
    (value: LegacyAppData) => { (value.templates[0] as unknown as Record<string, unknown>).recurrence = { kind: "weekly" }; },
    (value: LegacyAppData) => { value.sessions[0].exercises[0].sets[0].reps = ""; },
    (value: LegacyAppData) => { value.scheduleRevisions[0].slots[0].workoutIds = ["a", "a"]; },
    (value: LegacyAppData) => { value.scheduleRevisions[0].anchorMonday = "2025-01-07"; },
  ]) {
    const invalid = structuredClone(legacy);
    change(invalid);
    const before = JSON.stringify(invalid);
    assert.throws(() => upgradeData(invalid), /Invalid backup/);
    assert.equal(JSON.stringify(invalid), before);
  }
  assert.equal(JSON.stringify(legacy), original);
  assert.throws(() => upgradeData({ ...initialData(), schemaVersion: 3 }), /schemaVersion/);
});

test("v2 validation enforces recurrence consistency and required session metadata", () => {
  const data = upgradeData(legacyFixture());
  for (const change of [
    (value: typeof data) => { value.scheduleRevisions[0].slots[0].workoutIds = ["a"]; },
    (value: typeof data) => { value.scheduleRevisions[0].slots[2].workoutIds = ["b", "a"]; },
    (value: typeof data) => { value.templates[1].recurrence = { kind: "weekly" }; },
    (value: typeof data) => { delete (value.sessions[0].exercises[0].suggestion as Partial<typeof data.sessions[0]["exercises"][0]["suggestion"]>).algorithmVersion; },
    (value: typeof data) => { delete (value.sessions[0].exercises[0].sets[0] as Partial<typeof data.sessions[0]["exercises"][0]["sets"][0]>).classification; },
  ]) {
    const invalid = structuredClone(data);
    change(invalid);
    assert.throws(() => validateData(invalid), /Invalid backup/);
  }
});

test("body weights roundtrip canonical fractions and reject invalid or duplicated entries", () => {
  const data = initialData();
  data.bodyWeights = [{ id: "weight-1", date: "2099-01-01", weightKg: 72.34567, updatedAt: timestamp }];
  assert.deepEqual(parseBackup(serializeBackup(data)), data);
  for (const weightKg of [0, -1, 500.01, Number.NaN, Number.POSITIVE_INFINITY]) {
    const invalid = structuredClone(data);
    invalid.bodyWeights[0].weightKg = weightKg;
    assert.throws(() => validateData(invalid), /weightKg/);
  }
  const duplicate = structuredClone(data);
  duplicate.bodyWeights.push({ ...duplicate.bodyWeights[0], id: "weight-2" });
  assert.throws(() => validateData(duplicate), /bodyWeights.date/);
});
