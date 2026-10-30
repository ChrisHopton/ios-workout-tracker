import test from "node:test";
import assert from "node:assert/strict";
import { initialData } from "../src/domain/library";
import { saveTemplate, scheduleForDate } from "../src/domain/schedule";
import { nextFlexibleOccurrence, saveRoutine, skipNextWorkout } from "../src/domain/routine";
import { cancelWorkout, editSessionSet, finishWorkout, moveWorkoutToToday, startSession } from "../src/domain/sessions";
import { validateData } from "../src/domain/backup";
import { summarize } from "../src/domain/analytics";
import { homeDayPresentation } from "../src/components/homePresentation";
import { AppData, WorkoutTemplate } from "../src/domain/types";

const start = "2025-01-06";
const boundary = "2025-01-13";
const config = { mode: "flexible" as const, weekdays: [0, 2, 4], sequence: ["A", "B", "C"], startIndex: 0 };

function fixture(startIndex = 0) {
  let data = initialData();
  for (const [index, id] of ["A", "B", "C", "Extra"].entries()) {
    const template: WorkoutTemplate = {
      id, title: id, weekdays: index < 3 ? [index * 2] : [], recurrence: { kind: "weekly" },
      archived: false, updatedAt: start + "T12:00:00.000Z",
      exercises: [{ exerciseId: data.exercises[0].id, sets: 1, repMin: 8, repMax: 12 }],
    };
    data = saveTemplate(data, template, start);
  }
  return saveRoutine(data, { ...config, startIndex }, start, start);
}

function finishDraft(data: AppData, id: string, currentDate: string) {
  const session = data.sessions.find((item) => item.id === id)!;
  const entered = editSessionSet(session, 0, 0, { weight: "100", reps: "10" });
  return finishWorkout({ ...data, sessions: data.sessions.map((item) => item.id === id ? entered : item) },
    id, false, currentDate);
}

function complete(data: AppData, templateId: string, date: string) {
  const started = startSession(data, data.templates.find((item) => item.id === templateId)!, date, date);
  return finishDraft(started.data, started.session.id, date);
}

function crossingDraft() {
  const future = saveRoutine(fixture(), { ...config, startIndex: 1 }, boundary, start);
  return startSession(future, future.templates[0], "2025-01-10", "2025-01-10");
}

test("a linked rest-day make-up counts on its actual date; unrelated extra workouts do not", () => {
  let data = complete(fixture(), "A", "2025-01-07");
  assert.equal(scheduleForDate(data, start, "2025-01-07")?.id, "A", "the missed Monday stays planned");
  assert.equal(scheduleForDate(data, "2025-01-07", "2025-01-07")?.id, "A");
  let summary = summarize(data, 1, "2025-01-07", "lb");
  assert.equal(summary.scheduledWorkouts, 2);
  assert.equal(summary.completedScheduledWorkouts, 1);
  assert.equal(summary.completionRate, 50);
  data = complete(data, "Extra", "2025-01-09");
  assert.equal(scheduleForDate(data, "2025-01-09", "2025-01-09"), null);
  summary = summarize(data, 1, "2025-01-09", "lb");
  assert.equal(summary.completedWorkouts, 2);
  assert.equal(summary.completedScheduledWorkouts, 1);
  validateData(data);
});

test("Home holds the older linked draft across a future routine boundary and another linked start is blocked", () => {
  const started = crossingDraft();
  const day = homeDayPresentation(started.data, boundary, boundary);
  assert.equal(day.title, "A");
  assert.equal(day.actionLabel, "Resume workout");
  assert.equal(day.session?.id, started.session.id);
  assert.equal(day.isCarryover, true);
  assert.equal(day.canCancel, true);
  assert.equal(day.missed, null);
  assert.equal(nextFlexibleOccurrence(started.data, boundary)?.template.id, "B");
  assert.throws(() => startSession(started.data, started.data.templates[1], boundary, boundary), /Resume or cancel/);
  assert.throws(() => skipNextWorkout(started.data, boundary, boundary), /Resume or cancel/);
  const cancelled = cancelWorkout(started.data, started.session.id);
  assert.equal(cancelled.routineProgress.length, 0);
  const replacement = startSession(cancelled, cancelled.templates[1], boundary, boundary);
  assert.equal(replacement.session.routineOccurrence?.dueDate, boundary);
  validateData(replacement.data);
});

test("finishing the older draft on the new routine's first day defers only its first occurrence", () => {
  const started = crossingDraft();
  const oldIdentity = started.session.routineOccurrence;
  const moved = moveWorkoutToToday(started.data, started.session.id, boundary);
  let data = finishDraft(moved, started.session.id, boundary);
  assert.deepEqual(data.sessions[0].routineOccurrence, oldIdentity);
  assert.equal(scheduleForDate(data, boundary, boundary)?.id, "A");
  assert.equal(nextFlexibleOccurrence(data, "2025-01-14")?.template.id, "B");
  assert.equal(nextFlexibleOccurrence(data, "2025-01-14")?.occurrence.dueDate, "2025-01-15");
  assert.equal(nextFlexibleOccurrence(data, "2025-01-14")?.overdue, false);
  const day = homeDayPresentation(data, "2025-01-14", "2025-01-14");
  assert.equal(day.missed, null);
  assert.equal(day.upcoming?.date, "2025-01-15");
  assert.equal(day.upcoming?.template.id, "B");
  assert.equal(summarize(data, 1, boundary, "lb").completedScheduledWorkouts, 1);
  validateData(data);

  const next = startSession(data, data.templates[1], "2025-01-15", "2025-01-15");
  assert.equal(next.session.routineOccurrence?.dueDate, "2025-01-15");
  validateData(next.data);
  const invalid = { ...next.data, sessions: next.data.sessions.map((session) => session.id === next.session.id
    ? { ...session, routineOccurrence: { ...session.routineOccurrence!, dueDate: boundary } } : session) };
  assert.throws(() => validateData(invalid), /next unresolved occurrence/);
  const cancelled = cancelWorkout(next.data, next.session.id);
  assert.equal(nextFlexibleOccurrence(cancelled, "2025-01-15")?.occurrence.dueDate, "2025-01-15");

  data = finishDraft(next.data, next.session.id, "2025-01-15");
  assert.equal(nextFlexibleOccurrence(data, "2025-01-15")?.template.id, "C");
  assert.equal(nextFlexibleOccurrence(data, "2025-01-15")?.occurrence.dueDate, "2025-01-17");
  assert.equal(scheduleForDate(data, boundary, "2025-01-17")?.id, "A");
  validateData(data);
});

test("keeping the older draft's original date leaves the new routine's first day available", () => {
  const started = crossingDraft();
  const data = finishDraft(started.data, started.session.id, boundary);
  assert.equal(data.sessions[0].date, "2025-01-10");
  assert.equal(nextFlexibleOccurrence(data, boundary)?.occurrence.dueDate, boundary);
  assert.equal(scheduleForDate(data, boundary, boundary)?.id, "B");
  validateData(data);
});

test("a linked draft still resumes and counts correctly after a future switch to fixed scheduling", () => {
  const future = saveRoutine(fixture(1), { mode: "fixed" }, boundary, start);
  const started = startSession(future, future.templates[1], "2025-01-10", "2025-01-10");
  assert.equal(homeDayPresentation(started.data, boundary, boundary).title, "B");
  const moved = moveWorkoutToToday(started.data, started.session.id, boundary);
  const data = finishDraft(moved, started.session.id, boundary);
  assert.equal(scheduleForDate(data, boundary, boundary)?.id, "B", "actual linked completion wins over fixed A");
  assert.equal(summarize(data, 1, boundary, "lb").completedScheduledWorkouts, 1);
  validateData(data);
});

test("editing an already finished older workout does not hold the next occurrence", () => {
  let data = complete(fixture(), "A", start);
  data = { ...data, sessions: [editSessionSet(data.sessions[0], 0, 0, { reps: "12" })] };
  assert.equal(data.sessions[0].hasFinished, true);
  assert.equal(homeDayPresentation(data, "2025-01-08", "2025-01-08").session, undefined);
  const next = startSession(data, data.templates[1], "2025-01-08", "2025-01-08");
  assert.equal(next.session.routineOccurrence?.ordinal, 1);
  validateData(next.data);
});

test("a carried draft finished after the boundary delays the new routine without retroactively shifting old progress", () => {
  const started = crossingDraft();
  const moved = moveWorkoutToToday(started.data, started.session.id, "2025-01-14");
  let data = finishDraft(moved, started.session.id, "2025-01-14");
  assert.equal(scheduleForDate(data, "2025-01-14", "2025-01-14")?.id, "A");
  assert.equal(nextFlexibleOccurrence(data, "2025-01-14")?.template.id, "B");
  assert.equal(nextFlexibleOccurrence(data, "2025-01-14")?.occurrence.dueDate, "2025-01-15");
  assert.equal(nextFlexibleOccurrence(data, "2025-01-14")?.overdue, false);
  assert.equal(homeDayPresentation(data, "2025-01-14", "2025-01-14").missed, null);
  validateData(data);

  data = complete(data, "B", "2025-01-15");
  const firstDue = data.routineProgress[1].dueDate;
  assert.equal(firstDue, "2025-01-15");
  assert.equal(data.routineProgress[0].dueDate, start, "later routine activity cannot shift older due dates");
  const newer = saveRoutine(data, { ...config, startIndex: 2 }, "2025-01-20", "2025-01-16");
  data = complete(newer, "C", "2025-01-20");
  assert.equal(data.routineProgress[1].dueDate, firstDue);
  validateData(data);
});
