import test from "node:test";
import assert from "node:assert/strict";
import { snapshot } from "../src/data/snapshot";
import { parseBackup, serializeBackup } from "../src/domain/backup";
import { summarize } from "../src/domain/analytics";
import { initialData } from "../src/domain/library";
import {
  classifySetInput,
  editSessionSet,
  finishSession,
  inspectSessionRecording,
  startSession,
} from "../src/domain/sessions";
import { AppData, Equipment, WorkoutSession, WorkoutTemplate } from "../src/domain/types";

function fixture(equipment: Equipment = "barbell") {
  const data = initialData();
  const exercise = data.exercises.find((item) => item.equipment === equipment)!;
  const template: WorkoutTemplate = {
    id: "recording-plan",
    title: "Recording test",
    exercises: [{ exerciseId: exercise.id, sets: 3, repMin: 8, repMax: 12 }],
    weekdays: [0],
    recurrence: { kind: "weekly" },
    archived: false,
    updatedAt: "2025-01-01T12:00:00.000Z",
  };
  return startSession(data, template, "2025-01-06");
}

function withSession(data: AppData, session: WorkoutSession): AppData {
  return {
    ...data,
    sessions: data.sessions.map((item) => item.id === session.id ? session : item),
  };
}

test("recording distinguishes valid values, missing fields, and invalid entered values", () => {
  const cases = [
    ["", "", "missing"],
    ["100", "", "missing"],
    ["", "8", "missing"],
    ["0", "1", "valid"],
    [".5", "1000", "valid"],
    ["10.", "007", "valid"],
    ["10000", "12", "valid"],
    [".", "8", "invalid"],
    [".", "", "invalid"],
    ["10001", "", "invalid"],
    ["100", "0", "invalid"],
    ["100", "1.5", "invalid"],
    ["100", "1001", "invalid"],
    ["1e2", "8", "invalid"],
  ] as const;
  for (const [weight, reps, expected] of cases) {
    assert.equal(
      classifySetInput({ weight, reps }, "barbell").kind,
      expected,
      JSON.stringify({ weight, reps }),
    );
  }
});

test("bodyweight completion requires valid reps without a load", () => {
  assert.equal(classifySetInput({ weight: "", reps: "12" }, "bodyweight").kind, "valid");
  assert.equal(classifySetInput({ weight: "", reps: "" }, "bodyweight").kind, "missing");
  assert.equal(classifySetInput({ weight: "", reps: "0" }, "bodyweight").kind, "invalid");
  const { session } = fixture("bodyweight");
  const edited = editSessionSet(session, 0, 0, { reps: "12" });
  assert.equal(edited.exercises[0].sets[0].status, "completed");
  const finished = finishSession(edited, true);
  assert.equal(finished.exercises[0].sets[0].weight, "");
  assert.equal(finished.exercises[0].sets[0].reps, "12");
  assert.equal(finished.exercises[0].sets[1].status, "skipped");
});

test("entering either field last completes a set and clearing or invalidating input restores pending", () => {
  for (const first of ["weight", "reps"] as const) {
    const { session } = fixture();
    const firstPatch = first === "weight" ? { weight: "0" } : { reps: "8" };
    const lastPatch = first === "weight" ? { reps: "8" } : { weight: "0" };
    const partial = editSessionSet(session, 0, 0, firstPatch);
    assert.equal(partial.exercises[0].sets[0].status, "pending");
    const completed = editSessionSet(partial, 0, 0, lastPatch);
    assert.equal(completed.exercises[0].sets[0].status, "completed");
    assert.equal(inspectSessionRecording(completed).completedSets, 1);
    for (const patch of [{ weight: "" }, { reps: "" }, { weight: "." }, { reps: "0" }]) {
      const edited = editSessionSet(completed, 0, 0, patch);
      assert.equal(edited.exercises[0].sets[0].status, "pending");
      assert.equal(inspectSessionRecording(edited).completedSets, 0);
    }
    assert.equal(session.exercises[0].sets[0].weight, "");
    assert.equal(session.exercises[0].sets[0].reps, "");
    assert.equal(completed.exercises[0].sets[1], session.exercises[0].sets[1]);
  }
});

test("suggestions remain separate from actual entries until accepted", () => {
  const { session } = fixture();
  session.exercises[0].suggestion.weights = [100, 100, 100];
  const repsOnly = editSessionSet(session, 0, 0, { reps: "10" });
  assert.equal(repsOnly.exercises[0].sets[0].weight, "");
  assert.equal(inspectSessionRecording(repsOnly).completedSets, 0);
  const accepted = editSessionSet(repsOnly, 0, 0, {
    weight: String(repsOnly.exercises[0].suggestion.weights[0]),
  });
  assert.equal(accepted.exercises[0].sets[0].status, "completed");
  assert.deepEqual(accepted.exercises[0].suggestion.weights, [100, 100, 100]);
});

test("valid pending values count toward progress and finish without a checkbox or skip confirmation", () => {
  const { data, session } = fixture();
  session.exercises[0].sets.forEach((set) => {
    set.weight = "100";
    set.reps = "8";
  });
  assert.deepEqual(inspectSessionRecording(session), {
    completedSets: 3, missingSets: 0, error: null,
  });
  assert.equal(summarize(withSession(data, session), 4, session.date, session.unit).completedSets, 0);
  const finished = finishSession(session, false);
  assert.ok(finished.exercises[0].sets.every((set) => set.status === "completed"));
  assert.ok(session.exercises[0].sets.every((set) => set.status === "pending"));
  assert.equal(summarize(withSession(data, finished), 4, session.date, session.unit).completedSets, 3);
});

test("missing sets change to skipped only after explicit finish confirmation and retain draft values", () => {
  const { session } = fixture();
  const recorded = editSessionSet(session, 0, 0, { weight: "100", reps: "8" });
  const partial = editSessionSet(recorded, 0, 1, { weight: "80" });
  assert.equal(inspectSessionRecording(partial).missingSets, 2);
  assert.throws(() => finishSession(partial, false), /confirm skipping/);
  assert.deepEqual(partial.exercises[0].sets.map((set) => set.status), ["completed", "pending", "pending"]);
  const finished = finishSession(partial, true);
  assert.deepEqual(finished.exercises[0].sets.map((set) => set.status), ["completed", "skipped", "skipped"]);
  assert.equal(finished.exercises[0].sets[1].weight, "80");
  assert.equal(finished.exercises[0].sets[1].reps, "");
  assert.equal(partial.status, "in_progress");
});

test("invalid entered values block finishing even when missing sets may be skipped", () => {
  const { session } = fixture();
  const recorded = editSessionSet(session, 0, 0, { weight: "100", reps: "8" });
  for (const patch of [{ weight: "." }, { weight: "10001" }, { reps: "0" }]) {
    const invalid = editSessionSet(recorded, 0, 1, patch);
    assert.match(inspectSessionRecording(invalid).error!, /set 2: Enter/);
    assert.throws(() => finishSession(invalid, false), /set 2: Enter/);
    assert.throws(() => finishSession(invalid, true), /set 2: Enter/);
    assert.equal(invalid.exercises[0].sets[1].status, "pending");
  }
});

test("an all-missing or all-skipped workout cannot be finished", () => {
  const { session } = fixture();
  assert.throws(() => finishSession(session, false), /at least one/);
  assert.throws(() => finishSession(session, true), /at least one/);
  session.exercises[0].sets.forEach((set) => {
    set.status = "skipped";
    set.weight = "100";
    set.reps = "8";
  });
  assert.deepEqual(inspectSessionRecording(session), {
    completedSets: 0, missingSets: 0, error: null,
  });
  assert.throws(() => finishSession(session, true), /at least one/);
});

test("untouched skipped history stays skipped and only input edits reactivate it", () => {
  const { session } = fixture();
  const recorded = editSessionSet(session, 0, 0, { weight: "100", reps: "8" });
  recorded.exercises[0].sets[1] = {
    classification: "working", weight: "80", reps: "8", status: "skipped",
  };
  recorded.exercises[0].sets[2] = {
    classification: "working", weight: ".", reps: "0", status: "skipped",
  };
  const changedType = editSessionSet(recorded, 0, 1, { classification: "warmup" });
  assert.equal(changedType.exercises[0].sets[1].status, "skipped");
  assert.deepEqual(inspectSessionRecording(changedType), {
    completedSets: 1, missingSets: 0, error: null,
  });
  const finished = finishSession(changedType, false);
  assert.equal(finished.exercises[0].sets[1].status, "skipped");
  assert.equal(finished.exercises[0].sets[1].classification, "warmup");
  assert.equal(finished.exercises[0].sets[2].weight, ".");
  const resumed = editSessionSet(finished, 0, 1, { reps: "9" });
  assert.equal(resumed.exercises[0].sets[1].status, "completed");
  const cleared = editSessionSet(finished, 0, 1, { weight: "" });
  assert.equal(cleared.exercises[0].sets[1].status, "pending");
});

test("editing a finished workout reopens it while untouched skipped rows need no new confirmation", () => {
  const { data, session } = fixture();
  const finished = finishSession(editSessionSet(session, 0, 0, { weight: "100", reps: "8" }), true);
  const edited = editSessionSet(finished, 0, 0, { reps: "9" });
  assert.equal(edited.status, "in_progress");
  assert.equal(edited.finishedAt, null);
  assert.equal(edited.exercises[0].sets[0].status, "completed");
  assert.equal(edited.exercises[0].sets[1].status, "skipped");
  assert.equal(summarize(withSession(data, edited), 4, session.date, session.unit).completedSets, 0);
  const refinished = finishSession(edited, false);
  assert.equal(refinished.status, "completed");
  assert.ok(refinished.finishedAt);
  assert.equal(finished.exercises[0].sets[0].reps, "8");
  assert.equal(finishSession(refinished, false).finishedAt, refinished.finishedAt);
});

test("warm-ups complete from actual input but remain excluded from working-set analytics", () => {
  const { data, session } = fixture();
  let edited = editSessionSet(session, 0, 0, { weight: "100", reps: "8" });
  edited = editSessionSet(edited, 0, 1, { weight: "50", reps: "8", classification: "warmup" });
  assert.equal(inspectSessionRecording(edited).completedSets, 2);
  const finished = finishSession(edited, true);
  assert.equal(summarize(withSession(data, finished), 4, session.date, session.unit).completedSets, 1);
});

test("autosaved completion and partial drafts survive validated immutable backup roundtrips", () => {
  const started = fixture();
  let data = snapshot(started.data);
  const original = data.sessions[0];
  for (const patch of [{ weight: "." }, { weight: "0" }, { reps: "8" }, { reps: "" }, { reps: "8" }]) {
    const edited = editSessionSet(data.sessions[0], 0, 0, patch);
    const next = snapshot(withSession(data, edited), data);
    assert.deepEqual(parseBackup(serializeBackup(next)), next);
    assert.equal(next.settings, data.settings);
    assert.equal(next.sessions[0].exercises[0].sets[1], original.exercises[0].sets[1]);
    data = next;
  }
  const finished = snapshot(withSession(data, finishSession(data.sessions[0], true)), data);
  assert.deepEqual(parseBackup(serializeBackup(finished)), finished);
  assert.equal(original.exercises[0].sets[0].weight, "");
  assert.equal(original.exercises[0].sets[0].status, "pending");
});
