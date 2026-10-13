import { dayDifference, parseDate } from "./dates";
import {
  AppData,
  ExerciseDefinition,
  SessionExercise,
  Unit,
  WeightSuggestion,
  WorkoutExercise,
  WorkoutSession,
} from "./types";

export function convertWeight(value: number, from: Unit, to: Unit): number {
  return from === to
    ? value
    : value * (from === "lb" ? 0.45359237 : 1 / 0.45359237);
}

export function numericWeight(value: string): number | null {
  const trimmed = value.trim();
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 10000
    ? parsed
    : null;
}

export function numericReps(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 1000
    ? parsed
    : null;
}

function comparable(
  candidate: SessionExercise,
  target: WorkoutExercise,
  exercise: ExerciseDefinition,
): boolean {
  return (
    candidate.exercise.id === exercise.id &&
    candidate.exercise.equipment === exercise.equipment &&
    candidate.target.sets === target.sets &&
    candidate.target.repMin === target.repMin &&
    candidate.target.repMax === target.repMax &&
    candidate.sets.length === target.sets
  );
}

function clean(value: number): number {
  return Math.round(value * 1000) / 1000;
}
function equal(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.001;
}

export function suggestWeights(
  data: AppData,
  target: WorkoutExercise,
  exercise: ExerciseDefinition,
  date: string,
  unit: Unit,
): WeightSuggestion {
  parseDate(date);
  const blank = Array.from({ length: target.sets }, () => null);
  if (exercise.equipment === "bodyweight")
    return {
      weights: blank,
      reason:
        "Bodyweight exercise: record reps. Added weight is not suggested automatically.",
    };
  type HistoryEntry = { session: WorkoutSession; item: SessionExercise };
  let latest: HistoryEntry | undefined;
  let previous: HistoryEntry | undefined;
  const isNewer = (session: WorkoutSession, entry: HistoryEntry) =>
    (session.date.localeCompare(entry.session.date) ||
      session.startedAt.localeCompare(entry.session.startedAt)) > 0;
  for (const session of data.sessions) {
    if (session.date >= date) continue;
    for (const item of session.exercises) {
      if (!comparable(item, target, exercise)) continue;
      if (!latest || isNewer(session, latest)) {
        previous = latest;
        latest = { session, item };
      } else if (!previous || isNewer(session, previous)) {
        previous = { session, item };
      }
    }
  }
  if (!latest)
    return {
      weights: blank,
      reason:
        "No comparable workout yet. Choose a comfortable starting weight.",
    };
  const weights = latest.item.sets.map((set) => {
    const value = numericWeight(set.weight);
    return set.status === "completed" && value !== null
      ? clean(convertWeight(value, latest.session.unit, unit))
      : null;
  });
  const repeat = (reason: string): WeightSuggestion => ({ weights, reason });
  if (latest.session.status !== "completed")
    return repeat(
      "Your most recent comparable workout is unfinished. Repeat its completed set weights and finish recording before considering an increase.",
    );
  if (dayDifference(date, latest.session.date) > 28)
    return repeat(
      "Your last comparable workout was over 28 days ago. Repeat or lower the previous weight as needed.",
    );
  if (!previous)
    return repeat(
      "Repeat the previous weights. Two complete workouts at the upper rep target are needed before an increase.",
    );
  if (previous.session.status !== "completed")
    return repeat(
      "The previous comparable workout was unfinished. Two finished workouts at the upper rep target are needed before an increase.",
    );
  if (dayDifference(latest.session.date, previous.session.date) > 28)
    return repeat(
      "A recent training gap interrupted progression. Repeat the previous weights.",
    );
  const fullAtTarget = (item: SessionExercise) =>
    item.sets.every(
      (set) =>
        set.status === "completed" &&
        numericWeight(set.weight) !== null &&
        (numericReps(set.reps) ?? 0) >= target.repMax,
    );
  if (!fullAtTarget(latest.item) || !fullAtTarget(previous.item))
    return repeat(
      "Repeat the previous weights until every set reaches the upper rep target in two consecutive comparable workouts.",
    );
  const latestWeights = latest.item.sets.map((set) =>
    convertWeight(numericWeight(set.weight)!, latest.session.unit, unit),
  );
  const earlierWeights = previous.item.sets.map((set) =>
    convertWeight(numericWeight(set.weight)!, previous.session.unit, unit),
  );
  const base = latestWeights[0];
  if (
    !latestWeights.every((weight) => equal(weight, base)) ||
    !earlierWeights.every((weight) => equal(weight, base))
  ) {
    return repeat(
      "Previous set weights differ. Repeat the latest weights before considering an increase.",
    );
  }
  const increment = unit === "lb" ? exercise.incrementLb : exercise.incrementKg;
  if (
    !Number.isFinite(increment) ||
    increment <= 0 ||
    base <= 0 ||
    increment / base > 0.1 + Number.EPSILON
  ) {
    return repeat(
      "The configured increment would exceed 10%. Repeat the previous weights or choose a smaller increment in Settings.",
    );
  }
  return {
    weights: latestWeights.map((weight) => clean(weight + increment)),
    reason: `You reached the upper rep target for every set in two comparable workouts. Try ${increment} ${unit} more if it feels comfortable.`,
  };
}
