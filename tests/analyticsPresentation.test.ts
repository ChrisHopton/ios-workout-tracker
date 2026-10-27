import test from "node:test";
import assert from "node:assert/strict";
import { ExerciseHistory } from "../src/domain/analytics";
import { ANALYTICS_PERIODS, effectiveMetric, exerciseRoute, filterExercises, recentExercises, selectedExercise } from "../src/components/analytics/selection";

function history(id: string, date: string, overrides: Partial<ExerciseHistory> = {}): ExerciseHistory {
  return {
    exerciseId: id, variantId: `${id}:barbell`, name: id, group: "Legs", equipment: "barbell",
    points: [{ date, weight: 80, reps: 8, sets: 3 }], strengthPoints: [], volume: 1920,
    personalRecords: { heaviestSet: { date: "2025-01-01", weight: 100, reps: 5 }, repRecord: null },
    heaviestSet: null, repRecord: null, ...overrides,
  };
}

test("overview selects at most five recently performed variants without mutating history", () => {
  const histories = Array.from({ length: 7 }, (_, index) => history(`Exercise ${index}`, `2025-01-${10 + index}`));
  histories.push(history("No working sets", "2025-01-30", { points: [] }));
  const before = structuredClone(histories);
  const recent = recentExercises(histories);
  assert.deepEqual(recent.map((entry) => entry.name), ["Exercise 6", "Exercise 5", "Exercise 4", "Exercise 3", "Exercise 2"]);
  assert.equal(recent[0].points.at(-1)?.weight, 80, "latest recorded load stays separate from the all-time PR");
  assert.deepEqual(histories, before);
});

test("same-date recent ordering is stable and keeps equipment variants separate", () => {
  const barbell = history("bench", "2025-01-20", { name: "Bench press" });
  const dumbbell = { ...barbell, variantId: "bench:dumbbell", equipment: "dumbbell" as const };
  assert.deepEqual(recentExercises([dumbbell, barbell]).map((entry) => entry.variantId), ["bench:barbell", "bench:dumbbell"]);
  assert.deepEqual(recentExercises([barbell, dumbbell]).map((entry) => entry.variantId), ["bench:barbell", "bench:dumbbell"]);
});

test("exercise search combines case-insensitive name and equipment terms with the selected muscle filter", () => {
  const histories = [
    history("bench", "2025-01-20", { name: "Bench press", group: "Chest" }),
    history("db-bench", "2025-01-21", { name: "Bench press", group: "Chest", equipment: "dumbbell" }),
    history("squat", "2025-01-22", { name: "Squat" }),
  ];
  assert.deepEqual(filterExercises(histories, "  BENCH   dumbbell ", "Chest").map((entry) => entry.exerciseId), ["db-bench"]);
  assert.deepEqual(filterExercises(histories, "bench", "Legs"), []);
  assert.deepEqual(filterExercises(histories, "", "All").map((entry) => entry.exerciseId), ["squat", "db-bench", "bench"]);
  assert.equal(filterExercises(histories, "no match", "All").length, 0);
});

test("exercise navigation preserves exact variant identity and never falls back for a stale or ambiguous link", () => {
  const entries = [history("exercise:custom", "2025-01-20"), history("other", "2025-01-20")];
  const route = exerciseRoute(entries[0].variantId);
  assert.equal(route.pathname, "/analytics-exercise");
  assert.equal(selectedExercise(entries, route.params.variantId), entries[0]);
  for (const invalid of [undefined, "missing:barbell", "exercise:custom:dumbbell", [entries[0].variantId, entries[1].variantId]])
    assert.equal(selectedExercise(entries, invalid), undefined);
});

test("bodyweight progress always shows reps and period choices remain bounded", () => {
  for (const metric of ["weight", "reps", "strength"] as const) assert.equal(effectiveMetric("bodyweight", metric), "reps");
  assert.equal(effectiveMetric("barbell", "strength"), "strength");
  assert.equal(effectiveMetric("dumbbell", "weight"), "weight");
  assert.deepEqual(ANALYTICS_PERIODS, [4, 8, 12]);
});
