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

export type SetInputState =
  | { kind: "valid"; message: null }
  | { kind: "missing" | "invalid"; message: string };

export function classifySetInput(
  set: Pick<RecordedSet, "weight" | "reps">,
  equipment: Equipment,
): SetInputState {
  const reps = set.reps.trim();
  const weight = set.weight.trim();
  const repsMessage = "Enter a whole number of reps from 1 to 1,000.";
  const weightMessage = "Enter a valid weight from 0 to 10,000.";
  // Validate entered values before checking blanks so a typo cannot be skipped.
  if (reps && numericReps(reps) === null)
    return { kind: "invalid", message: repsMessage };
  if (equipment !== "bodyweight" && weight && numericWeight(weight) === null)
    return { kind: "invalid", message: weightMessage };
  if (!reps) return { kind: "missing", message: repsMessage };
  if (equipment !== "bodyweight" && !weight)
    return { kind: "missing", message: weightMessage };
  return { kind: "valid", message: null };
}

export function validateSet(
  set: RecordedSet,
  equipment: Equipment,
): string | null {
  return classifySetInput(set, equipment).message;
}

export type RecordingSetPatch = Partial<
  Pick<RecordedSet, "weight" | "reps" | "classification">
>;

export function editSessionSet(
  session: WorkoutSession,
  exerciseIndex: number,
  setIndex: number,
  patch: RecordingSetPatch,
): WorkoutSession {
  return {
    ...session,
    status: "in_progress",
    finishedAt: null,
    exercises: session.exercises.map((item, index) =>
      index !== exerciseIndex
        ? item
        : {
            ...item,
            sets: item.sets.map((set, index) => {
              if (index !== setIndex) return set;
              const next = { ...set, ...patch };
              // Old skipped sets can retain valid input. Only an input edit
              // reactivates them; changing the set type preserves the skip.
              if (
                set.status === "skipped" &&
                patch.weight === undefined &&
                patch.reps === undefined
              )
                return next;
              return {
                ...next,
                status:
                  classifySetInput(next, item.exercise.equipment).kind === "valid"
                    ? "completed" as const
                    : "pending" as const,
              };
            }),
          },
    ),
  };
}

export function inspectSessionRecording(session: WorkoutSession): {
  completedSets: number;
  missingSets: number;
  error: string | null;
} {
  let completedSets = 0;
  let missingSets = 0;
  let error: string | null = null;
  for (const item of session.exercises) {
    item.sets.forEach((set, index) => {
      if (set.status === "skipped") return;
      const input = classifySetInput(set, item.exercise.equipment);
      if (input.kind === "valid") completedSets += 1;
      else if (input.kind === "missing") missingSets += 1;
      else
        error ??=
          item.exercise.name + " set " + (index + 1) + ": " + input.message;
    });
  }
  return { completedSets, missingSets, error };
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
  const recording = inspectSessionRecording(session);
  if (recording.error) throw new Error(recording.error);
  if (!recording.completedSets)
    throw new Error("Complete at least one set before finishing your workout.");
  if (recording.missingSets && !skipMissing)
    throw new Error("Enter every set or confirm skipping missing sets before finishing.");
  const exercises = session.exercises.map((item) => ({
    ...item,
    sets: item.sets.map((set) => {
      if (set.status === "skipped") return { ...set };
      if (classifySetInput(set, item.exercise.equipment).kind === "missing")
        return { ...set, status: "skipped" as const };
      return {
        ...set,
        status: "completed" as const,
        weight:
          item.exercise.equipment === "bodyweight" ? "" : set.weight.trim(),
        reps: set.reps.trim(),
      };
    }),
  }));
  const timestamp = new Date().toISOString();
  return {
    ...session,
    exercises,
    status: "completed",
    finishedAt: session.finishedAt ?? timestamp,
    updatedAt: timestamp,
  };
}
