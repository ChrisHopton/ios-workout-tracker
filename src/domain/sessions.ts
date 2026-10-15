import { parseDate, today } from "./dates";
import { numericReps, numericWeight, suggestWeights } from "./recommendations";
import {
  AppData,
  Equipment,
  newId,
  RecordedSet,
  WorkoutSession,
  WorkoutTemplate,
} from "./types";

export function startSession(
  data: AppData,
  template: WorkoutTemplate,
  date: string,
): { data: AppData; session: WorkoutSession } {
  parseDate(date);
  if (date > today())
    throw new Error(
      "Future workouts can be previewed, but recorded only on or after their scheduled day.",
    );
  const existing = data.sessions.find((session) => session.date === date);
  if (existing) return { data, session: existing };
  if (!template.exercises.length)
    throw new Error("This workout has no exercises to record.");
  const timestamp = new Date().toISOString();
  const session: WorkoutSession = {
    id: newId("session"),
    date,
    title: template.title,
    templateId: template.id,
    unit: data.settings.unit,
    status: "in_progress",
    startedAt: timestamp,
    updatedAt: timestamp,
    finishedAt: null,
    exercises: template.exercises.map((target) => {
      const exercise = data.exercises.find(
        (candidate) => candidate.id === target.exerciseId,
      );
      if (!exercise)
        throw new Error("An exercise in this workout is unavailable.");
      return {
        exercise: { ...exercise },
        target: { ...target },
        suggestion: suggestWeights(
          data,
          target,
          exercise,
          date,
          data.settings.unit,
        ),
        sets: Array.from({ length: target.sets }, () => ({
          classification: "working" as const,
          weight: "",
          reps: "",
          status: "pending" as const,
        })),
      };
    }),
  };
  return { data: { ...data, sessions: [...data.sessions, session] }, session };
}

export function validateSet(
  set: RecordedSet,
  equipment: Equipment,
): string | null {
  if (numericReps(set.reps) === null)
    return "Enter a whole number of reps from 1 to 1,000.";
  if (equipment !== "bodyweight" && numericWeight(set.weight) === null)
    return "Enter a valid weight from 0 to 10,000.";
  return null;
}

export function finishSession(
  session: WorkoutSession,
  skipMissing: boolean,
): WorkoutSession {
  parseDate(session.date);
  if (session.date > today())
    throw new Error("Future workouts cannot be completed.");
  if (!session.exercises.length)
    throw new Error("Add an exercise before finishing your workout.");
  const exercises = session.exercises.map((item) => ({
    ...item,
    sets: item.sets.map((set) => {
      if (set.status === "skipped") return { ...set };
      if (set.status === "pending") {
        if (!skipMissing)
          throw new Error(
            "Complete or explicitly skip every set before finishing.",
          );
        return { ...set, status: "skipped" as const };
      }
      if (numericReps(set.reps) === null)
        throw new Error(
          `${item.exercise.name}: enter a whole number of reps from 1 to 1,000.`,
        );
      if (
        item.exercise.equipment !== "bodyweight" &&
        numericWeight(set.weight) === null
      ) {
        throw new Error(
          `${item.exercise.name}: enter a valid weight from 0 to 10,000 ${session.unit}.`,
        );
      }
      return {
        ...set,
        weight:
          item.exercise.equipment === "bodyweight" ? "" : set.weight.trim(),
        reps: set.reps.trim(),
      };
    }),
  }));
  if (
    !exercises.some((item) =>
      item.sets.some((set) => set.status === "completed"),
    )
  )
    throw new Error("Complete at least one set before finishing your workout.");
  const timestamp = new Date().toISOString();
  return {
    ...session,
    exercises,
    status: "completed",
    finishedAt: session.finishedAt ?? timestamp,
    updatedAt: timestamp,
  };
}
