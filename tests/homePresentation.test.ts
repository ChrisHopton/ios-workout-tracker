import test from "node:test";
import assert from "node:assert/strict";
import { homeDayPresentation } from "../src/components/homePresentation";
import { initialData } from "../src/domain/library";
import { saveRoutine } from "../src/domain/routine";
import { saveTemplate } from "../src/domain/schedule";
import { editSessionSet, finishSession, finishWorkout, startSession } from "../src/domain/sessions";
import { WorkoutTemplate } from "../src/domain/types";

const monday = "2025-01-06";
const workout: WorkoutTemplate = {
  id: "strength",
  title: "Strength",
  weekdays: [0],
  recurrence: { kind: "weekly" },
  archived: false,
  updatedAt: "2025-01-01T12:00:00.000Z",
  exercises: [{ exerciseId: "exercise-barbell-squat", sets: 3, repMin: 8, repMax: 12 }],
};

function scheduled() {
  return saveTemplate(initialData(), workout, monday);
}

test("Home offers Start for scheduled days and Choose for rest days, including historical dates", () => {
  const data = scheduled();
  for (const currentDate of [monday, "2025-02-01"]) {
    const day = homeDayPresentation(data, monday, currentDate);
    assert.equal(day.actionLabel, "Start workout");
    assert.equal(day.title, "Strength");
    assert.equal(day.exerciseCount, 1);
    assert.equal(day.setCount, 3);
  }
  assert.equal(homeDayPresentation(data, "2025-01-07", "2025-01-07").actionLabel, "Choose workout");
  assert.equal(homeDayPresentation(data, "2025-01-07", "2025-02-01").actionLabel, "Choose workout");
  assert.equal(homeDayPresentation(initialData(), monday, monday).actionLabel, "Choose workout");
});

test("Home resumes the recorded snapshot even after its plan changes", () => {
  let data = startSession(scheduled(), workout, monday).data;
  const recorded = data.sessions[0];
  recorded.exercises[0].sets[0] = {
    classification: "working", weight: "100", reps: "8", status: "completed",
  };
  recorded.exercises[0].sets[1].status = "skipped";
  data = saveTemplate(data, { ...workout, title: "New name", exercises: [{ ...workout.exercises[0], sets: 5 }] }, monday);
  const day = homeDayPresentation(data, monday, monday);
  assert.equal(day.actionLabel, "Resume workout");
  assert.equal(day.session?.id, recorded.id);
  assert.equal(day.title, "Strength");
  assert.equal(day.setCount, 3);
  assert.equal(day.completedSets, 1);
});

test("Home offers View for completed sessions, including unscheduled workouts", () => {
  const data = startSession(initialData(), workout, monday).data;
  data.sessions[0].status = "completed";
  const day = homeDayPresentation(data, monday, monday);
  assert.equal(day.actionLabel, "View workout");
  assert.equal(day.template, null);
  assert.equal(day.title, workout.title);
});

test("Home never offers a recording action for future scheduled, rest, or imported session dates", () => {
  const data = scheduled();
  for (const date of [monday, "2025-01-07"]) {
    const day = homeDayPresentation(data, date, "2025-01-05");
    assert.equal(day.isFuture, true);
    assert.equal(day.actionLabel, null);
  }
  const recorded = startSession(data, workout, monday).data;
  assert.equal(homeDayPresentation(recorded, monday, "2025-01-05").actionLabel, null);
  recorded.sessions[0].status = "completed";
  assert.equal(homeDayPresentation(recorded, monday, "2025-01-05").actionLabel, null);
});

test("Home previews the schedule revision for the selected date", () => {
  const data = saveTemplate(scheduled(), { ...workout, title: "Updated workout" }, "2025-01-13");
  assert.equal(homeDayPresentation(data, monday, "2025-01-20").title, "Strength");
  assert.equal(homeDayPresentation(data, "2025-01-13", "2025-01-20").title, "Updated workout");
});

test("Home counts valid pending drafts without counting skipped or invalid input", () => {
  const data = startSession(scheduled(), workout, monday).data;
  const sets = data.sessions[0].exercises[0].sets;
  sets[0] = { classification: "working", weight: "100", reps: "8", status: "pending" };
  sets[1] = { classification: "working", weight: "100", reps: "8", status: "skipped" };
  sets[2] = { classification: "working", weight: ".", reps: "8", status: "pending" };
  const day = homeDayPresentation(data, monday, monday);
  assert.equal(day.completedSets, 1);
  assert.equal(day.actionLabel, "Resume workout");
  assert.equal(sets[0].status, "pending", "presenting legacy progress must not mutate saved history");
});

test("Home progress follows edits to a resumed workout and distinguishes zero from blank", () => {
  const started = startSession(scheduled(), workout, monday);
  const completed = editSessionSet(started.session, 0, 0, { weight: "0", reps: "8" });
  const finished = finishSession(completed, true);
  let data = { ...started.data, sessions: [finished] };
  assert.equal(homeDayPresentation(data, monday, monday).actionLabel, "View workout");
  assert.equal(homeDayPresentation(data, monday, monday).completedSets, 1);
  data = { ...data, sessions: [editSessionSet(finished, 0, 0, { weight: "" })] };
  assert.equal(homeDayPresentation(data, monday, monday).actionLabel, "Resume workout");
  assert.equal(homeDayPresentation(data, monday, monday).completedSets, 0);
  data = { ...data, sessions: [editSessionSet(data.sessions[0], 0, 0, { weight: "0" })] };
  assert.equal(homeDayPresentation(data, monday, monday).completedSets, 1);
  assert.equal(homeDayPresentation(data, monday, monday).actionLabel, "Resume workout");
});

test("Home retains Rest day and Choose workout while an overdue flexible workout awaits the next training day", () => {
  const data = flexibleHome();
  const before = structuredClone(data);
  const day = homeDayPresentation(data, "2025-01-07", "2025-01-07");
  assert.equal(day.title, "Rest day"); assert.equal(day.actionLabel, "Choose workout");
  assert.equal(day.template, null); assert.equal(day.missed, null); assert.equal(day.continueWith, null);
  assert.equal(day.upcoming?.template.id, "A"); assert.equal(day.upcoming?.date, "2025-01-08");
  assert.deepEqual(data, before);
  const chosen = startSession(data, data.templates[0], "2025-01-07", "2025-01-07");
  assert.equal(chosen.session.routineOccurrence?.templateId, "A", "choosing the next plan on a rest day still links it");
  const recorded = editSessionSet(chosen.session, 0, 0, { weight: "80", reps: "8" });
  const finished = finishWorkout({ ...chosen.data, sessions: [recorded] }, recorded.id, true, "2025-01-07");
  assert.equal(finished.routineProgress.length, 1);
  assert.equal(homeDayPresentation(finished, "2025-01-07", "2025-01-07").upcoming?.template.id, "B");
});

test("Home offers make-up and skip/continue on a selected training day without advancing during presentation", () => {
  const data = flexibleHome();
  const before = structuredClone(data);
  const day = homeDayPresentation(data, "2025-01-08", "2025-01-08");
  assert.equal(day.title, "A"); assert.equal(day.actionLabel, "Make up A");
  assert.equal(day.continueWith?.title, "B"); assert.equal(day.missed?.occurrence.dueDate, monday);
  assert.deepEqual(data, before);
});

test("Home resumes an earlier linked draft instead of creating a second make-up", () => {
  const data = flexibleHome();
  const started = startSession(data, data.templates[0], monday, monday);
  const day = homeDayPresentation(started.data, "2025-01-07", "2025-01-07");
  assert.equal(day.session?.id, started.session.id);
  assert.equal(day.isCarryover, true); assert.equal(day.canCancel, true);
  assert.equal(day.actionLabel, "Resume workout"); assert.equal(day.missed, null);
  assert.equal(day.unfinished.length, 0);
});

test("Home surfaces other unfinished days and retains historical edit cancellation protection", () => {
  const started = startSession(scheduled(), workout, monday);
  const day = homeDayPresentation(started.data, "2025-01-08", "2025-01-08");
  assert.equal(day.unfinished[0].id, started.session.id);
  const finished = finishSession(editSessionSet(started.session, 0, 0, { weight: "100", reps: "8" }), true);
  const edited = editSessionSet(finished, 0, 0, { reps: "9" });
  const historical = homeDayPresentation({ ...started.data, sessions: [edited] }, monday, "2025-01-08");
  assert.equal(historical.actionLabel, "Resume workout"); assert.equal(historical.canCancel, false);
});

function flexibleHome() {
  const data = initialData();
  data.templates = ["A", "B", "C"].map((title) => ({ ...workout, id: title, title, weekdays: [] }));
  return saveRoutine(data, { mode: "flexible", weekdays: [0, 2, 4], sequence: ["A", "B", "C"], startIndex: 0 }, monday, monday);
}
