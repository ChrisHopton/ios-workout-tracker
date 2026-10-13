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
    status: "completed",
    startedAt: "2020-01-01T12:00:00.000Z",
    updatedAt: "2020-01-01T12:00:00.000Z",
    finishedAt: "2020-01-01T12:00:00.000Z",
    exercises: data.exercises.slice(0, 6).map((exercise) => ({
      exercise: { ...exercise },
      target: { exerciseId: exercise.id, sets: 3, repMin: 8, repMax: 12 },
      suggestion: {
        weights: [100, 100, 100],
        reason: "Repeat your last comparable workout weights",
      },
      sets: Array.from({ length: 3 }, () => ({
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
