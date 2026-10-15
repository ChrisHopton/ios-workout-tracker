import assert from "node:assert/strict";
import test from "node:test";
import { estimatedStrength, nextWorkoutSuggestion, summarize } from "../src/domain/analytics";
import { latestBodyWeight, removeBodyWeight, saveBodyWeight } from "../src/domain/bodyWeight";
import { initialData } from "../src/domain/library";
import { convertWeight } from "../src/domain/recommendations";
import { saveTemplate } from "../src/domain/schedule";
import { AppData, BodyWeightEntry, Equipment, RecordedSet, WorkoutSession, WorkoutTemplate } from "../src/domain/types";

function measurement(date: string, weightKg: number): BodyWeightEntry {
  return { id: date, date, weightKg, updatedAt: date + "T12:00:00Z" };
}
function set(weight: string, reps: string, classification: RecordedSet["classification"] = "working", status: RecordedSet["status"] = "completed"): RecordedSet {
  return { weight, reps, classification, status };
}
function session(data: AppData, date: string, sets: RecordedSet[], equipment: Equipment = "barbell"): WorkoutSession {
  return {
    id: date, date, title: "Strength", templateId: "strength", unit: "kg", status: "completed",
    startedAt: date + "T12:00:00Z", updatedAt: date + "T13:00:00Z", finishedAt: date + "T13:00:00Z",
    exercises: [{ exercise: { ...data.exercises[0], equipment }, target: { exerciseId: data.exercises[0].id, sets: sets.length, repMin: 8, repMax: 12 },
      suggestion: { algorithmVersion: 2, weights: sets.map(() => null), reason: "" }, sets }],
  };
}

test("body-weight save and editing preserve canonical kilograms across units and identities", () => {
  let data = saveBodyWeight(initialData(), "2025-01-06", "200", "lb", undefined, "2025-01-20");
  assert.equal(data.bodyWeights.length, 1);
  assert.equal(data.bodyWeights[0].weightKg, 90.718474);
  const id = data.bodyWeights[0].id;
  data = saveBodyWeight(data, "2025-01-07", "91", "kg", id, "2025-01-20");
  assert.equal(data.bodyWeights[0].id, id);
  assert.equal(data.bodyWeights[0].date, "2025-01-07");
  assert.equal(data.bodyWeights[0].weightKg, 91);
  assert.equal(removeBodyWeight(data, id).bodyWeights.length, 0);
});

test("invalid body-weight input, future dates, stale editing IDs and duplicate dates are rejected without mutation", () => {
  const data = saveBodyWeight(initialData(), "2025-01-06", "80", "kg", undefined, "2025-01-20");
  const original = structuredClone(data);
  for (const bad of ["", "0", "-1", "501", "Infinity", "1e3", "."])
    assert.throws(() => saveBodyWeight(data, "2025-01-07", bad, "kg", undefined, "2025-01-20"));
  assert.throws(() => saveBodyWeight(data, "2025-01-21", "80", "kg", undefined, "2025-01-20"), /future/);
  assert.throws(() => saveBodyWeight(data, "2025-01-06", "81", "kg", undefined, "2025-01-20"), /already exists/);
  assert.throws(() => saveBodyWeight(data, "2025-01-07", "81", "kg", "missing", "2025-01-20"), /no longer exists/);
  assert.deepEqual(data, original);
});

test("latest measurement lookup never uses future measurements and ignores array order", () => {
  const entries = [measurement("2025-01-20", 100), measurement("2025-01-06", 80), measurement("2025-01-13", 90)];
  assert.equal(latestBodyWeight(entries, "2025-01-12")?.weightKg, 80);
  assert.equal(latestBodyWeight(entries, "2025-01-13")?.weightKg, 90);
  assert.equal(latestBodyWeight(entries, "2025-01-01"), null);
});

test("estimated strength accepts only positive weighted 1–10-rep results", () => {
  assert.equal(estimatedStrength(100, 1), 100);
  assert.equal(estimatedStrength(100, 6), 120);
  assert.equal(estimatedStrength(100, 10), 100 * (1 + 10 / 30));
  for (const [weight, reps] of [[0, 5], [100, 0], [100, 11], [100, 2.5], [Infinity, 5]])
    assert.equal(estimatedStrength(weight, reps), null);
});

test("warm-ups skipped sets and unfinished workouts do not enter groups volume or strength", () => {
  const data = initialData();
  data.sessions = [session(data, "2025-01-13", [set("200", "8", "warmup"), set("100", "6"), set("150", "5", "working", "skipped"), set("150", "5", "working", "pending")])];
  const unfinished = session(data, "2025-01-14", [set("300", "5")]);
  unfinished.status = "in_progress";
  data.sessions.push(unfinished);
  const result = summarize(data, 4, "2025-01-20", "kg");
  assert.equal(result.completedWorkouts, 1);
  assert.equal(result.completedSets, 1);
  assert.equal(result.groups.find((group) => group.group === "Legs")?.sets, 1);
  assert.equal(result.volume, 600);
  assert.equal(result.exerciseHistory[0].strengthPoints[0].estimate, 120);
  assert.equal(result.exerciseHistory[0].heaviestSet?.weight, 100);
});

test("historical strength ratios use only measurements on or before a workout and show stale dates", () => {
  const data = initialData();
  data.bodyWeights = [measurement("2025-02-20", 60), measurement("2025-01-01", 80)];
  data.sessions = [session(data, "2025-01-13", [set("100", "6")]), session(data, "2025-02-10", [set("100", "6")])];
  const result = summarize(data, 8, "2025-02-10", "kg");
  assert.deepEqual(result.exerciseHistory[0].strengthPoints.map((point) => ({ ratio: point.relativeStrength, date: point.measurementDate, stale: point.measurementStale })), [
    { ratio: 1.5, date: "2025-01-01", stale: false },
    { ratio: 1.5, date: "2025-01-01", stale: true },
  ]);
  const pounds = summarize(data, 8, "2025-02-10", "lb");
  assert.ok(Math.abs(pounds.exerciseHistory[0].strengthPoints[0].relativeStrength! - 1.5) < 1e-10);
  assert.equal(pounds.exerciseHistory[0].strengthPoints[0].bodyWeight, convertWeight(80, "kg", "lb"));
});

test("missing earlier measurements leave ratio blank while retaining estimated-strength results", () => {
  const data = initialData();
  data.bodyWeights = [measurement("2025-01-20", 80)];
  data.sessions = [session(data, "2025-01-13", [set("100", "6")])];
  const point = summarize(data, 4, "2025-01-20", "kg").exerciseHistory[0].strengthPoints[0];
  assert.equal(point.estimate, 120);
  assert.equal(point.relativeStrength, null);
  assert.equal(point.measurementDate, null);
});

test("weight trends exclude outside-window future entries and calculate actual endpoint change", () => {
  const data = initialData();
  data.bodyWeights = [measurement("2024-01-01", 100), measurement("2025-01-13", 80), measurement("2025-01-20", 82), measurement("2025-01-21", 500)];
  const result = summarize(data, 4, "2025-01-20", "kg");
  assert.deepEqual(result.bodyWeight.points, [{ date: "2025-01-13", weight: 80 }, { date: "2025-01-20", weight: 82 }]);
  assert.equal(result.bodyWeight.change, 2);
  assert.equal(result.bodyWeight.latest?.weight, 82);
  assert.equal(summarize(data, 4, "2025-01-13", "kg").bodyWeight.change, null);
});

test("bodyweight exercises provide rep records without weighted volume or estimated lifting strength", () => {
  const data = initialData();
  data.sessions = [session(data, "2025-01-13", [set("ignored", "20"), set("", "25"), set("", "50", "warmup")], "bodyweight")];
  const history = summarize(data, 4, "2025-01-20", "kg").exerciseHistory[0];
  assert.equal(history.points[0].reps, 25);
  assert.equal(history.repRecord?.reps, 25);
  assert.equal(history.heaviestSet, null);
  assert.equal(history.volume, 0);
  assert.deepEqual(history.strengthPoints, []);
});

test("equipment changes do not merge strength histories and dumbbell loads remain per dumbbell", () => {
  const data = initialData();
  data.bodyWeights = [measurement("2025-01-01", 80)];
  data.sessions = [session(data, "2025-01-13", [set("100", "6")]), session(data, "2025-01-14", [set("20", "6")], "dumbbell")];
  const result = summarize(data, 4, "2025-01-20", "kg");
  assert.equal(result.exerciseHistory.length, 2);
  const dumbbell = result.exerciseHistory.find((history) => history.equipment === "dumbbell")!;
  assert.equal(dumbbell.volume, 120);
  assert.equal(dumbbell.strengthPoints[0].estimate, 24);
  assert.equal(dumbbell.strengthPoints[0].relativeStrength, 0.3);
});

test("rep and weight records retain associated result and estimated strength uses strongest qualifying set", () => {
  const data = initialData();
  data.sessions = [session(data, "2025-01-13", [set("100", "6"), set("110", "2"), set("50", "15")])];
  const history = summarize(data, 4, "2025-01-20", "kg").exerciseHistory[0];
  assert.deepEqual(history.heaviestSet, { date: "2025-01-13", weight: 110, reps: 2 });
  assert.deepEqual(history.repRecord, { date: "2025-01-13", weight: 50, reps: 15 });
  assert.equal(history.strengthPoints[0].estimate, 120);
  assert.equal(history.strengthPoints[0].sourceReps, 6);
});

test("next-workout cards use the next uncompleted plan and recommend from prior dates", () => {
  let data = initialData();
  const plan: WorkoutTemplate = { id: "strength", title: "Strength", exercises: [{ exerciseId: data.exercises[0].id, sets: 2, repMin: 8, repMax: 12 }], weekdays: [0], recurrence: { kind: "weekly" }, archived: false, updatedAt: "2025-01-01T12:00:00Z" };
  data = saveTemplate(data, plan, "2025-01-06");
  data.sessions = [session(data, "2025-01-13", [set("40", "12"), set("80", "10")])];
  const next = nextWorkoutSuggestion(data, "2025-01-13", "lb")!;
  assert.equal(next.date, "2025-01-20");
  assert.equal(next.templateId, "strength");
  assert.deepEqual(next.exercises[0].suggestion.weights, [165, 165]);
  assert.equal(nextWorkoutSuggestion(initialData(), "2025-01-20", "lb"), null);
});

test("analytics are independent of demographic adjustments and preserve original data", () => {
  const data = initialData();
  data.sessions = [session(data, "2025-01-13", [set("100", "6")])];
  const original = structuredClone(data);
  const first = summarize(data, 4, "2025-01-20", "kg");
  const second = summarize({ ...data, settings: { ...data.settings, age: "70", gender: "Female" } }, 4, "2025-01-20", "kg");
  assert.deepEqual(first, second);
  assert.deepEqual(data, original);
});

test("completed biweekly workout today still offers its occurrence exactly fourteen days later", () => {
  let data = initialData();
  const plan: WorkoutTemplate = { id: "strength", title: "Strength", exercises: [{ exerciseId: data.exercises[0].id, sets: 2, repMin: 8, repMax: 12 }], weekdays: [0], recurrence: { kind: "biweekly", anchorMonday: "2025-01-06" }, archived: false, updatedAt: "2025-01-01T12:00:00Z" };
  data = saveTemplate(data, plan, "2025-01-06");
  data.sessions = [session(data, "2025-01-06", [set("40", "12"), set("80", "10")])];
  assert.equal(nextWorkoutSuggestion(data, "2025-01-06", "kg")?.date, "2025-01-20");
});

test("personal records include earlier workouts but exclude future and warm-up records", () => {
  const data = initialData();
  data.sessions = [session(data, "2024-01-01", [set("150", "2"), set("100", "20")]), session(data, "2025-01-13", [set("100", "6"), set("500", "25", "warmup")]), session(data, "2025-01-21", [set("500", "25")])];
  const history = summarize(data, 4, "2025-01-20", "kg").exerciseHistory[0];
  assert.deepEqual(history.heaviestSet, { date: "2025-01-13", weight: 100, reps: 6 });
  assert.deepEqual(history.personalRecords.heaviestSet, { date: "2024-01-01", weight: 150, reps: 2 });
  assert.deepEqual(history.personalRecords.repRecord, { date: "2024-01-01", weight: 100, reps: 20 });
});
