import test from "node:test";
import assert from "node:assert/strict";
import { nextStepForDisplay } from "../src/components/suggestionPresentation";
import { initialData } from "../src/domain/library";
import { SessionExercise } from "../src/domain/types";

function item(weights: (number | null)[], bodyweight = false): SessionExercise {
  const exercise = initialData().exercises.find((entry) => entry.equipment === (bodyweight ? "bodyweight" : "barbell"))!;
  return { exercise, target: { exerciseId: exercise.id, sets: 3, repMin: 8, repMax: 12 },
    suggestion: { algorithmVersion: 1, weights, reason: "Legacy algorithm provenance must not be shown." }, sets: [] };
}
test("Next step shows a numeric weight, set count and rep target without stored provenance", () => {
  const source = item([75, 75, 75]); const before = structuredClone(source);
  assert.equal(nextStepForDisplay(source, "lb"), "75 lb · 3 sets × 8–12 reps");
  assert.deepEqual(source, before);
  assert.equal(nextStepForDisplay(item([0, 0, 0]), "kg"), "0 kg · 3 sets × 8–12 reps");
  assert.equal(nextStepForDisplay(item([10, 12.5, 15]), "kg"), "10 / 12.5 / 15 kg · 3 sets × 8–12 reps");
});
test("missing history asks for a starting weight and bodyweight remains reps-only", () => {
  assert.equal(nextStepForDisplay(item([null, null, null]), "lb"), "Choose a starting weight · 3 sets × 8–12 reps");
  assert.equal(nextStepForDisplay(item([10, null, 10]), "kg"), "Choose a starting weight · 3 sets × 8–12 reps");
  assert.equal(nextStepForDisplay(item([null, null, null], true), "lb"), "3 sets × 8–12 reps");
});
