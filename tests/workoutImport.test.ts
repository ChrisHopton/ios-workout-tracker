import test from "node:test";
import assert from "node:assert/strict";
import { validateData } from "../src/domain/backup";
import { initialData } from "../src/domain/library";
import { archiveTemplate, planEditEffectiveDate, saveTemplate, scheduleForDate } from "../src/domain/schedule";
import {
  MAX_WORKOUT_IMPORT_BYTES,
  mergeWorkoutImport,
  parseWorkoutImport,
  previewWorkoutImport,
  type WorkoutImport,
} from "../src/domain/workoutImport";
import { ExerciseDefinition, WorkoutSession, WorkoutTemplate } from "../src/domain/types";

const clockDate = "2026-10-29";
const starts = "2026-11-02";
const stamp = "2026-10-01T12:00:00.000Z";
function exercise(): ExerciseDefinition {
  return { ...initialData().exercises.find(item => item.id === "exercise-barbell-squat")! };
}
function plan(id = "fixture-plan", weekdays = [0]): WorkoutTemplate {
  return {
    id, title: id, weekdays, recurrence: { kind: "weekly" }, archived: false, updatedAt: stamp,
    exercises: [{ exerciseId: exercise().id, sets: 2, repMin: 8, repMax: 12 }],
  };
}
function session(id = "fixture-session", date = "2026-10-20", definition = exercise()): WorkoutSession {
  return {
    id, date, title: "Historical workout", templateId: "fixture-plan", unit: "lb", status: "completed",
    startedAt: date + "T12:00:00.000Z", updatedAt: date + "T13:00:00.000Z", finishedAt: date + "T13:00:00.000Z",
    exercises: [{
      exercise: { ...definition },
      target: { exerciseId: definition.id, sets: 2, repMin: 8, repMax: 12 },
      suggestion: { algorithmVersion: 2, weights: [null, null], reason: "Imported actual results" },
      sets: [
        { classification: "working", weight: "100", reps: "8", status: "completed" },
        { classification: "warmup", weight: "", reps: "", status: "skipped" },
      ],
    }],
  };
}
function source(): WorkoutImport {
  return {
    type: "workout-import", version: 1, sourceId: "fixture-workbook", importId: "fixture-import-v1",
    scheduleStartDate: starts, exercises: [exercise()], templates: [plan()], sessions: [session()],
  };
}
const options = { effectiveDate: clockDate };

test("the narrow file format accepts training only and rejects profile, credentials, or unrelated backup fields", () => {
  const value = source();
  assert.deepEqual(parseWorkoutImport(JSON.stringify(value)), value);
  for (const extra of [
    { settings: {} }, { bodyWeights: [] }, { credentials: {} }, { schemaVersion: 3 }, { scheduleRevisions: [] },
  ]) assert.throws(() => parseWorkoutImport(JSON.stringify({ ...value, ...extra })), /unsupported or missing fields/);
  for (const changed of [{ type: "backup" }, { version: 2 }, { sourceId: "" }, { importId: "unstable id" }]) {
    assert.throws(() => parseWorkoutImport(JSON.stringify({ ...value, ...changed })), /Invalid workout import/);
  }
  assert.throws(() => parseWorkoutImport("not json"), /valid workout-import JSON/);
  assert.throws(() => parseWorkoutImport(JSON.stringify({ ...value, scheduleStartDate: "2026-02-30" })));
  assert.throws(() => parseWorkoutImport("€".repeat(Math.ceil(MAX_WORKOUT_IMPORT_BYTES / 3))), /smaller than 10 MiB/);
});

test("import validation reuses exact set, snapshot, exercise-reference, and ID checks", () => {
  const invalid = source();
  invalid.sessions[0].exercises[0].sets[0].reps = "0";
  assert.throws(() => parseWorkoutImport(JSON.stringify(invalid)), /at least one rep/);
  const missingExercise = source();
  missingExercise.templates[0].exercises[0].exerciseId = "missing";
  assert.throws(() => parseWorkoutImport(JSON.stringify(missingExercise)), /existing exercise/);
  const duplicatePlan = source();
  duplicatePlan.templates.push({ ...duplicatePlan.templates[0] });
  assert.throws(() => parseWorkoutImport(JSON.stringify(duplicatePlan)), /template IDs must be unique/);
  const duplicateDate = source();
  duplicateDate.sessions.push({ ...duplicateDate.sessions[0], id: "another-id" });
  assert.throws(() => parseWorkoutImport(JSON.stringify(duplicateDate)), /sessions.date.*duplicate/);
});

test("import is additive and retains current profile, measurements, history, definitions, and earlier schedules", () => {
  let current = saveTemplate(initialData(), plan("existing-plan", [1]), "2026-10-01");
  current = {
    ...current,
    bodyWeights: [{ id: "synthetic-existing-measurement", date: "2026-10-01", weightKg: 80, updatedAt: stamp }],
    sessions: [session("existing-workout", "2026-10-19")],
  };
  const historicalRevision = current.scheduleRevisions[0];
  const before = JSON.stringify(current);
  const payload = source();
  const payloadBefore = JSON.stringify(payload);
  const preview = previewWorkoutImport(current, payload, clockDate);
  assert.equal(preview.effectiveDate, starts);
  assert.equal(preview.scheduleStartDate, starts);
  assert.equal(preview.plansAdded, 1);
  assert.equal(preview.workoutsAdded, 1);
  assert.equal(preview.requiresUnscheduledConsent, false);
  assert.equal(JSON.stringify(current), before);
  const merged = mergeWorkoutImport(current, payload, options);
  assert.equal(merged.settings, current.settings);
  assert.equal(merged.bodyWeights, current.bodyWeights);
  assert.equal(merged.sessions[0], current.sessions[0]);
  assert.equal(merged.templates[0], current.templates[0]);
  assert.equal(merged.scheduleRevisions[0], historicalRevision);
  assert.equal(merged.exercises, current.exercises);
  assert.equal(scheduleForDate(merged, "2026-10-27")?.id, "existing-plan");
  assert.equal(scheduleForDate(merged, "2026-10-26"), null);
  assert.equal(scheduleForDate(merged, starts)?.id, "fixture-plan");
  assert.equal(scheduleForDate(merged, "2026-11-03")?.id, "existing-plan");
  assert.deepEqual(merged.sessions[1], payload.sessions[0]);
  assert.equal(JSON.stringify(current), before);
  assert.equal(JSON.stringify(payload), payloadBefore);
  validateData(merged);
});

test("six A/B/C and D/E/F plans retain their explicit alternating anchors and start next week", () => {
  const payload = source();
  payload.templates = ["a", "b", "c", "d", "e", "f"].map((id, index) => ({
    ...plan("fixture-" + id, [[0, 2, 4][index % 3]]),
    recurrence: { kind: "biweekly" as const, anchorMonday: index < 3 ? starts : "2026-11-09" },
  }));
  const current = saveTemplate(initialData(), plan("existing-tuesday", [1]), starts);
  const merged = mergeWorkoutImport(current, payload, options);
  const expected = [
    [starts, "fixture-a"], ["2026-11-04", "fixture-b"], ["2026-11-06", "fixture-c"],
    ["2026-11-09", "fixture-d"], ["2026-11-11", "fixture-e"], ["2026-11-13", "fixture-f"],
    ["2026-11-16", "fixture-a"], ["2026-11-03", "existing-tuesday"],
  ];
  for (const [date, id] of expected) assert.equal(scheduleForDate(merged, date)?.id, id);
  assert.equal(scheduleForDate(merged, "2026-10-30"), null);
  assert.equal(merged.scheduleRevisions.length, 1, "same-effective-date revisions merge without duplicate dates");
  assert.equal(previewWorkoutImport(current, payload, clockDate).plansAdded, 6);
  validateData(merged);
});

test("importing later never backdates schedule activation or shifts biweekly anchors", () => {
  const payload = source();
  payload.templates[0].recurrence = { kind: "biweekly", anchorMonday: starts };
  const preview = previewWorkoutImport(initialData(), payload, "2026-11-10");
  assert.equal(preview.effectiveDate, "2026-11-10");
  const merged = mergeWorkoutImport(initialData(), payload, { effectiveDate: "2026-11-10" });
  assert.equal(scheduleForDate(merged, starts), null);
  assert.equal(scheduleForDate(merged, "2026-11-09"), null);
  assert.equal(scheduleForDate(merged, "2026-11-16")?.id, "fixture-plan");
  assert.equal(scheduleForDate(merged, "2026-11-23"), null);
});

test("repeated files add no duplicates despite saveTemplate timestamps and preserve later user edits", () => {
  const payload = source();
  const first = mergeWorkoutImport(initialData(), payload, options);
  assert.equal(mergeWorkoutImport(first, payload, options), first);
  const repeat = previewWorkoutImport(first, payload, clockDate);
  assert.equal(repeat.plansAdded + repeat.workoutsAdded + repeat.exercisesAdded, 0);
  assert.equal(repeat.conflicts.length, 0);
  const edited = {
    ...first,
    templates: first.templates.map(template => ({ ...template, title: "User-edited plan" })),
    sessions: first.sessions.map(workout => ({
      ...workout,
      exercises: workout.exercises.map(item => ({ ...item, sets: item.sets.map((set, index) => index ? set : { ...set, reps: "9" }) })),
    })),
  };
  const conflict = previewWorkoutImport(edited, payload, clockDate);
  assert.ok(conflict.conflicts.some(item => item.kind === "plan-id"));
  assert.ok(conflict.conflicts.some(item => item.kind === "workout-id"));
  assert.equal(mergeWorkoutImport(edited, payload, options), edited);
});

test("same exercise identity reuses current increments while conflicting meaning skips dependent training", () => {
  const payload = source();
  const current = initialData();
  const existing = current.exercises.find(item => item.id === exercise().id)!;
  existing.incrementLb = 10;
  existing.incrementKg = 5;
  const merged = mergeWorkoutImport(current, payload, options);
  assert.equal(merged.exercises.find(item => item.id === existing.id), existing);
  assert.equal(merged.exercises.find(item => item.id === existing.id)?.incrementLb, 10);
  assert.deepEqual(merged.sessions[0].exercises[0].exercise, payload.sessions[0].exercises[0].exercise);
  for (const patch of [{ name: "Different exercise" }, { equipment: "dumbbell" as const }, { group: "Arms" as const }]) {
    const changed = source();
    changed.exercises[0] = { ...changed.exercises[0], ...patch };
    changed.sessions[0].exercises[0].exercise = { ...changed.exercises[0] };
    const preview = previewWorkoutImport(current, changed, clockDate);
    assert.equal(preview.plansAdded, 0);
    assert.equal(preview.workoutsAdded, 0);
    assert.ok(preview.conflicts.some(item => item.kind === "exercise-id"));
    assert.equal(preview.conflicts.filter(item => item.kind === "exercise-reference").length, 2);
    assert.equal(mergeWorkoutImport(current, changed, options), current);
  }
});

test("occupied dates and conflicting workout IDs are reported without replacing existing history", () => {
  const payload = source();
  payload.sessions = [
    session("same-id", "2026-10-20"),
    session("imported-occupied", "2026-10-21"),
    session("new-history", "2026-10-22"),
  ];
  const edited = session("same-id", "2026-10-20");
  edited.exercises[0].sets[0].reps = "9";
  const current = { ...initialData(), sessions: [edited, session("phone-history", "2026-10-21")] };
  const preview = previewWorkoutImport(current, payload, clockDate);
  assert.equal(preview.workoutsAdded, 1);
  assert.ok(preview.conflicts.some(item => item.kind === "workout-id"));
  assert.ok(preview.conflicts.some(item => item.kind === "occupied-date" && item.date === "2026-10-21"));
  const merged = mergeWorkoutImport(current, payload, options);
  assert.equal(merged.sessions.length, 3);
  assert.equal(merged.sessions[0], current.sessions[0]);
  assert.equal(merged.sessions[1], current.sessions[1]);
  assert.deepEqual(merged.sessions[2], payload.sessions[2]);
});

test("schedule collisions only unschedule affected new plans after explicit preview consent", () => {
  const current = saveTemplate(initialData(), plan("existing-monday", [0]), "2026-10-01");
  const payload = source();
  payload.templates.push(plan("nonconflicting-wednesday", [2]));
  const before = JSON.stringify(current);
  const preview = previewWorkoutImport(current, payload, clockDate);
  assert.equal(preview.plansAdded, 2);
  assert.equal(preview.plansUnscheduled, 1);
  assert.equal(preview.requiresUnscheduledConsent, true);
  assert.ok(preview.conflicts.some(item => item.kind === "schedule" && item.id === "fixture-plan"));
  assert.throws(() => mergeWorkoutImport(current, payload, options), /confirm importing.*without scheduled days/);
  assert.equal(JSON.stringify(current), before);
  const merged = mergeWorkoutImport(current, payload, { ...options, allowUnscheduledPlans: true });
  assert.deepEqual(merged.templates.find(item => item.id === "fixture-plan")?.weekdays, []);
  assert.deepEqual(merged.templates.find(item => item.id === "nonconflicting-wednesday")?.weekdays, [2]);
  assert.equal(scheduleForDate(merged, starts)?.id, "existing-monday");
  assert.equal(scheduleForDate(merged, "2026-11-04")?.id, "nonconflicting-wednesday");
  assert.equal(mergeWorkoutImport(merged, payload, options), merged);
  assert.deepEqual(payload.templates[0].weekdays, [0]);
});

test("overlapping schedules within a file preview conflicts instead of rejecting usable workouts", () => {
  const payload = source();
  payload.templates.push(plan("another-monday", [0]));
  const parsed = parseWorkoutImport(JSON.stringify(payload));
  const preview = previewWorkoutImport(initialData(), parsed, clockDate);
  assert.equal(preview.plansAdded, 2);
  assert.equal(preview.plansUnscheduled, 1);
  assert.equal(preview.workoutsAdded, 1);
  const merged = mergeWorkoutImport(initialData(), parsed, { ...options, allowUnscheduledPlans: true });
  assert.equal(scheduleForDate(merged, starts)?.id, "fixture-plan");
  assert.deepEqual(merged.templates[1].weekdays, []);
  validateData(merged);
});

test("a later saved revision is preserved and requires consent to keep imported plans unscheduled", () => {
  const current = saveTemplate(initialData(), plan("future-tuesday", [1]), "2026-11-16");
  const payload = source();
  const preview = previewWorkoutImport(current, payload, clockDate);
  assert.equal(preview.plansUnscheduled, 1);
  assert.equal(preview.requiresUnscheduledConsent, true);
  const merged = mergeWorkoutImport(current, payload, { ...options, allowUnscheduledPlans: true });
  assert.equal(merged.scheduleRevisions, current.scheduleRevisions);
  assert.equal(scheduleForDate(merged, "2026-11-17")?.id, "future-tuesday");
  assert.deepEqual(merged.templates.find(item => item.id === "fixture-plan")?.weekdays, []);
});

test("new exercises and exact historical actuals are copied without sharing mutable file objects", () => {
  const payload = source();
  const custom = { ...exercise(), id: "fixture-custom-exercise", name: "Custom movement" };
  payload.exercises = [custom];
  payload.templates[0].exercises[0].exerciseId = custom.id;
  payload.sessions = [session("custom-history", "2026-10-20", custom)];
  const merged = mergeWorkoutImport(initialData(), payload, options);
  assert.equal(previewWorkoutImport(initialData(), payload, clockDate).exercisesAdded, 1);
  assert.deepEqual(merged.sessions[0], payload.sessions[0]);
  payload.exercises[0].name = "Changed file";
  payload.sessions[0].exercises[0].sets[0].weight = "999";
  assert.equal(merged.exercises.find(item => item.id === custom.id)?.name, "Custom movement");
  assert.equal(merged.sessions[0].exercises[0].sets[0].weight, "100");
  validateData(merged);
});

test("plan editing selects today or the latest pending revision without changing schedule API rules", () => {
  const empty = initialData();
  assert.equal(planEditEffectiveDate(empty, clockDate), clockDate);
  const past = saveTemplate(empty, plan("existing", [3]), "2026-10-01");
  assert.equal(planEditEffectiveDate(past, clockDate), clockDate);
  const pending = saveTemplate(past, plan("pending"), starts);
  const order = [...pending.scheduleRevisions];
  assert.equal(planEditEffectiveDate(pending, clockDate), starts);
  assert.equal(planEditEffectiveDate(pending, starts), starts);
  assert.equal(planEditEffectiveDate(pending, "2026-11-03"), "2026-11-03");
  assert.deepEqual(pending.scheduleRevisions, order);
  assert.throws(() => planEditEffectiveDate(pending, "2026-02-30"), /calendar date/);
  assert.throws(() => saveTemplate(pending, plan("pending"), clockDate), /cannot precede/);
});

test("editing imported and existing plans before their future start preserves earlier dates and recurrence", () => {
  const current = saveTemplate(initialData(), plan("existing", [3]), "2026-10-01");
  const earlierRevision = current.scheduleRevisions[0];
  const payload = source();
  payload.templates[0].recurrence = { kind: "biweekly", anchorMonday: starts };
  const imported = mergeWorkoutImport(current, payload, options);
  const history = imported.sessions;
  const effectiveDate = planEditEffectiveDate(imported, clockDate);
  let edited = saveTemplate(imported, {
    ...imported.templates.find(item => item.id === "fixture-plan")!,
    title: "Edited imported plan",
    exercises: [{ ...payload.templates[0].exercises[0], sets: 4 }],
  }, effectiveDate);
  edited = saveTemplate(edited, {
    ...edited.templates.find(item => item.id === "existing")!,
    title: "Edited existing plan",
  }, planEditEffectiveDate(edited, clockDate));
  assert.equal(effectiveDate, starts);
  assert.equal(edited.scheduleRevisions.length, 2);
  assert.equal(edited.scheduleRevisions[0], earlierRevision);
  assert.equal(scheduleForDate(edited, clockDate)?.title, "existing");
  assert.equal(scheduleForDate(edited, "2026-10-22")?.title, "existing");
  assert.equal(scheduleForDate(edited, "2026-10-26"), null);
  assert.equal(scheduleForDate(edited, starts)?.title, "Edited imported plan");
  assert.equal(scheduleForDate(edited, starts)?.exercises[0].sets, 4);
  assert.equal(scheduleForDate(edited, "2026-11-05")?.title, "Edited existing plan");
  assert.equal(scheduleForDate(edited, "2026-11-09"), null);
  assert.equal(scheduleForDate(edited, "2026-11-16")?.title, "Edited imported plan");
  assert.deepEqual(edited.templates.find(item => item.id === "fixture-plan")?.recurrence, payload.templates[0].recurrence);
  assert.equal(edited.sessions, history);
  validateData(edited);
});

test("archiving before an imported schedule starts preserves current dates and the other alternating week", () => {
  const current = saveTemplate(initialData(), plan("existing", [3]), "2026-10-01");
  const earlierRevision = current.scheduleRevisions[0];
  const payload = source();
  payload.templates[0].recurrence = { kind: "biweekly", anchorMonday: starts };
  payload.templates.push({
    ...plan("opposite-week"),
    recurrence: { kind: "biweekly", anchorMonday: "2026-11-09" },
  });
  const imported = mergeWorkoutImport(current, payload, options);
  let archived = archiveTemplate(imported, "fixture-plan", planEditEffectiveDate(imported, clockDate));
  archived = archiveTemplate(archived, "existing", planEditEffectiveDate(archived, clockDate));
  assert.equal(archived.scheduleRevisions.length, 2);
  assert.equal(archived.scheduleRevisions[0], earlierRevision);
  assert.equal(scheduleForDate(archived, clockDate)?.id, "existing");
  assert.equal(scheduleForDate(archived, "2026-10-22")?.id, "existing");
  assert.equal(scheduleForDate(archived, starts), null);
  assert.equal(scheduleForDate(archived, "2026-11-05"), null);
  assert.equal(scheduleForDate(archived, "2026-11-09")?.id, "opposite-week");
  assert.equal(scheduleForDate(archived, "2026-11-16"), null);
  assert.equal(archived.sessions, imported.sessions);
  validateData(archived);
});
