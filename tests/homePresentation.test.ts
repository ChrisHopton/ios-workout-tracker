import test from "node:test";
import assert from "node:assert/strict";
import { homeDayPresentation } from "../src/components/homePresentation";
import { initialData } from "../src/domain/library";
import { saveTemplate } from "../src/domain/schedule";
import { startSession } from "../src/domain/sessions";
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
  recorded.exercises[0].sets[0].status = "completed";
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
