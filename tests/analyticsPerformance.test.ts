import test from "node:test";
import assert from "node:assert/strict";
import { summarize } from "../src/domain/analytics";
import { initialData } from "../src/domain/library";
import { convertWeight, suggestWeights } from "../src/domain/recommendations";
import { saveTemplate } from "../src/domain/schedule";
import {
  ExerciseDefinition,
  RecordedSet,
  WorkoutSession,
  WorkoutTemplate,
} from "../src/domain/types";

const target = {
  exerciseId: "exercise-barbell-squat",
  sets: 3,
  repMin: 8,
  repMax: 12,
};
const plan: WorkoutTemplate = {
  id: "plan",
  title: "Workout",
  exercises: [target],
  recurrence: { kind: "weekly" },
  weekdays: [0],
  archived: false,
  updatedAt: "2025-01-01T12:00:00Z",
};

function completedSet(weight: string, reps: string): RecordedSet {
  return { classification: "working", weight, reps, status: "completed" };
}

function session(
  definition: ExerciseDefinition,
  date: string,
  weight = "100",
): WorkoutSession {
  return {
    id: date,
    date,
    title: plan.title,
    templateId: plan.id,
    unit: "lb",
    status: "completed",
    startedAt: date + "T12:00:00Z",
    updatedAt: date + "T13:00:00Z",
    finishedAt: date + "T13:00:00Z",
    exercises: [{
      exercise: definition,
      target,
      suggestion: { algorithmVersion: 1, weights: [], reason: "" },
      sets: Array.from({ length: target.sets }, () => completedSet(weight, "12")),
    }],
  };
}

test("recommendations reuse the latest demonstrated load with changed targets in unordered history", () => {
  const data = initialData();
  const definition = data.exercises[0];
  const older = session(definition, "2025-01-06");
  const latest = session(definition, "2025-01-13");
  const unrelated = session(definition, "2025-01-19", "300");
  unrelated.exercises[0].target = { ...target, repMax: 15 };
  data.sessions = [
    latest,
    session(definition, "2025-01-20", "300"),
    unrelated,
    older,
  ];
  const original = structuredClone(data);
  assert.deepEqual(
    suggestWeights(data, target, definition, "2025-01-20", "lb").weights,
    [300, 300, 300],
  );
  assert.deepEqual(data, original);
});

test("recommendations preserve start time ordering and stable ties", () => {
  const data = initialData();
  const definition = data.exercises[0];
  const older = session(definition, "2025-01-06", "100");
  const earlier = session(definition, "2025-01-13", "80");
  earlier.startedAt = "2025-01-13T08:00:00Z";
  const later = session(definition, "2025-01-13", "100");
  for (const history of [
    [older, earlier, later],
    [later, older, earlier],
    [earlier, later, older],
  ]) {
    data.sessions = history;
    const result = suggestWeights(data, target, definition, "2025-01-20", "lb");
    assert.deepEqual(result.weights, [100, 100, 100]);
    assert.match(result.reason, /weights differ/);
  }
  const tied = session(definition, "2025-01-13", "70");
  data.sessions = [tied, later, older];
  assert.deepEqual(
    suggestWeights(data, target, definition, "2025-01-20", "lb").weights,
    [70, 70, 70],
  );
});

test("analytics preserve working-set totals, bodyweight counts and weekly boundaries", () => {
  const data = initialData();
  const definition = data.exercises[0];
  const older = session(definition, "2025-03-09");
  older.exercises[0].sets = [
    completedSet("100", "12"),
    completedSet("100", "15"),
    completedSet("90", "20"),
    completedSet("", "12"),
    completedSet("200", "0"),
    { ...completedSet("300", "12"), status: "skipped" },
    { ...completedSet("300", "12"), status: "pending" },
  ];
  const latest = session({ ...definition, name: "Renamed squat" }, "2025-03-10");
  latest.unit = "kg";
  latest.exercises[0].sets = [completedSet("50", "11"), completedSet("50", "12")];
  const bodyweight = data.exercises.find((exercise) => exercise.equipment === "bodyweight")!;
  latest.exercises.push({
    ...latest.exercises[0],
    exercise: bodyweight,
    target: { ...target, exerciseId: bodyweight.id },
    sets: [completedSet("ignored", "20"), completedSet("", "25")],
  });
  const unfinished = session(definition, "2025-03-08", "300");
  unfinished.status = "in_progress";
  data.sessions = [
    session(definition, "2025-03-11", "300"),
    latest,
    older,
    session(definition, "2025-03-02", "300"),
    unfinished,
  ];
  const original = structuredClone(data);
  const result = summarize(data, 2, "2025-03-10", "lb");
  assert.equal(result.completedWorkouts, 2);
  assert.equal(result.completedSets, 7);
  assert.deepEqual(result.weeks.map((week) => week.totalSets), [3, 4]);
  assert.deepEqual(result.weeks.map((week) => week.completedWorkouts), [1, 1]);
  assert.equal(result.weeks[0].volume, 4500);
  assert.equal(result.weeks[1].volume, convertWeight(50, "kg", "lb") * 23);
  assert.equal(result.volume, result.weeks[0].volume + result.weeks[1].volume);
  assert.equal(result.groups.find((group) => group.group === definition.group)?.sets, 5);
  assert.equal(result.groups.find((group) => group.group === bodyweight.group)?.sets, 2);
  assert.deepEqual(result.lastWorkout, { id: latest.id, title: latest.title, date: latest.date, workingSets: 4 });
  assert.deepEqual(data, original);
});

test("analytics count a planned completion only for the matching date and workout", () => {
  const data = saveTemplate(initialData(), plan, "2025-01-06");
  const definition = data.exercises[0];
  const mismatched = session(definition, "2025-01-13");
  mismatched.templateId = "other-plan";
  data.sessions = [
    session(definition, "2025-01-07"),
    mismatched,
    session(definition, "2025-01-06"),
  ];
  const result = summarize(data, 2, "2025-01-13", "lb");
  assert.equal(result.completedWorkouts, 3);
  assert.equal(result.scheduledWorkouts, 2);
  assert.equal(result.completedScheduledWorkouts, 1);
  assert.equal(result.completionRate, 50);
});
