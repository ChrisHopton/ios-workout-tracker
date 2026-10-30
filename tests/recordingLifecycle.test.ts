import test from "node:test";
import assert from "node:assert/strict";
import { SaveQueue } from "../src/data/saveQueue";
import { initialData } from "../src/domain/library";
import { saveRoutine, nextFlexibleOccurrence, skipNextWorkout } from "../src/domain/routine";
import { canCancelWorkout, cancelWorkout, editSessionSet, finishSession, finishWorkout, inspectSessionRecording, moveWorkoutToToday, startSession } from "../src/domain/sessions";
import { AppData, WorkoutSession, WorkoutTemplate } from "../src/domain/types";

const monday = "2025-01-06";
const tuesday = "2025-01-07";
function plans(data: AppData): WorkoutTemplate[] {
  const exercise = data.exercises.find((item) => item.equipment === "barbell")!;
  return ["A", "B", "C"].map((title) => ({ id: title, title,
    exercises: [{ exerciseId: exercise.id, sets: 3, repMin: 8, repMax: 12 }],
    weekdays: [], recurrence: { kind: "weekly" }, archived: false, updatedAt: "2025-01-01T12:00:00.000Z" }));
}
function flexible() {
  const initial = initialData(); initial.templates = plans(initial);
  return saveRoutine(initial, { mode: "flexible", weekdays: [0, 2, 4], sequence: ["A", "B", "C"], startIndex: 0 }, monday, monday);
}
function record(session: WorkoutSession, weight = "80") {
  return session.exercises[0].sets.reduce((current, _set, index) => editSessionSet(current, 0, index, { weight, reps: "8" }), session);
}

test("new recordings seed weights exactly once without completing reps or sets", () => {
  for (const weight of ["80", "0"]) {
    const data = initialData(); const plan = plans(data)[0];
    const previous = startSession(data, plan, monday).session;
    const finished = finishSession(record(previous, weight), false);
    const history = { ...data, sessions: [finished] };
    const before = structuredClone(history);
    const started = startSession(history, plan, "2025-01-13");
    assert.deepEqual(started.session.exercises[0].sets.map((set) => [set.weight, set.reps, set.status, set.classification]),
      Array.from({ length: 3 }, () => [weight, "", "pending", "working"]));
    assert.equal(started.session.hasFinished, false);
    assert.equal(inspectSessionRecording(started.session).completedSets, 0);
    assert.throws(() => finishSession(started.session, true), /at least one/);
    assert.deepEqual(history, before);
    const cleared = editSessionSet(started.session, 0, 0, { weight: "" });
    const resumedData = { ...started.data, sessions: [...history.sessions, cleared] };
    const resumed = startSession(resumedData, plan, cleared.date);
    assert.equal(resumed.data, resumedData);
    assert.equal(resumed.session, cleared);
    assert.equal(resumed.session.exercises[0].sets[0].weight, "");
  }
});

test("new bodyweight sets keep weight and reps blank, and legacy snapshots are never refilled", () => {
  const data = initialData(); const plan = plans(data)[0];
  plan.exercises[0].exerciseId = data.exercises.find((item) => item.equipment === "bodyweight")!.id;
  const started = startSession(data, plan, monday);
  assert.ok(started.session.exercises[0].sets.every((set) => set.weight === "" && set.reps === "" && set.status === "pending"));
  started.session.exercises[0].suggestion = { algorithmVersion: 1, weights: [99, 99, 99], reason: "Historical snapshot" };
  const resumed = startSession(started.data, plan, monday);
  assert.equal(resumed.session, started.session);
  assert.equal(resumed.session.exercises[0].sets[0].weight, "");
  assert.equal(resumed.session.exercises[0].suggestion.algorithmVersion, 1);
});

test("cancel removes a never-finished draft without consuming routine progress", () => {
  const data = flexible(); const started = startSession(data, data.templates[0], monday, monday);
  const edited = record(started.session);
  const before = { ...started.data, sessions: [edited] };
  const result = cancelWorkout(before, edited.id);
  assert.equal(result.sessions.length, 0);
  assert.equal(result.routineProgress, before.routineProgress);
  assert.equal(nextFlexibleOccurrence(result, tuesday)?.template.id, "A");
  assert.equal(before.sessions.length, 1);
});

test("finished metadata survives edits and prevents cancelling or moving past workouts", () => {
  const data = flexible(); const started = startSession(data, data.templates[0], monday, monday);
  const filled = { ...started.data, sessions: [record(started.session)] };
  const finished = finishWorkout(filled, started.session.id, false, monday);
  assert.equal(finished.sessions[0].hasFinished, true);
  const edited = editSessionSet(finished.sessions[0], 0, 0, { reps: "9" });
  assert.equal(edited.status, "in_progress");
  assert.equal(edited.hasFinished, true);
  assert.equal(canCancelWorkout(edited), false);
  const reopened = { ...finished, sessions: [edited] };
  assert.throws(() => cancelWorkout(reopened, edited.id), /cannot be cancelled/);
  assert.throws(() => moveWorkoutToToday(reopened, edited.id, tuesday), /cannot be moved/);
  const refinished = finishWorkout(reopened, edited.id, false, tuesday);
  assert.equal(refinished.routineProgress.length, 1);
  assert.equal(refinished.routineProgress[0], finished.routineProgress[0]);
});

test("moving a draft preserves its identity, inputs, suggestion and original routine occurrence", () => {
  const data = flexible(); const started = startSession(data, data.templates[0], monday, monday);
  const edited = editSessionSet(started.session, 0, 0, { weight: "0", reps: "8" });
  const before = { ...started.data, sessions: [edited] };
  const moved = moveWorkoutToToday(before, edited.id, tuesday);
  const current = moved.sessions[0];
  assert.equal(current.id, edited.id);
  assert.equal(current.date, tuesday);
  assert.equal(current.exercises, edited.exercises);
  assert.equal(current.routineOccurrence, edited.routineOccurrence);
  assert.equal(current.routineOccurrence?.dueDate, monday);
  assert.equal(moved.routineProgress.length, 0);
  const finished = finishWorkout(moved, current.id, true, tuesday);
  assert.equal(finished.routineProgress[0].resolvedDate, tuesday);
  assert.equal(finished.routineProgress[0].dueDate, monday);
  assert.equal(nextFlexibleOccurrence(finished, tuesday)?.template.id, "B");
  const occupied = { ...before, sessions: [edited, { ...edited, id: "other", date: tuesday, routineOccurrence: null }] };
  assert.throws(() => moveWorkoutToToday(occupied, edited.id, tuesday), /already has a workout/);
  assert.equal(occupied.sessions[0].date, monday);
});

test("only live next-plan recordings link; existing drafts cannot be duplicated or relinked", () => {
  const data = flexible();
  assert.equal(startSession(data, data.templates[0], monday, tuesday).session.routineOccurrence, null);
  assert.equal(startSession(data, data.templates[1], tuesday, tuesday).session.routineOccurrence, null);
  const started = startSession(data, data.templates[0], monday, monday);
  assert.equal(startSession(started.data, data.templates[0], monday, tuesday).session, started.session);
  assert.throws(() => startSession(started.data, data.templates[0], tuesday, tuesday), /Resume or cancel/);
  assert.throws(() => startSession(data, data.templates[0], tuesday, monday), /Future/);
  const early = finishWorkout({ ...started.data, sessions: [record(started.session)] }, started.session.id, false, monday);
  const inconsistent = { ...data, routineProgress: early.routineProgress.map((item) => ({ ...item, resolvedDate: tuesday })) };
  assert.throws(() => startSession(inconsistent, data.templates[0], monday, monday), /already resolved/);
});

test("failed cancel, finish, move and skip-start transactions leave visible state unchanged until retry commits", async () => {
  const data = flexible(); const started = startSession(data, data.templates[0], monday, monday);
  const recorded = { ...started.data, sessions: [record(started.session)] };
  const skipSource = flexible();
  const operations: { source: AppData; change: (data: AppData) => AppData; check: (data: AppData) => void }[] = [
    { source: recorded, change: (data) => cancelWorkout(data, started.session.id),
      check: (data) => { assert.equal(data.sessions.length, 0); assert.equal(data.routineProgress.length, 0); } },
    { source: recorded, change: (data) => finishWorkout(data, started.session.id, false, monday),
      check: (data) => { assert.equal(data.sessions[0].status, "completed"); assert.equal(data.routineProgress.length, 1); } },
    { source: recorded, change: (data) => moveWorkoutToToday(data, started.session.id, tuesday),
      check: (data) => { assert.equal(data.sessions[0].date, tuesday); assert.equal(data.routineProgress.length, 0); } },
    { source: skipSource, change: (data) => {
      const skipped = skipNextWorkout(data, tuesday, tuesday);
      return startSession(skipped, nextFlexibleOccurrence(skipped, tuesday)!.template, tuesday, tuesday).data;
    }, check: (data) => { assert.equal(data.routineProgress.length, 1); assert.equal(data.routineProgress[0].outcome, "skipped");
      assert.equal(data.sessions.length, 1); assert.equal(data.sessions[0].templateId, "B"); assert.equal(data.sessions[0].hasFinished, false); } },
  ];
  for (const operation of operations) {
    let visible = operation.source; let persisted = visible; let fail = true;
    const queue = new SaveQueue<AppData>(async (next) => { if (fail) throw new Error("Save failed"); persisted = next; });
    const save = async () => { const next = operation.change(visible); await queue.replace(next, visible); visible = next; };
    await assert.rejects(save(), /Save failed/);
    assert.equal(visible, operation.source); assert.equal(persisted, operation.source);
    fail = false; await save(); assert.equal(visible, persisted); operation.check(visible);
  }
});
