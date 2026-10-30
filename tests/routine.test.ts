import test from "node:test";
import assert from "node:assert/strict";
import { initialData } from "../src/domain/library";
import { saveTemplate, scheduleForDate, archiveTemplate, nextOccurrence, swapWeekday } from "../src/domain/schedule";
import { nextFlexibleOccurrence, saveRoutine, seedFlexibleRoutine, skipNextWorkout, upcomingWorkout, routineAt } from "../src/domain/routine";
import { cancelWorkout, editSessionSet, finishWorkout, moveWorkoutToToday, startSession } from "../src/domain/sessions";
import { validateData } from "../src/domain/backup";
import { summarize } from "../src/domain/analytics";
import { AppData, WorkoutTemplate } from "../src/domain/types";

function fixture(start = "2025-01-06") {
  let data = initialData();
  for (const [index, id] of ["A", "B", "C", "D", "E", "F"].entries()) {
    const plan: WorkoutTemplate = { id, title: id, archived: false, updatedAt: "2025-01-01T12:00:00.000Z",
      weekdays: [index % 3], recurrence: { kind: "biweekly", anchorMonday: index < 3 ? "2025-01-06" : "2025-01-13" },
      exercises: [{ exerciseId: data.exercises[0].id, sets: 1, repMin: 8, repMax: 12 }] };
    data = saveTemplate(data, plan, start);
  }
  return data;
}
function flexible(start = "2025-01-06", weekdays = [0, 1, 2]) {
  return saveRoutine(fixture(start), { mode: "flexible", sequence: ["A", "B", "C", "D", "E", "F"], weekdays, startIndex: 0 }, start, start);
}
function complete(data: AppData, date: string, id = nextFlexibleOccurrence(data, date)!.template.id): AppData {
  const plan = data.templates.find((item) => item.id === id)!;
  const started = startSession(data, plan, date, date);
  const entered = editSessionSet(started.session, 0, 0, { weight: "100", reps: "10" });
  return finishWorkout({ ...started.data, sessions: started.data.sessions.map((session) => session.id === entered.id ? entered : session) }, entered.id, false, date);
}

test("fixed mode stays unchanged and flexible seed follows two chronological weeks", () => {
  const data = fixture();
  assert.equal(routineAt(data, "2025-01-06").mode, "fixed");
  assert.deepEqual(seedFlexibleRoutine(data, "2025-01-06"), { sequence: ["A", "B", "C", "D", "E", "F"], weekdays: [0, 1, 2], startIndex: 0 });
  assert.equal(scheduleForDate(data, "2025-01-13", "2025-01-13")?.id, "D");
  const weekly = saveTemplate(initialData(), { ...data.templates[0], recurrence: { kind: "weekly" } }, "2025-01-06");
  assert.deepEqual(seedFlexibleRoutine(weekly, "2025-01-06").sequence, ["A", "A"]);
});

test("making up missed C uses Monday then shifts D/E/F through training slots", () => {
  let data = complete(complete(flexible(), "2025-01-06"), "2025-01-07");
  const next = nextFlexibleOccurrence(data, "2025-01-13")!;
  assert.equal(next.template.id, "C");
  assert.equal(next.occurrence.dueDate, "2025-01-08");
  assert.equal(next.overdue, true);
  assert.equal(scheduleForDate(data, "2025-01-13", "2025-01-13")?.id, "C");
  data = complete(data, "2025-01-13");
  assert.equal(scheduleForDate(data, "2025-01-14", "2025-01-13")?.id, "D");
  assert.equal(scheduleForDate(data, "2025-01-15", "2025-01-13")?.id, "E");
  assert.equal(scheduleForDate(data, "2025-01-20", "2025-01-13")?.id, "F");
  assert.equal(scheduleForDate(data, "2025-01-16", "2025-01-13"), null);
  validateData(data);
});

test("skip C then start D is one date, and re-finishing D never advances again", () => {
  let data = complete(complete(flexible(), "2025-01-06"), "2025-01-07");
  data = skipNextWorkout(data, "2025-01-13", "2025-01-13");
  assert.equal(nextFlexibleOccurrence(data, "2025-01-13")?.template.id, "D");
  data = complete(data, "2025-01-13");
  const session = data.sessions.at(-1)!;
  assert.equal(data.routineProgress.length, 4);
  const reopened = editSessionSet(session, 0, 0, { reps: "12" });
  assert.equal(reopened.hasFinished, true);
  data = finishWorkout({ ...data, sessions: data.sessions.map((item) => item.id === session.id ? reopened : item) }, session.id, false, "2025-01-14");
  assert.equal(data.routineProgress.length, 4);
  assert.equal(nextFlexibleOccurrence(data, "2025-01-14")?.template.id, "E");
  assert.throws(() => cancelWorkout(data, session.id), /cannot be cancelled/);
  validateData(data);
});

test("long breaks keep one pending occurrence without creating backlog records", () => {
  const data = flexible();
  const january = nextFlexibleOccurrence(data, "2025-01-06")!;
  const december = nextFlexibleOccurrence(data, "2025-12-29")!;
  assert.deepEqual(january.occurrence, december.occurrence);
  assert.equal(data.routineProgress.length, 0);
  assert.equal(scheduleForDate(data, "2025-12-30", "2025-12-29")?.id, "B");
});

test("rest-day next workout advances while unrelated extra workouts do not", () => {
  let data = flexible();
  assert.equal(scheduleForDate(data, "2025-01-09", "2025-01-09"), null);
  data = complete(data, "2025-01-09", "A");
  assert.equal(nextFlexibleOccurrence(data, "2025-01-09")?.template.id, "B");
  assert.deepEqual(upcomingWorkout(data, "2025-01-09", "2025-01-09")?.date, "2025-01-13");
  data = complete(data, "2025-01-10", "E");
  assert.equal(data.sessions.at(-1)?.routineOccurrence, null);
  assert.equal(data.routineProgress.length, 1);
  assert.equal(nextFlexibleOccurrence(data, "2025-01-10")?.template.id, "B");
  validateData(data);
});

test("cancel keeps the same occurrence, and resume can keep the original day or move intact", () => {
  const data = flexible("2025-01-06", [0, 2, 4]);
  const started = startSession(data, data.templates[0], "2025-01-10", "2025-01-10");
  assert.throws(() => startSession(started.data, data.templates[0], "2025-01-13", "2025-01-13"), /Resume or cancel/);
  const moved = moveWorkoutToToday(started.data, started.session.id, "2025-01-13");
  assert.equal(moved.sessions[0].id, started.session.id);
  assert.deepEqual(moved.sessions[0].exercises, started.session.exercises);
  assert.deepEqual(moved.sessions[0].routineOccurrence, started.session.routineOccurrence);
  const cancelled = cancelWorkout(moved, started.session.id);
  assert.equal(cancelled.sessions.length, 0);
  assert.deepEqual(nextFlexibleOccurrence(cancelled, "2025-01-13")?.occurrence, started.session.routineOccurrence);
  const entered = editSessionSet(started.session, 0, 0, { weight: "100", reps: "10" });
  const originalDate = finishWorkout({ ...started.data, sessions: [entered] }, entered.id, false, "2025-01-13");
  assert.equal(scheduleForDate(originalDate, "2025-01-13", "2025-01-13")?.id, "B");
  const movedDate = finishWorkout({ ...moved, sessions: [{ ...entered, date: "2025-01-13" }] }, entered.id, false, "2025-01-13");
  assert.equal(scheduleForDate(movedDate, "2025-01-15", "2025-01-13")?.id, "B");
  validateData(originalDate); validateData(movedDate);
});

test("configuration changes require resolving drafts; content edits keep identity and pending occurrence", () => {
  const data = flexible();
  const started = startSession(data, data.templates[0], "2025-01-06", "2025-01-06");
  assert.throws(() => saveRoutine(started.data, { mode: "fixed" }, "2025-01-07", "2025-01-06"), /Finish or cancel/);
  const edited = saveTemplate(started.data, { ...data.templates[0], title: "A revised" }, "2025-01-07");
  assert.equal(nextFlexibleOccurrence(edited, "2025-01-07")?.template.title, "A revised");
  assert.deepEqual(nextFlexibleOccurrence(edited, "2025-01-07")?.occurrence, started.session.routineOccurrence);
  assert.throws(() => archiveTemplate(data, "A", "2025-01-07"), /Remove this workout/);
  const replacement = { mode: "flexible" as const, sequence: ["B", "C"], weekdays: [0, 1, 2], startIndex: 0 };
  assert.throws(() => saveRoutine(data, replacement, "2025-01-07", "2025-01-06"), /replacement/);
  const changed = saveRoutine(data, { ...replacement, replacementConfirmed: true }, "2025-01-07", "2025-01-06");
  assert.equal(nextFlexibleOccurrence(changed, "2025-01-07")?.template.id, "B");
  assert.notEqual(nextFlexibleOccurrence(changed, "2025-01-07")?.occurrence.routineId, started.session.routineOccurrence?.routineId);
  validateData(edited); validateData(changed);
});

test("routine edits retain historical assignments and cannot orphan same-day progress", () => {
  let data = complete(flexible(), "2025-01-06");
  assert.throws(() => saveRoutine(data, { mode: "fixed" }, "2025-01-06", "2025-01-06"), /already has recorded progress/);
  data = saveRoutine(data, { mode: "fixed" }, "2025-01-13", "2025-01-06");
  assert.equal(scheduleForDate(data, "2025-01-06", "2025-01-14")?.id, "A");
  assert.equal(scheduleForDate(data, "2025-01-13", "2025-01-14")?.id, "D");
  validateData(data);
});

test("future previews cross year and daylight-saving boundaries using local calendar days", () => {
  let data = flexible("2024-12-30", [0, 2, 4]);
  assert.equal(scheduleForDate(data, "2025-01-01", "2024-12-30")?.id, "B");
  assert.equal(scheduleForDate(data, "2025-01-03", "2024-12-30")?.id, "C");
  data = flexible("2025-03-03", [0, 2, 4]);
  data = complete(data, "2025-03-03");
  assert.equal(scheduleForDate(data, "2025-03-10", "2025-03-03")?.id, "D");
  assert.equal(nextFlexibleOccurrence(data, "2025-03-10")?.template.id, "B");
});

test("make-ups count once on their actual training day without repairing missed dates", () => {
  let data = complete(complete(flexible(), "2025-01-06"), "2025-01-07");
  data = complete(data, "2025-01-13");
  const result = summarize(data, 2, "2025-01-13", "lb");
  assert.equal(result.scheduledWorkouts, 4);
  assert.equal(result.completedScheduledWorkouts, 3);
  assert.equal(result.completionRate, 75);
  assert.equal(data.sessions.some((session) => session.date === "2025-01-08"), false);
});

test("historical unlinked recording never consumes the live sequence", () => {
  const data = flexible();
  const old = startSession(data, data.templates[0], "2025-01-06", "2025-01-13");
  assert.equal(old.session.routineOccurrence, null);
  const entered = editSessionSet(old.session, 0, 0, { weight: "100", reps: "10" });
  const finished = finishWorkout({ ...old.data, sessions: [entered] }, entered.id, false, "2025-01-13");
  assert.equal(finished.routineProgress.length, 0);
  assert.equal(nextFlexibleOccurrence(finished, "2025-01-13")?.template.id, "A");
});


test("unfinished fixed recordings block schedule changes but allow content corrections", () => {
  const original = fixture();
  const data = startSession(original, original.templates[0], "2025-01-06", "2025-01-06").data;
  assert.throws(() => saveTemplate(data, { ...data.templates[0], weekdays: [4] }, "2025-01-06"), /Finish or cancel/);
  assert.throws(() => archiveTemplate(data, "A", "2025-01-06"), /Finish or cancel/);
  assert.throws(() => swapWeekday(data, 0, "2025-01-06"), /Finish or cancel/);
  assert.equal(saveTemplate(data, { ...data.templates[0], title: "Updated A" }, "2025-01-06").templates[0].title, "Updated A");
});

test("next occurrence covers longer flexible cycles", () => {
  const start = "2030-01-07";
  const data = flexible(start, [0]);
  assert.equal(nextOccurrence(data, "F", start), "2030-02-11");
});
