import test from "node:test";
import assert from "node:assert/strict";
import { SaveAction } from "../src/components/saveAction";
import { SaveQueue } from "../src/data/saveQueue";
import { snapshot } from "../src/data/snapshot";
import { initialData } from "../src/domain/library";
import { mergeWorkoutImport, parseWorkoutImport, previewWorkoutImport, type WorkoutImport } from "../src/domain/workoutImport";
import type { AppData } from "../src/domain/types";

const date = "2026-10-29";
const at = "2026-10-01T12:00:00.000Z";
function fixture(): WorkoutImport {
  const exercise = { ...initialData().exercises[0], id: "synthetic-import-exercise", name: "Synthetic test exercise" };
  const target = { exerciseId: exercise.id, sets: 1, repMin: 8, repMax: 12 };
  const plan = { id: "synthetic-import-plan", title: "Synthetic import plan", exercises: [target],
    weekdays: [], recurrence: { kind: "weekly" as const }, archived: false, updatedAt: at };
  return {
    type: "workout-import", version: 1, sourceId: "synthetic-saving-test", importId: "synthetic-saving-test-v1",
    exercises: [exercise], templates: [plan],
    sessions: [{
      id: "synthetic-import-workout", date: "2026-10-01", title: plan.title, templateId: plan.id,
      unit: "lb", status: "completed", hasFinished: true, routineOccurrence: null, startedAt: at, updatedAt: at, finishedAt: at,
      exercises: [{ exercise, target, suggestion: { algorithmVersion: 2, weights: [null], reason: "Imported recorded values" },
        sets: [{ classification: "working", weight: "40", reps: "10", status: "completed" }] }],
    }],
  };
}

test("import failure keeps visible and durable data; retry commits once and reselecting the file is idempotent", async () => {
  const file = JSON.stringify(fixture());
  const source = parseWorkoutImport(file);
  let visible = snapshot(initialData());
  let persisted = visible;
  const original = visible;
  let writes = 0;
  let release!: () => void;
  const firstWrite = new Promise<void>(resolve => { release = resolve; });
  const queue = new SaveQueue<AppData>(async next => {
    writes++;
    if (writes === 1) { await firstWrite; throw new Error("Storage unavailable"); }
    persisted = next;
  });
  const action = new SaveAction();
  const save = () => action.run(async () => {
    const next = snapshot(mergeWorkoutImport(visible, source, { effectiveDate: date }));
    await queue.replace(next, visible);
    visible = next;
  }, async () => {});
  const pending = save();
  assert.equal(action.getSnapshot().status, "saving");
  assert.equal(visible, original);
  assert.equal(persisted, original);
  assert.equal(await save(), false);
  release();
  assert.equal(await pending, false);
  assert.equal(action.getSnapshot().status, "error");
  assert.equal(visible, original);
  assert.equal(persisted, original);
  assert.equal(source.sessions.length, 1);

  assert.equal(await save(), true);
  assert.equal(action.getSnapshot().status, "saved");
  assert.equal(visible, persisted);
  assert.equal(visible.templates.length, 1);
  assert.equal(visible.sessions.length, 1);
  assert.equal(writes, 2);
  const selectedAgain = parseWorkoutImport(file);
  const preview = previewWorkoutImport(visible, selectedAgain, date);
  assert.equal(preview.plansAdded + preview.workoutsAdded + preview.exercisesAdded, 0);
  assert.equal(preview.duplicatesSkipped, 3);
  assert.equal(mergeWorkoutImport(visible, selectedAgain, { effectiveDate: date }), visible);
});

test("an import merged after preview retains newer profile, measurement and history edits", async () => {
  const source = fixture();
  const beforePicker = snapshot(initialData());
  const initialPreview = previewWorkoutImport(beforePicker, source, date);
  assert.equal(initialPreview.workoutsAdded, 1);
  const recentHistory = { ...source.sessions[0], hasFinished: true, routineOccurrence: null, id: "existing-local-workout", date: "2026-10-02" };
  const latest = snapshot({
    ...beforePicker,
    settings: { ...beforePicker.settings, firstName: "Updated locally", unit: "kg" },
    bodyWeights: [{ id: "local-measurement", date, weightKg: 78.25, updatedAt: at }],
    sessions: [recentHistory],
  });
  const merged = snapshot(mergeWorkoutImport(latest, source, { effectiveDate: date }));
  let stored = latest;
  const queue = new SaveQueue<AppData>(async next => { stored = next; });
  await queue.replace(merged, latest);
  assert.equal(stored.settings, latest.settings);
  assert.equal(stored.bodyWeights, latest.bodyWeights);
  assert.equal(stored.sessions[0], latest.sessions[0]);
  assert.equal(stored.sessions.length, 2);
  assert.equal(stored.settings.unit, "kg");
  assert.equal(stored.sessions[1].unit, "lb");
  assert.equal(mergeWorkoutImport(stored, source, { effectiveDate: date }), stored);
});
