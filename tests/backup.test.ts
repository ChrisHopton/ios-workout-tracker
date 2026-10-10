import test from "node:test";
import assert from "node:assert/strict";
import { initialData } from "../src/domain/library";
import {
  MAX_BACKUP_BYTES,
  parseBackup,
  serializeBackup,
} from "../src/domain/backup";
import type { AppData, WorkoutTemplate } from "../src/domain/types";

const at = "2026-10-10T12:00:00.000Z";
function fixture(): AppData {
  const data = initialData();
  const exercise = data.exercises[0];
  const template: WorkoutTemplate = {
    id: "workout-1",
    title: "Leg day",
    exercises: [{ exerciseId: exercise.id, sets: 2, repMin: 8, repMax: 12 }],
    weekdays: [0],
    archived: false,
    updatedAt: at,
  };
  data.templates = [template];
  data.scheduleRevisions = [
    {
      id: "revision-1",
      effectiveDate: "2026-10-10",
      anchorMonday: "2026-10-05",
      slots: [{ weekday: 0, workoutIds: [template.id] }],
      templates: [structuredClone(template)],
    },
  ];
  data.sessions = [
    {
      id: "session-1",
      date: "2026-10-10",
      templateId: template.id,
      title: template.title,
      unit: "kg",
      status: "in_progress",
      startedAt: at,
      updatedAt: at,
      finishedAt: null,
      exercises: [
        {
          exercise: structuredClone(exercise),
          target: structuredClone(template.exercises[0]),
          suggestion: {
            weights: [22.25, 22.25],
            reason: "Repeat previous weights.",
          },
          sets: [
            { weight: "22.25", reps: "12", status: "completed" },
            { weight: "", reps: "", status: "pending" },
          ],
        },
      ],
    },
  ];
  return data;
}
function rejectsMutation(
  mutate: (data: AppData) => void,
  expected: RegExp,
): void {
  const data = fixture();
  mutate(data);
  assert.throws(() => parseBackup(JSON.stringify(data)), expected);
}
test("round trips empty data and preserves fractional weights and cleared drafts", () => {
  assert.deepEqual(parseBackup(serializeBackup(initialData())), initialData());
  const data = fixture();
  data.settings.heightCm = 178.435;
  assert.deepEqual(parseBackup(serializeBackup(data)), data);
});
test("snapshots remain valid after their current template and definition disappear", () => {
  const data = fixture();
  data.templates = [];
  data.exercises = [];
  assert.deepEqual(parseBackup(serializeBackup(data)), data);
});
test("allows unfinished numeric drafts without considering them completed sets", () => {
  const data = fixture();
  const set = data.sessions[0].exercises[0].sets[1];
  for (const draft of [".", "22.", "0", ".25", ""]) {
    set.weight = draft;
    assert.equal(
      parseBackup(serializeBackup(data)).sessions[0].exercises[0].sets[1]
        .weight,
      draft,
    );
  }
});
test("rejects malformed JSON, versions, missing fields, unknown properties and oversize input", () => {
  assert.throws(() => parseBackup("{"), /not valid JSON/);
  assert.throws(
    () => parseBackup(JSON.stringify({ ...initialData(), schemaVersion: 2 })),
    /schemaVersion/,
  );
  assert.throws(
    () => parseBackup(JSON.stringify({ ...initialData(), settings: {} })),
    /settings.age/,
  );
  assert.throws(
    () => parseBackup(JSON.stringify({ ...initialData(), prototype: {} })),
    /not supported/,
  );
  assert.throws(
    () => parseBackup(" ".repeat(MAX_BACKUP_BYTES + 1)),
    /too large/,
  );
  assert.throws(
    () => parseBackup("🦊".repeat(MAX_BACKUP_BYTES / 3)),
    /too large/,
  );
});
test("rejects invalid calendar dates, malformed timestamps and non-Monday anchors", () => {
  rejectsMutation((data) => {
    data.sessions[0].date = "2026-02-30";
  }, /real calendar date/);
  rejectsMutation((data) => {
    data.sessions[0].startedAt = "tomorrow";
  }, /ISO UTC timestamp/);
  rejectsMutation((data) => {
    data.sessions[0].updatedAt = "2026-02-30T00:00:00.000Z";
  }, /ISO UTC timestamp/);
  rejectsMutation((data) => {
    data.scheduleRevisions[0].anchorMonday = "2026-10-06";
  }, /Monday/);
});
test("rejects duplicate session dates, IDs, revision effective dates and weekdays", () => {
  rejectsMutation((data) => {
    data.sessions.push({ ...data.sessions[0], id: "session-2" });
  }, /sessions.date/);
  rejectsMutation((data) => {
    data.exercises.push(data.exercises[0]);
  }, /exercises.id/);
  rejectsMutation((data) => {
    data.scheduleRevisions.push({
      ...data.scheduleRevisions[0],
      id: "revision-2",
    });
  }, /effectiveDate/);
  rejectsMutation((data) => {
    data.templates[0].weekdays = [0, 0];
  }, /duplicate/);
});
test("rejects broken current references while validating historical schedules independently", () => {
  rejectsMutation((data) => {
    data.templates[0].exercises[0].exerciseId = "missing";
  }, /existing exercise/);
  rejectsMutation((data) => {
    data.scheduleRevisions[0].slots[0].workoutIds = ["missing"];
  }, /active snapshot/);
  rejectsMutation((data) => {
    data.scheduleRevisions[0].templates[0].weekdays = [1];
  }, /active snapshot/);
  rejectsMutation((data) => {
    data.scheduleRevisions[0].slots = [];
  }, /every active/);
});
test("rejects more than two workouts per day and inconsistent set/suggestion counts", () => {
  rejectsMutation((data) => {
    data.scheduleRevisions[0].slots[0].workoutIds = ["a", "b", "c"];
  }, /between 0 and 2/);
  rejectsMutation((data) => {
    data.templates.push(
      { ...data.templates[0], id: "b" },
      { ...data.templates[0], id: "c" },
    );
  }, /more than two/);
  rejectsMutation((data) => {
    data.sessions[0].exercises[0].sets.pop();
  }, /between 2 and 2/);
  rejectsMutation((data) => {
    data.sessions[0].exercises[0].suggestion.weights = [10];
  }, /between 2 and 2/);
  rejectsMutation((data) => {
    data.sessions[0].exercises[0].target.exerciseId = "different";
  }, /match/);
});
test("completed workouts require a finished timestamp and resolved sets", () => {
  rejectsMutation((data) => {
    data.sessions[0].status = "completed";
  }, /finishedAt/);
  rejectsMutation((data) => {
    data.sessions[0].status = "completed";
    data.sessions[0].finishedAt = at;
  }, /explicitly skipped/);
  const data = fixture();
  data.sessions[0].status = "completed";
  data.sessions[0].finishedAt = at;
  data.sessions[0].exercises[0].sets[1].status = "skipped";
  assert.deepEqual(parseBackup(serializeBackup(data)), data);
});
test("completed loaded sets require valid actual values; bodyweight permits an empty weight", () => {
  rejectsMutation((data) => {
    data.sessions[0].exercises[0].sets[0].weight = "";
  }, /requires a weight/);
  rejectsMutation((data) => {
    data.sessions[0].exercises[0].sets[0].reps = "0";
  }, /at least one rep/);
  rejectsMutation((data) => {
    data.sessions[0].exercises[0].sets[0].weight = "-1";
  }, /nonnegative/);
  rejectsMutation((data) => {
    data.sessions[0].exercises[0].sets[0].reps = "1.5";
  }, /numeric draft/);
  const data = fixture();
  const entry = data.sessions[0].exercises[0];
  entry.exercise.equipment = "bodyweight";
  entry.suggestion.weights = [null, null];
  entry.sets[0].weight = "";
  assert.doesNotThrow(() => parseBackup(serializeBackup(data)));
});
test("failed parsing cannot mutate the source/current data", () => {
  const data = fixture();
  const before = structuredClone(data);
  assert.throws(() =>
    parseBackup(JSON.stringify({ ...data, sessions: ["broken"] })),
  );
  assert.deepEqual(data, before);
});
test("completed sessions cannot contain only skipped sets or out-of-range loads", () => {
  rejectsMutation((data) => {
    data.sessions[0].exercises[0].sets[0].weight = "10001";
  }, /must not exceed 10000/);
  rejectsMutation((data) => {
    data.sessions[0].status = "completed";
    data.sessions[0].finishedAt = at;
    data.sessions[0].exercises[0].sets.forEach((set) => {
      set.status = "skipped";
    });
  }, /at least one completed set/);
});
