import { parseDate, today } from "./dates";
import { completeRoutineSession, occurrenceForRecording } from "./routine";
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
  currentDate = today(),
): { data: AppData; session: WorkoutSession } {
  parseDate(date);
  parseDate(currentDate);
  if (date > currentDate)
    throw new Error(
      "Future workouts can be previewed, but recorded only on or after their scheduled day.",
    );
  const existing = data.sessions.find((session) => session.date === date);
  if (existing) return { data, session: existing };
  if (!template.exercises.length)
    throw new Error("This workout has no exercises to record.");
  const routineOccurrence = occurrenceForRecording(data, template.id, date, currentDate);
  if (routineOccurrence && data.routineProgress.some((item) => item.routineId === routineOccurrence.routineId && item.ordinal === routineOccurrence.ordinal))
    throw new Error("This routine workout was already resolved.");
  if (routineOccurrence && data.sessions.some((item) => item.status === "in_progress"
    && item.routineOccurrence !== null && !item.hasFinished))
    throw new Error("Resume or cancel the unfinished routine workout before starting another one.");
  const timestamp = new Date().toISOString();
  const session: WorkoutSession = {
    id: newId("session"),
    hasFinished: false,
    routineOccurrence,
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
      const suggestion = suggestWeights(data, target, exercise, date, data.settings.unit);
      return {
        exercise: { ...exercise },
        target: { ...target },
        suggestion,
        sets: Array.from({ length: target.sets }, (_, index) => ({
          classification: "working" as const,
          weight: exercise.equipment === "bodyweight" || suggestion.weights[index] == null ? "" : String(suggestion.weights[index]),
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
  currentDate = today(),
): WorkoutSession {
  parseDate(session.date);
  parseDate(currentDate);
  if (session.date > currentDate)
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
    hasFinished: true,
    finishedAt: session.finishedAt ?? timestamp,
    updatedAt: timestamp,
  };
}

/** Finish the recording and consume its linked occurrence in the same saved transaction. */
export function finishWorkout(data: AppData, id: string, skipMissing = false, currentDate = today()): AppData {
  const session = data.sessions.find((item) => item.id === id);
  if (!session) throw new Error("This workout could not be found.");
  const finished = finishSession(session, skipMissing, currentDate);
  const next = { ...data, sessions: data.sessions.map((item) => item.id === id ? finished : item) };
  return completeRoutineSession(next, finished);
}

export function canCancelWorkout(session: WorkoutSession): boolean {
  return !session.hasFinished && session.status === "in_progress";
}

export function cancelWorkout(data: AppData, id: string): AppData {
  const session = data.sessions.find((item) => item.id === id);
  if (!session) throw new Error("This workout could not be found.");
  if (!canCancelWorkout(session)) throw new Error("A workout that has been finished cannot be cancelled.");
  return { ...data, sessions: data.sessions.filter((item) => item.id !== id) };
}

export function moveWorkoutToToday(data: AppData, id: string, currentDate = today()): AppData {
  parseDate(currentDate);
  const session = data.sessions.find((item) => item.id === id);
  if (!session) throw new Error("This workout could not be found.");
  if (!canCancelWorkout(session)) throw new Error("A workout that has been finished cannot be moved.");
  if (session.date === currentDate) return data;
  if (data.sessions.some((item) => item.id !== id && item.date === currentDate))
    throw new Error("Today already has a workout. Keep the original date or open today's workout.");
  return {
    ...data,
    sessions: data.sessions.map((item) => item.id === id
      ? { ...item, date: currentDate, updatedAt: new Date().toISOString() }
      : item),
  };
}
