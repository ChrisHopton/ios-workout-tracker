import { DatabaseSync } from "node:sqlite";
import { addDays } from "../src/domain/dates";
import { initialData } from "../src/domain/library";
import { AppData, WorkoutSession } from "../src/domain/types";
import { JournalDatabase } from "../src/data/journalStorage";

export function historyFixture(count = 1000): AppData {
  const data = initialData();
  data.sessions = Array.from({ length: count }, (_, index): WorkoutSession => ({
    id: `session-${index}`,
    date: addDays("2020-01-01", index * 2),
    title: "Full body",
    templateId: "plan",
    unit: "lb",
    status: "completed", hasFinished: true, routineOccurrence: null,
    startedAt: "2020-01-01T12:00:00.000Z",
    updatedAt: "2020-01-01T12:00:00.000Z",
    finishedAt: "2020-01-01T12:00:00.000Z",
    exercises: data.exercises.slice(0, 6).map((exercise) => ({
      exercise: { ...exercise },
      target: { exerciseId: exercise.id, sets: 3, repMin: 8, repMax: 12 },
      suggestion: {
        algorithmVersion: 1,
        weights: [100, 100, 100],
        reason: "Repeat your last comparable workout weights",
      },
      sets: Array.from({ length: 3 }, () => ({
        classification: "working",
        weight: "100",
        reps: "12",
        status: "completed",
      })),
    })),
  }));
  return data;
}

export function editLastSession(data: AppData, weight: string): AppData {
  return {
    ...data,
    sessions: data.sessions.map((session, index) =>
      index !== data.sessions.length - 1
        ? session
        : {
            ...session,
            status: "in_progress",
            finishedAt: null,
            exercises: session.exercises.map((entry, index) =>
              index
                ? entry
                : {
                    ...entry,
                    sets: entry.sets.map((set, index) =>
                      index ? set : { ...set, weight, status: "pending" },
                    ),
                  },
            ),
          },
    ),
  };
}

export function sqliteHarness() {
  const native = new DatabaseSync(":memory:");
  let writes = 0;
  let bytes = 0;
  let failAt = Infinity;
  let failCommit = false;
  const db: JournalDatabase = {
    async execAsync(sql) {
      native.exec(sql);
    },
    async runAsync(sql, ...params) {
      if (++writes === failAt) throw new Error("simulated disk failure");
      bytes += params.reduce<number>(
        (total, value) =>
          total + (typeof value === "string" ? Buffer.byteLength(value) : 0),
        0,
      );
      return native.prepare(sql).run(...params);
    },
    async getFirstAsync<T>(sql: string, ...params: (string | number)[]) {
      return (native.prepare(sql).get(...params) as T | undefined) ?? null;
    },
    async getAllAsync<T>(sql: string, ...params: (string | number)[]) {
      return native.prepare(sql).all(...params) as T[];
    },
    async withExclusiveTransactionAsync(task) {
      native.exec("BEGIN IMMEDIATE");
      try {
        await task(db);
        if (failCommit) {
          failCommit = false;
          throw new Error("simulated commit failure");
        }
        native.exec("COMMIT");
      } catch (error) {
        native.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return {
    db,
    native,
    stats: () => ({ writes, bytes }),
    failNext: (offset = 1) => {
      failAt = writes + offset;
    },
    failCommit: () => {
      failCommit = true;
    },
    close: () => native.close(),
  };
}

export function scheduleHistoryFixture(revisions: number, workouts = 1000): AppData {
  const data = historyFixture(workouts);
  data.templates = Array.from({ length: 7 }, (_, day) => ({
    id: "plan-" + day, title: "Plan " + day,
    recurrence: { kind: "weekly" as const }, weekdays: [day], archived: false,
    updatedAt: "2020-01-01T12:00:00.000Z",
    exercises: data.exercises.slice(0, 6).map(exercise => ({
      exerciseId: exercise.id, sets: 3, repMin: 8, repMax: 12,
    })),
  }));
  data.scheduleRevisions = Array.from({ length: revisions }, (_, index) => ({
    id: "revision-" + index, effectiveDate: addDays("2020-01-01", index),
    anchorMonday: "2019-12-30", routine: { mode: "fixed" },
    slots: data.templates.map((plan, weekday) => ({ weekday, workoutIds: [plan.id, plan.id] })),
    templates: structuredClone(data.templates),
  }));
  return data;
}
