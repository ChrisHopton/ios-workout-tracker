import test from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  dayDifference,
  mondayOf,
  parseDate,
  weekdayIndex,
} from "../src/domain/dates";
import { initialData } from "../src/domain/library";
import {
  archiveTemplate,
  revisionForDate,
  saveTemplate,
  scheduleForDate,
  swapWeekday,
} from "../src/domain/schedule";
import {
  convertWeight,
  numericReps,
  numericWeight,
  suggestWeights,
} from "../src/domain/recommendations";
import { startSession, finishSession } from "../src/domain/sessions";
import { summarize } from "../src/domain/analytics";
import { AppData, WorkoutSession, WorkoutTemplate } from "../src/domain/types";

function template(id = "squat", weekdays = [0]): WorkoutTemplate {
  return {
    id,
    title: id,
    exercises: [
      { exerciseId: "exercise-barbell-squat", sets: 3, repMin: 8, repMax: 12 },
    ],
    weekdays,
    archived: false,
    updatedAt: "2025-01-01T12:00:00Z",
  };
}
function record(
  data: AppData,
  date: string,
  weights = ["100", "100", "100"],
  reps = ["12", "12", "12"],
  plan = template(),
): AppData {
  const started = startSession(data, plan, date);
  const session: WorkoutSession = {
    ...started.session,
    exercises: started.session.exercises.map((item) => ({
      ...item,
      sets: item.sets.map((_, i) => ({
        weight: weights[i],
        reps: reps[i],
        status: "completed" as const,
      })),
    })),
  };
  const finished = finishSession(session, false);
  return {
    ...started.data,
    sessions: started.data.sessions.map((item) =>
      item.id === finished.id ? finished : item,
    ),
  };
}
const firstMonday = "2025-01-06";

test("calendar helpers handle DST, year transitions and invalid dates without timezone drift", () => {
  assert.equal(dayDifference("2025-03-10", "2025-03-09"), 1);
  assert.equal(dayDifference("2025-11-03", "2025-11-02"), 1);
  assert.equal(mondayOf("2025-01-01"), "2024-12-30");
  assert.equal(addDays("2024-12-31", 1), "2025-01-01");
  assert.equal(weekdayIndex("2025-01-05"), 6);
  assert.equal(addDays("2024-02-28", 1), "2024-02-29");
  assert.throws(() => parseDate("2025-02-29"));
  assert.throws(() => parseDate("1/6/2025"));
});

test("one workout repeats weekly and two alternate without missed-day drift", () => {
  let data = saveTemplate(initialData(), template("a"), firstMonday);
  assert.equal(scheduleForDate(data, "2025-01-13")?.id, "a");
  assert.equal(scheduleForDate(data, "2025-01-07"), null);
  data = saveTemplate(data, template("b"), firstMonday);
  assert.equal(scheduleForDate(data, firstMonday)?.id, "a");
  assert.equal(scheduleForDate(data, "2025-01-13")?.id, "b");
  assert.equal(scheduleForDate(data, "2025-01-20")?.id, "a");
  assert.equal(scheduleForDate(data, "2026-01-05")?.id, "a");
  assert.equal(scheduleForDate(data, "2025-01-27")?.id, "b");
  assert.equal(data.scheduleRevisions.length, 1);
  assert.throws(
    () => saveTemplate(data, template("c"), firstMonday),
    /at most two/,
  );
});

test("three Monday-Wednesday plans repeat and six alternate by fixed A/B week", () => {
  let data = initialData();
  for (let index = 0; index < 3; index++)
    data = saveTemplate(data, template(`a${index}`, [index]), firstMonday);
  for (let index = 0; index < 3; index++)
    assert.equal(
      scheduleForDate(data, addDays("2025-01-13", index))?.id,
      `a${index}`,
    );
  for (let index = 0; index < 3; index++)
    data = saveTemplate(data, template(`b${index}`, [index]), firstMonday);
  for (let index = 0; index < 3; index++) {
    assert.equal(
      scheduleForDate(data, addDays(firstMonday, index))?.id,
      `a${index}`,
    );
    assert.equal(
      scheduleForDate(data, addDays("2025-01-13", index))?.id,
      `b${index}`,
    );
  }
});

test("schedule revisions preserve earlier titles and targets, order and anchor", () => {
  let data = saveTemplate(initialData(), template("a"), firstMonday);
  data = saveTemplate(data, template("b"), firstMonday);
  data = saveTemplate(
    data,
    {
      ...template("a"),
      title: "New A",
      exercises: [{ ...template().exercises[0], sets: 4 }],
    },
    "2025-01-14",
  );
  assert.equal(scheduleForDate(data, firstMonday)?.title, "a");
  assert.equal(scheduleForDate(data, firstMonday)?.exercises[0].sets, 3);
  assert.equal(scheduleForDate(data, "2025-01-20")?.title, "New A");
  assert.equal(revisionForDate(data, "2025-01-20")?.anchorMonday, firstMonday);
  assert.equal(data.scheduleRevisions.length, 2);
  data = swapWeekday(data, 0, "2025-01-14");
  assert.equal(scheduleForDate(data, "2025-01-20")?.id, "b");
  assert.equal(scheduleForDate(data, firstMonday)?.id, "a");
  data = archiveTemplate(data, "b", "2025-01-21");
  assert.equal(scheduleForDate(data, "2025-01-27")?.id, "a");
  assert.equal(scheduleForDate(data, "2025-01-20")?.id, "b");
  assert.throws(
    () => saveTemplate(data, template("c"), "2025-01-01"),
    /cannot precede/,
  );
});

test("session starts once per date and snapshots survive definition/template mutations", () => {
  const data = initialData();
  const plan = template();
  const started = startSession(data, plan, firstMonday);
  assert.equal(
    startSession(started.data, template("other"), firstMonday).session.id,
    started.session.id,
  );
  assert.equal(
    startSession(started.data, plan, firstMonday).data.sessions.length,
    1,
  );
  plan.title = "Renamed";
  plan.exercises[0].sets = 9;
  data.exercises[0].name = "Changed";
  assert.equal(started.session.title, "squat");
  assert.equal(started.session.exercises[0].target.sets, 3);
  assert.equal(started.session.exercises[0].exercise.name, "Barbell squat");
  assert.deepEqual(started.session.exercises[0].sets[0], {
    weight: "",
    reps: "",
    status: "pending",
  });
  assert.throws(() => startSession(data, template(), "9999-01-01"), /Future/);
});

test("finishing requires explicit completed or skipped valid sets and preserves cleared input", () => {
  const session = startSession(initialData(), template(), firstMonday).session;
  assert.throws(() => finishSession(session, false), /explicitly skip/);
  assert.throws(() => finishSession(session, true), /at least one/);
  session.exercises[0].sets[0] = {
    weight: "100",
    reps: "8",
    status: "completed",
  };
  const finished = finishSession(session, true);
  assert.equal(finished.status, "completed");
  assert.equal(finished.exercises[0].sets[1].status, "skipped");
  assert.equal(session.exercises[0].sets[1].status, "pending");
  session.exercises[0].sets[0].weight = "";
  assert.throws(() => finishSession(session, true), /valid weight/);
  session.exercises[0].sets[0].weight = "100";
  session.exercises[0].sets[0].reps = "8.5";
  assert.throws(() => finishSession(session, true), /whole number/);
});

test("numeric input validation rejects blank, exponent, infinity and invalid reps", () => {
  for (const bad of ["", " ", "-1", "Infinity", "1e3", "1,000", "0x10"])
    assert.equal(numericWeight(bad), null);
  assert.equal(numericWeight("0"), 0);
  assert.equal(numericWeight(".5"), 0.5);
  assert.equal(numericWeight(" 105.5 "), 105.5);
  for (const bad of ["", "0", "-1", "5.5", "1e2"])
    assert.equal(numericReps(bad), null);
  assert.equal(numericReps("12"), 12);
});

test("suggestions are blank without history and increase only after two full upper-target workouts", () => {
  let data = initialData();
  const definition = data.exercises[0];
  const target = template().exercises[0];
  assert.deepEqual(
    suggestWeights(data, target, definition, "2025-01-20", "lb").weights,
    [null, null, null],
  );
  data = record(data, firstMonday);
  assert.deepEqual(
    suggestWeights(data, target, definition, "2025-01-13", "lb").weights,
    [100, 100, 100],
  );
  data = record(data, "2025-01-13");
  assert.deepEqual(
    suggestWeights(data, target, definition, "2025-01-20", "lb").weights,
    [105, 105, 105],
  );
  assert.deepEqual(
    suggestWeights(data, target, definition, "2025-01-13", "lb").weights,
    [100, 100, 100],
  );
  assert.deepEqual(
    suggestWeights(data, target, definition, "2025-01-01", "lb").weights,
    [null, null, null],
  );
});

test("incomplete targets, skipped sets, training gaps and varying weights suppress progression", () => {
  const target = template().exercises[0];
  let data = record(
    record(initialData(), firstMonday),
    "2025-01-13",
    ["100", "100", "100"],
    ["12", "11", "12"],
  );
  const definition = data.exercises[0];
  assert.deepEqual(
    suggestWeights(data, target, definition, "2025-01-20", "lb").weights,
    [100, 100, 100],
  );
  data.sessions[1].exercises[0].sets[1].status = "skipped";
  assert.deepEqual(
    suggestWeights(data, target, definition, "2025-01-20", "lb").weights,
    [100, null, 100],
  );
  data = record(record(initialData(), firstMonday), "2025-01-13");
  assert.deepEqual(
    suggestWeights(data, target, definition, "2025-02-11", "lb").weights,
    [100, 100, 100],
  );
  assert.deepEqual(
    suggestWeights(data, target, definition, "2025-02-10", "lb").weights,
    [105, 105, 105],
  );
  data = record(
    record(initialData(), firstMonday, ["100", "110", "100"]),
    "2025-01-13",
    ["100", "110", "100"],
  );
  assert.deepEqual(
    suggestWeights(data, target, definition, "2025-01-20", "lb").weights,
    [100, 110, 100],
  );
});

test("increment guard allows exactly 10 percent and blocks larger increases", () => {
  const data = record(
    record(initialData(), firstMonday, ["50", "50", "50"]),
    "2025-01-13",
    ["50", "50", "50"],
  );
  assert.deepEqual(
    suggestWeights(
      data,
      template().exercises[0],
      data.exercises[0],
      "2025-01-20",
      "lb",
    ).weights,
    [55, 55, 55],
  );
  assert.deepEqual(
    suggestWeights(
      data,
      template().exercises[0],
      { ...data.exercises[0], incrementLb: 5.1 },
      "2025-01-20",
      "lb",
    ).weights,
    [50, 50, 50],
  );
});

test("unit changes convert history and compare equivalent units without treating them as different lifts", () => {
  let data = record(initialData(), firstMonday);
  data = { ...data, settings: { ...data.settings, unit: "kg" } };
  const kg = String(convertWeight(100, "lb", "kg"));
  data = record(data, "2025-01-13", [kg, kg, kg]);
  const suggestion = suggestWeights(
    data,
    template().exercises[0],
    data.exercises[0],
    "2025-01-20",
    "kg",
  );
  assert.deepEqual(suggestion.weights, [47.859, 47.859, 47.859]);
  assert.ok(
    Math.abs(convertWeight(convertWeight(100, "lb", "kg"), "kg", "lb") - 100) <
      1e-9,
  );
});

test("different equipment or prescribed targets are not comparable; bodyweight stays reps only", () => {
  const data = record(record(initialData(), firstMonday), "2025-01-13");
  assert.deepEqual(
    suggestWeights(
      data,
      template().exercises[0],
      { ...data.exercises[0], equipment: "machine" },
      "2025-01-20",
      "lb",
    ).weights,
    [null, null, null],
  );
  assert.deepEqual(
    suggestWeights(
      data,
      { ...template().exercises[0], repMax: 15 },
      data.exercises[0],
      "2025-01-20",
      "lb",
    ).weights,
    [null, null, null],
  );
  assert.deepEqual(
    suggestWeights(
      data,
      template().exercises[0],
      { ...data.exercises[0], equipment: "bodyweight" },
      "2025-01-20",
      "lb",
    ).weights,
    [null, null, null],
  );
});

test("analytics counts completed sets once, excludes unfinished/future days and honors scheduled identity", () => {
  let data = saveTemplate(initialData(), template(), firstMonday);
  data = record(data, firstMonday);
  data = record(data, "2025-01-13");
  data.sessions[1].exercises[0].sets[2].status = "skipped";
  data = startSession(data, template(), "2025-01-20").data;
  const result = summarize(data, 4, "2025-01-20", "kg");
  assert.equal(result.completedWorkouts, 2);
  assert.equal(result.completedSets, 5);
  assert.equal(result.groups.find((group) => group.group === "Legs")?.sets, 5);
  assert.equal(result.scheduledWorkouts, 3);
  assert.equal(result.completedScheduledWorkouts, 2);
  assert.ok(Math.abs(result.completionRate! - 200 / 3) < 1e-10);
  assert.ok(
    Math.abs(result.exerciseHistory[0].heaviestSet!.weight - 45.359237) < 1e-10,
  );
  assert.equal(result.exerciseHistory[0].heaviestSet!.reps, 12);
  assert.equal(result.weeks.length, 4);
  const earlier = summarize(data, 4, "2025-01-08", "lb");
  assert.equal(earlier.completedWorkouts, 1);
  assert.equal(earlier.scheduledWorkouts, 1);
  assert.equal(earlier.completionRate, 100);
  assert.equal(
    summarize(initialData(), 8, "2025-01-20", "lb").completionRate,
    null,
  );
});

test("unfinished comparable sessions interrupt an otherwise successful progression streak", () => {
  let data = record(record(initialData(), firstMonday), "2025-01-13");
  const started = startSession(data, template(), "2025-01-15");
  started.session.exercises[0].sets[0] = {
    weight: "100",
    reps: "12",
    status: "completed",
  };
  data = started.data;
  assert.deepEqual(
    suggestWeights(
      data,
      template().exercises[0],
      data.exercises[0],
      "2025-01-20",
      "lb",
    ).weights,
    [100, null, null],
  );
  data = record(data, "2025-01-20");
  const suggestion = suggestWeights(
    data,
    template().exercises[0],
    data.exercises[0],
    "2025-01-27",
    "lb",
  );
  assert.deepEqual(suggestion.weights, [100, 100, 100]);
  assert.match(suggestion.reason, /unfinished/);
});

test("domain-produced schedule, draft and completed session roundtrip backup validation", async () => {
  const { parseBackup, serializeBackup } = await import("../src/domain/backup");
  let data = saveTemplate(initialData(), template("a"), firstMonday);
  data = saveTemplate(data, template("b"), firstMonday);
  data = record(
    data,
    firstMonday,
    ["100", "100", "100"],
    ["12", "12", "12"],
    template("a"),
  );
  data = saveTemplate(
    data,
    { ...template("a"), title: "Updated title" },
    "2025-01-14",
  );
  data = swapWeekday(data, 0, "2025-01-14");
  data = startSession(data, template("b"), "2025-01-20").data;
  data.sessions[1].exercises[0].sets[1].weight = ".";
  data.sessions[1].exercises[0].sets[2].reps = "";
  assert.deepEqual(parseBackup(serializeBackup(data)), data);
  const restored = parseBackup(serializeBackup(data));
  assert.equal(
    startSession(restored, template("b"), "2025-01-20").session.id,
    data.sessions[1].id,
  );
  assert.equal(scheduleForDate(restored, firstMonday)?.title, "a");
});
