import test from "node:test";
import assert from "node:assert/strict";
import { initialData } from "../src/domain/library";
import { validateData } from "../src/domain/backup";
import {
  archiveTemplate,
  nextOccurrence,
  recurrenceLabel,
  saveTemplate,
  scheduleForDate,
  templateOccursOn,
} from "../src/domain/schedule";
import { WorkoutRecurrence, WorkoutTemplate } from "../src/domain/types";

const monday = "2025-01-06";
function plan(id: string, weekdays = [0], recurrence: WorkoutRecurrence = { kind: "weekly" }): WorkoutTemplate {
  return {
    id, title: id, weekdays, recurrence, archived: false,
    updatedAt: "2025-01-01T12:00:00.000Z",
    exercises: [{ exerciseId: "exercise-barbell-squat", sets: 3, repMin: 8, repMax: 12 }],
  };
}

test("weekly plans explicitly occupy both weeks and unscheduled plans remain available", () => {
  let data = saveTemplate(initialData(), plan("weekly"), monday);
  data = saveTemplate(data, plan("manual", []), monday);
  assert.deepEqual(data.scheduleRevisions[0].slots[0].workoutIds, ["weekly", "weekly"]);
  assert.deepEqual(data.scheduleRevisions[0].slots[1].workoutIds, [null, null]);
  for (const date of ["2025-01-06", "2025-01-13", "2025-01-20", "2026-01-05"])
    assert.equal(scheduleForDate(data, date)?.id, "weekly");
  assert.equal(nextOccurrence(data, "manual", monday), null);
  assert.equal(recurrenceLabel(data.templates[0]), "Weekly");
  validateData(data);
});

test("a lone fortnightly plan retains rest weeks and its anchor through edits", () => {
  const workout = plan("fortnightly", [2], { kind: "biweekly", anchorMonday: monday });
  const before = saveTemplate(initialData(), workout, "2025-01-08");
  const historical = before.scheduleRevisions[0];
  const data = saveTemplate(before, { ...workout, title: "Renamed", exercises: [{ ...workout.exercises[0], sets: 4 }] }, "2025-01-09");
  assert.equal(scheduleForDate(data, "2025-01-08")?.title, "fortnightly");
  assert.equal(scheduleForDate(data, "2025-01-15"), null);
  assert.equal(scheduleForDate(data, "2025-01-22")?.title, "Renamed");
  assert.equal(scheduleForDate(data, "2025-02-05")?.exercises[0].sets, 4);
  assert.equal(data.scheduleRevisions[0], historical);
  assert.deepEqual(data.templates[0].recurrence, workout.recurrence);
  assert.equal(nextOccurrence(data, workout.id, "2025-01-09"), "2025-01-22");
  assert.equal(recurrenceLabel(workout), "Every 2 weeks");
  validateData(data);
});

test("only opposite fortnightly phases can share a weekday", () => {
  const a = plan("a", [0], { kind: "biweekly", anchorMonday: monday });
  const b = plan("b", [0], { kind: "biweekly", anchorMonday: "2025-01-13" });
  let data = saveTemplate(initialData(), a, monday);
  const original = JSON.stringify(data);
  assert.throws(() => saveTemplate(data, plan("weekly"), monday), /Mon.*conflict.*a.*weekly/);
  assert.throws(() => saveTemplate(data, { ...b, recurrence: { kind: "biweekly", anchorMonday: "2024-12-23" } }, monday), /conflict/);
  assert.equal(JSON.stringify(data), original);
  data = saveTemplate(data, b, monday);
  assert.equal(scheduleForDate(data, monday)?.id, "a");
  assert.equal(scheduleForDate(data, "2025-01-13")?.id, "b");
  assert.equal(scheduleForDate(data, "2025-01-20")?.id, "a");
  assert.throws(() => saveTemplate(data, plan("third"), monday), /conflict/);
  validateData(data);
});

test("archiving one fortnightly plan does not accelerate the other", () => {
  let data = saveTemplate(initialData(), plan("a", [0], { kind: "biweekly", anchorMonday: monday }), monday);
  data = saveTemplate(data, plan("b", [0], { kind: "biweekly", anchorMonday: "2025-01-13" }), monday);
  const history = data.scheduleRevisions[0];
  data = archiveTemplate(data, "b", "2025-01-14");
  assert.equal(data.scheduleRevisions[0], history);
  assert.equal(scheduleForDate(data, "2025-01-13")?.id, "b");
  assert.equal(scheduleForDate(data, "2025-01-20")?.id, "a");
  assert.equal(scheduleForDate(data, "2025-01-27"), null);
  assert.equal(scheduleForDate(data, "2025-02-03")?.id, "a");
  validateData(data);
});

test("legacy title and target edits preserve mixed weekday cycles", () => {
  const legacy = plan("legacy", [0, 2], {
    kind: "legacy", anchorMonday: monday, weekdaysA: [0, 2], weekdaysB: [0],
  });
  const before = saveTemplate(initialData(), legacy, monday);
  const edited = { ...legacy, title: "Edited", exercises: [{ ...legacy.exercises[0], repMax: 15 }] };
  const data = saveTemplate(before, edited, "2025-01-09");
  assert.deepEqual(data.templates[0].recurrence, legacy.recurrence);
  for (const date of ["2025-01-13", "2025-01-20", "2025-01-22"])
    assert.equal(scheduleForDate(data, date)?.title, "Edited");
  assert.equal(scheduleForDate(data, "2025-01-15"), null);
  assert.equal(scheduleForDate(data, "2025-01-08")?.title, "legacy");
  assert.equal(recurrenceLabel(legacy), "Existing custom schedule");
  assert.throws(() => saveTemplate(data, { ...edited, weekdays: [0, 2, 4] }, "2025-01-09"), /recurrence/);
  const explicit = saveTemplate(data, { ...edited, recurrence: { kind: "weekly" } }, "2025-01-09");
  assert.equal(scheduleForDate(explicit, "2025-01-15")?.id, "legacy");
  validateData(data);
  validateData(explicit);
});

test("recurrence stays calendar anchored across DST, year boundaries and earlier dates", () => {
  const workout = plan("calendar", [0], { kind: "biweekly", anchorMonday: "2024-12-30" });
  assert.equal(templateOccursOn(workout, "2024-12-16"), true);
  assert.equal(templateOccursOn(workout, "2024-12-23"), false);
  assert.equal(templateOccursOn(workout, "2025-01-06"), false);
  assert.equal(templateOccursOn(workout, "2025-01-13"), true);
  assert.equal(templateOccursOn(workout, "2025-03-10"), true);
  assert.equal(templateOccursOn(workout, "2025-03-17"), false);
  const data = saveTemplate(initialData(), workout, "2024-12-30");
  assert.equal(nextOccurrence(data, workout.id, "2025-01-06"), "2025-01-13");
  assert.throws(() => saveTemplate(data, { ...workout, recurrence: { kind: "biweekly", anchorMonday: "2025-01-07" } }, monday), /Monday/);
});

test("next occurrence finds a later revision and repeated same-day saves keep one revision", () => {
  let data = saveTemplate(initialData(), plan("a", []), monday);
  data = saveTemplate(data, plan("a", [0]), "2026-01-05");
  data = saveTemplate(data, { ...data.templates[0], title: "Final title" }, "2026-01-05");
  assert.equal(data.scheduleRevisions.length, 2);
  assert.equal(nextOccurrence(data, "a", monday), "2026-01-05");
  assert.equal(scheduleForDate(data, "2025-12-29"), null);
  assert.equal(scheduleForDate(data, "2026-01-05")?.title, "Final title");
  assert.throws(() => saveTemplate(data, plan("a", []), "2025-12-31"), /cannot precede/);
  validateData(data);
});
