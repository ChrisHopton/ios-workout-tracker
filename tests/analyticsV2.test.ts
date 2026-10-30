import assert from "node:assert/strict";
import test from "node:test";
import { summarize } from "../src/domain/analytics";
import { latestBodyWeight, removeBodyWeight, saveBodyWeight } from "../src/domain/bodyWeight";
import { initialData } from "../src/domain/library";
import { convertWeight } from "../src/domain/recommendations";
import { AppData, BodyWeightEntry, Equipment, MUSCLE_GROUPS, RecordedSet, WorkoutSession } from "../src/domain/types";

function measurement(date: string, weightKg: number): BodyWeightEntry {
  return { id: date, date, weightKg, updatedAt: date + "T12:00:00Z" };
}
function set(weight: string, reps: string, classification: RecordedSet["classification"] = "working", status: RecordedSet["status"] = "completed"): RecordedSet {
  return { weight, reps, classification, status };
}
function session(data: AppData, date: string, sets: RecordedSet[], equipment: Equipment = "barbell"): WorkoutSession {
  return {
    hasFinished: true, routineOccurrence: null, id: date, date, title: "Strength", templateId: "strength", unit: "kg", status: "completed",
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

test("only valid completed working sets enter counts, muscle groups and volume", () => {
  const data = initialData();
  data.sessions = [session(data, "2025-01-13", [
    set("200", "8", "warmup"), set("100", "6"),
    set("150", "5", "working", "skipped"), set("150", "5", "working", "pending"),
    set("", "12"), set("100", "0"), set("-1", "8"), set("100", "8.5"),
  ])];
  const unfinished = session(data, "2025-01-14", [set("300", "5")]);
  unfinished.status = "in_progress";
  data.sessions.push(unfinished);
  const result = summarize(data, 4, "2025-01-20", "kg");
  assert.equal(result.completedWorkouts, 1);
  assert.equal(result.completedSets, 1);
  assert.equal(result.groups.find((group) => group.group === "Legs")?.sets, 1);
  assert.equal(result.volume, 600);
  assert.deepEqual(result.lastWorkout, { id: "2025-01-13", title: "Strength", date: "2025-01-13", workingSets: 1 });
});

test("bodyweight working sets count valid reps but contribute no weighted volume", () => {
  const data = initialData();
  data.sessions = [session(data, "2025-01-13", [
    set("ignored", "20"), set("", "25"), set("", "50", "warmup"),
    set("", "12", "working", "skipped"), set("", "12", "working", "pending"), set("", "0"),
  ], "bodyweight")];
  const result = summarize(data, 4, "2025-01-20", "kg");
  assert.equal(result.completedSets, 2);
  assert.equal(result.lastWorkout?.workingSets, 2);
  assert.equal(result.volume, 0);
  assert.equal(result.weeks.reduce((sum, week) => sum + week.volume, 0), 0);
});

test("last workout uses recorded date instead of import or edit timestamps and array order", () => {
  const data = initialData();
  const imported = {
    ...session(data, "2025-01-06", [set("100", "6")]),
    id: "imported", title: "Older imported workout",
    startedAt: "2026-10-29T12:00:00Z", finishedAt: "2026-10-29T12:00:00Z", updatedAt: "2026-10-29T12:00:00Z",
  };
  const latest = { ...session(data, "2025-01-13", [set("100", "6"), set("100", "8")]), title: "Latest recorded workout" };
  for (const history of [[imported, latest], [latest, imported]]) {
    data.sessions = history;
    const original = structuredClone(data);
    assert.deepEqual(summarize(data, 4, "2025-01-20", "kg").lastWorkout, {
      id: latest.id, title: latest.title, date: latest.date, workingSets: 2,
    });
    assert.deepEqual(data, original);
  }
});

test("last workout spans all history but excludes unfinished workouts and dates after the cutoff", () => {
  const data = initialData();
  const old = session(data, "2025-01-06", [set("100", "6")]);
  const unfinished = { ...session(data, "2025-02-03", [set("200", "6")]), status: "in_progress" as const, finishedAt: null };
  const future = session(data, "2025-02-10", [set("300", "6")]);
  data.sessions = [future, unfinished, old];
  const narrow = summarize(data, 1, "2025-02-05", "kg");
  const wide = summarize(data, 8, "2025-02-05", "kg");
  assert.equal(narrow.completedWorkouts, 0);
  assert.equal(narrow.completedSets, 0);
  assert.equal(narrow.volume, 0);
  assert.equal(wide.completedWorkouts, 1);
  assert.deepEqual(narrow.lastWorkout, { id: old.id, title: old.title, date: old.date, workingSets: 1 });
  assert.deepEqual(narrow.lastWorkout, wide.lastWorkout);
  assert.equal(summarize(data, 1, "2025-01-05", "kg").lastWorkout, null);
  assert.equal(summarize(data, 1, "2025-02-10", "kg").lastWorkout?.id, future.id);
});

test("last workout remains the latest finished record even if it has no valid working sets", () => {
  const data = initialData();
  data.sessions = [
    session(data, "2025-01-06", [set("100", "6")]),
    session(data, "2025-01-13", [set("100", "6", "warmup"), set("100", "6", "working", "skipped")]),
  ];
  const result = summarize(data, 4, "2025-01-20", "kg");
  assert.equal(result.lastWorkout?.date, "2025-01-13");
  assert.equal(result.lastWorkout?.workingSets, 0);
  assert.equal(result.completedWorkouts, 2);
  assert.equal(result.completedSets, 1);
});

test("volume converts workout units and keeps dumbbell loads per dumbbell", () => {
  const data = initialData();
  const metric = session(data, "2025-01-13", [set("20", "6")], "dumbbell");
  const pounds = { ...session(data, "2025-01-14", [set("100", "8")]), unit: "lb" as const };
  pounds.exercises[0].exercise.group = "Back";
  data.sessions = [metric, pounds];
  const result = summarize(data, 4, "2025-01-20", "kg");
  assert.ok(Math.abs(result.volume - (120 + convertWeight(100, "lb", "kg") * 8)) < 1e-10);
  assert.equal(result.groups.find((group) => group.group === "Legs")?.sets, 1);
  assert.equal(result.groups.find((group) => group.group === "Back")?.sets, 1);
  assert.ok(Math.abs(summarize(data, 4, "2025-01-20", "lb").volume - convertWeight(result.volume, "kg", "lb")) < 1e-10);
});

test("empty history retains zero weeks and all muscle groups without obsolete analytics fields", () => {
  const result = summarize(initialData(), 2, "2025-01-15", "lb");
  assert.equal(result.startDate, "2025-01-06");
  assert.equal(result.endDate, "2025-01-15");
  assert.equal(result.unit, "lb");
  assert.deepEqual(result.weeks.map((week) => week.startDate), ["2025-01-06", "2025-01-13"]);
  assert.ok(result.weeks.every((week) => week.totalSets === 0 && week.completedWorkouts === 0 && week.volume === 0));
  assert.deepEqual(result.groups, MUSCLE_GROUPS.map((group) => ({ group, sets: 0 })));
  assert.equal(result.completedWorkouts, 0);
  assert.equal(result.completedSets, 0);
  assert.equal(result.volume, 0);
  assert.equal(result.scheduledWorkouts, 0);
  assert.equal(result.completedScheduledWorkouts, 0);
  assert.equal(result.completionRate, null);
  assert.equal(result.lastWorkout, null);
  for (const field of ["exerciseHistory", "bodyWeight", "nextWorkout"])
    assert.equal(Object.hasOwn(result, field), false);
});

test("summary does not depend on body-weight measurements and never mutates source data", () => {
  const data = initialData();
  data.sessions = [session(data, "2025-01-13", [set("100", "6")])];
  const original = structuredClone(data);
  const first = summarize(data, 4, "2025-01-20", "kg");
  const second = summarize({ ...data, bodyWeights: [measurement("2025-01-01", 80), measurement("2025-01-21", 90)] }, 4, "2025-01-20", "kg");
  assert.deepEqual(first, second);
  assert.deepEqual(data, original);
});

test("analytics reject invalid dates and windows", () => {
  for (const weeks of [0, 105, 1.5, Infinity])
    assert.throws(() => summarize(initialData(), weeks, "2025-01-20", "kg"), /between 1 and 104/);
  assert.throws(() => summarize(initialData(), 4, "2025-02-30", "kg"), /calendar date/);
});
