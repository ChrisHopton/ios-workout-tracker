import assert from "node:assert/strict";
import test from "node:test";
import { initialData } from "../src/domain/library";
import { convertWeight, suggestWeights } from "../src/domain/recommendations";
import { startSession } from "../src/domain/sessions";
import { AppData, RecordedSet, Unit, WorkoutExercise, WorkoutSession, WorkoutTemplate } from "../src/domain/types";

const target: WorkoutExercise = { exerciseId: "exercise-barbell-squat", sets: 2, repMin: 8, repMax: 12 };
function result(weight: string, reps = "12", status: RecordedSet["status"] = "completed", classification: RecordedSet["classification"] = "working"): RecordedSet {
  return { weight, reps, status, classification };
}
function addSession(data: AppData, date: string, sets: RecordedSet[], options: { target?: WorkoutExercise; unit?: Unit; status?: WorkoutSession["status"]; equipment?: "machine" } = {}): AppData {
  const session: WorkoutSession = {
    id: date, date, title: "Squat", templateId: "squat", unit: options.unit ?? "lb",
    status: options.status ?? "completed", startedAt: date + "T12:00:00Z", updatedAt: date + "T13:00:00Z", finishedAt: date + "T13:00:00Z",
    exercises: [{ exercise: { ...data.exercises[0], ...(options.equipment ? { equipment: options.equipment } : {}) },
      target: options.target ?? target, suggestion: { algorithmVersion: 1, weights: [40, 80], reason: "Old snapshot" }, sets }],
  };
  return { ...data, sessions: [...data.sessions, session] };
}
const suggest = (data: AppData, chosenTarget = target, date = "2025-01-20", unit: Unit = "lb") => suggestWeights(data, chosenTarget, data.exercises[0], date, unit);

for (const [reps, expected] of [["8", 70], ["10", 75], ["12", 80]] as const) {
  test(`mixed working sets 40 x 12 and 80 x ${reps} suggest a common ${expected} lb`, () => {
    const data = addSession(initialData(), "2025-01-13", [result("40"), result("80", reps)]);
    const original = structuredClone(data);
    const suggestion = suggest(data);
    assert.deepEqual(suggestion.weights, [expected, expected]);
    assert.equal(suggestion.algorithmVersion, 2);
    assert.match(suggestion.reason, new RegExp("80 lb for " + reps));
    assert.deepEqual(data, original);
  });
}

test("mixed loads cap formula estimates at demonstrated weight and round down to equipment increments", () => {
  let data = addSession(initialData(), "2025-01-13", [result("40"), result("82", "15")]);
  assert.deepEqual(suggest(data).weights, [80, 80]);
  data.exercises[0].incrementLb = 2.5;
  assert.deepEqual(suggest(data).weights, [80, 80]);
  data.sessions[0].exercises[0].sets[1] = result("82", "8");
  assert.deepEqual(suggest(data).weights, [72.5, 72.5]);
});

test("consistent working loads hold while building reps instead of dropping after each workout", () => {
  const data = addSession(initialData(), "2025-01-13", [result("75", "8"), result("75", "9")]);
  assert.deepEqual(suggest(data).weights, [75, 75]);
});

test("two matching finished upper-target workouts increase one increment", () => {
  let data = addSession(initialData(), "2025-01-06", [result("75"), result("75")]);
  data = addSession(data, "2025-01-13", [result("75"), result("75")]);
  assert.deepEqual(suggest(data).weights, [80, 80]);
  assert.match(suggest(data).reason, /Every working set/);
});

test("two completed minimum misses at the same load decrease one increment", () => {
  let data = addSession(initialData(), "2025-01-06", [result("75", "8"), result("75", "7")]);
  assert.deepEqual(suggest(data).weights, [75, 75]);
  data = addSession(data, "2025-01-13", [result("75", "6"), result("75", "8")]);
  assert.deepEqual(suggest(data).weights, [70, 70]);
  assert.match(suggest(data).reason, /Reduce one increment/);
});

test("skipped and incomplete working sets never establish progression", () => {
  for (const status of ["skipped", "pending"] as const) {
    let data = addSession(initialData(), "2025-01-06", [result("75"), result("75")]);
    data = addSession(data, "2025-01-13", [result("75"), result("75", "12", status)]);
    assert.deepEqual(suggest(data).weights, [75, 75]);
    assert.match(suggest(data).reason, /Skipped or incomplete/);
  }
});

test("warm-ups are excluded from working load, successes and failures", () => {
  const threeSets = { ...target, sets: 3 };
  let data = addSession(initialData(), "2025-01-06", [result("40", "2", "completed", "warmup"), result("75"), result("75")], { target: threeSets });
  data = addSession(data, "2025-01-13", [result("150", "1", "completed", "warmup"), result("75"), result("75")], { target: threeSets });
  assert.deepEqual(suggest(data, threeSets).weights, [80, 80, 80]);
  data.sessions[1].exercises[0].sets[0].status = "skipped";
  assert.deepEqual(suggest(data, threeSets).weights, [80, 80, 80]);
});

test("warm-up-only history and no qualified mixed result leave suggestions blank", () => {
  let data = addSession(initialData(), "2025-01-13", [result("40", "12", "completed", "warmup"), result("80", "12", "completed", "warmup")]);
  assert.deepEqual(suggest(data).weights, [null, null]);
  data = addSession(initialData(), "2025-01-13", [result("40", "4"), result("80", "6")]);
  assert.deepEqual(suggest(data).weights, [null, null]);
});

test("higher rep ranges use demonstrated load and reduce one increment until upper target is reached", () => {
  const higher = { ...target, repMin: 12, repMax: 20 };
  let data = addSession(initialData(), "2025-01-13", [result("40", "20"), result("80", "15")], { target: higher });
  assert.deepEqual(suggest(data, higher).weights, [75, 75]);
  data.sessions[0].exercises[0].sets[1] = result("80", "20");
  assert.deepEqual(suggest(data, higher).weights, [80, 80]);
});

test("changed targets reuse demonstrated load but cannot trigger a two-workout adjustment", () => {
  let data = addSession(initialData(), "2025-01-06", [result("75"), result("75")]);
  data = addSession(data, "2025-01-13", [result("75"), result("75")]);
  assert.deepEqual(suggest(data, { ...target, sets: 3 }).weights, [75, 75, 75]);
  assert.deepEqual(suggest(data, { ...target, repMax: 15 }).weights, [75, 75]);
});

test("gap and increment guards include the exact 28-day and 10-percent boundary", () => {
  let data = addSession(initialData(), "2025-01-06", [result("50"), result("50")]);
  data = addSession(data, "2025-01-13", [result("50"), result("50")]);
  assert.deepEqual(suggest(data, target, "2025-02-10").weights, [55, 55]);
  assert.deepEqual(suggest(data, target, "2025-02-11").weights, [50, 50]);
  data.exercises[0].incrementLb = 5.1;
  assert.deepEqual(suggest(data).weights, [50, 50]);
  data.sessions[0].exercises[0].sets = [result("50", "7"), result("50", "7")];
  data.sessions[1].exercises[0].sets = [result("50", "7"), result("50", "7")];
  assert.deepEqual(suggest(data).weights, [50, 50]);
});

test("retrospective dates exclude same-day and later results and never borrow unfinished results", () => {
  let data = addSession(initialData(), "2025-01-06", [result("75"), result("75")]);
  data = addSession(data, "2025-01-13", [result("150"), result("150")], { status: "in_progress" });
  data = addSession(data, "2025-01-20", [result("200"), result("200")]);
  assert.deepEqual(suggest(data, target, "2025-01-13").weights, [75, 75]);
  assert.deepEqual(suggest(data, target, "2025-01-20").weights, [75, 75]);
  assert.match(suggest(data, target, "2025-01-20").reason, /unfinished/);
  assert.deepEqual(suggest(data, target, "2025-01-06").weights, [null, null]);
});

test("unit changes compare canonical equivalent loads and differing equipment stays separate", () => {
  let data = addSession(initialData(), "2025-01-06", [result("100"), result("100")]);
  const kilograms = String(convertWeight(100, "lb", "kg"));
  data = addSession(data, "2025-01-13", [result(kilograms), result(kilograms)], { unit: "kg" });
  assert.deepEqual(suggest(data, target, "2025-01-20", "kg").weights, [47.859, 47.859]);
  data = addSession(data, "2025-01-19", [result("200"), result("200")], { equipment: "machine" });
  assert.deepEqual(suggest(data).weights, [105, 105]);
});

test("bodyweight remains reps-only and new sessions preserve prior suggestion snapshots", () => {
  const data = addSession(initialData(), "2025-01-13", [result("40"), result("80", "10")]);
  assert.deepEqual(suggestWeights(data, target, { ...data.exercises[0], equipment: "bodyweight" }, "2025-01-20", "lb").weights, [null, null]);
  const plan: WorkoutTemplate = { id: "squat", title: "Squat", exercises: [target], weekdays: [0], recurrence: { kind: "weekly" }, archived: false, updatedAt: "2025-01-01T12:00:00Z" };
  const next = startSession(data, plan, "2025-01-20");
  assert.deepEqual(next.session.exercises[0].sets.map((set) => set.classification), ["working", "working"]);
  assert.equal(next.session.exercises[0].suggestion.algorithmVersion, 2);
  assert.equal(data.sessions[0].exercises[0].suggestion.algorithmVersion, 1);
  assert.deepEqual(data.sessions[0].exercises[0].suggestion.weights, [40, 80]);
});
