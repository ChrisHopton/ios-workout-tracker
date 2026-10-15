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
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 10000 ? parsed : null;
}

export function numericReps(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 1000 ? parsed : null;
}

function clean(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function equal(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.001;
}

type HistoryEntry = { session: WorkoutSession; item: SessionExercise };
type WorkingResult = { weight: number; reps: number };

function workingResults(entry: HistoryEntry, unit: Unit): WorkingResult[] {
  return entry.item.sets.flatMap((set) => {
    if (set.classification === "warmup" || set.status !== "completed") return [];
    const weight = numericWeight(set.weight);
    const reps = numericReps(set.reps);
    return weight === null || reps === null
      ? []
      : [{ weight: convertWeight(weight, entry.session.unit, unit), reps }];
  });
}

function uniformWeight(results: WorkingResult[]): number | null {
  const base = results[0]?.weight;
  return base !== undefined && results.every((set) => equal(set.weight, base))
    ? base
    : null;
}

function sameTargets(a: WorkoutExercise, b: WorkoutExercise): boolean {
  return a.sets === b.sets && a.repMin === b.repMin && a.repMax === b.repMax;
}

export function suggestWeights(
  data: AppData,
  target: WorkoutExercise,
  exercise: ExerciseDefinition,
  date: string,
  unit: Unit,
): WeightSuggestion {
  parseDate(date);
  const suggestion = (weight: number | null, reason: string): WeightSuggestion => ({
    algorithmVersion: 2,
    weights: Array.from({ length: target.sets }, () => weight === null ? null : clean(weight)),
    reason,
  });
  if (exercise.equipment === "bodyweight")
    return suggestion(null, "Bodyweight exercise: record reps. Added weight is not suggested automatically.");

  const history: HistoryEntry[] = [];
  for (const session of data.sessions) {
    if (session.date >= date) continue;
    for (const item of session.exercises) {
      if (item.exercise.id === exercise.id && item.exercise.equipment === exercise.equipment)
        history.push({ session, item });
    }
  }
  history.sort((a, b) => b.session.date.localeCompare(a.session.date) ||
    b.session.startedAt.localeCompare(a.session.startedAt));
  const latestIndex = history.findIndex((entry) =>
    entry.session.status === "completed" && workingResults(entry, unit).length > 0);
  if (latestIndex < 0)
    return suggestion(null, "No finished workout with completed working sets yet. Choose a comfortable starting weight.");
  const latest = history[latestIndex];
  const results = workingResults(latest, unit);
  const consistent = uniformWeight(results);
  const increment = unit === "lb" ? exercise.incrementLb : exercise.incrementKg;
  const validIncrement = Number.isFinite(increment) && increment > 0;
  const finishReason = "Finish every working set at the same weight to establish progression.";

  if (consistent === null) {
    const qualifying = results.filter((set) => set.reps >= target.repMin);
    if (!qualifying.length)
      return suggestion(null, "No completed working set reached this plan's minimum reps. Choose a lighter starting weight.");
    const heaviest = Math.max(...qualifying.map((set) => set.weight));
    let weight: number;
    let evidence: WorkingResult;
    if (target.repMax <= 12) {
      evidence = qualifying.reduce((best, set) =>
        set.weight * (30 + set.reps) > best.weight * (30 + best.reps) ? set : best);
      weight = Math.min(heaviest, evidence.weight * (30 + evidence.reps) / (30 + target.repMax));
    } else {
      evidence = qualifying.reduce((best, set) => set.weight > best.weight ||
        (equal(set.weight, best.weight) && set.reps > best.reps) ? set : best);
      weight = Math.max(0, heaviest - (evidence.reps < target.repMax && validIncrement ? increment : 0));
    }
    if (validIncrement) weight = Math.floor((weight + 1e-8) / increment) * increment;
    return suggestion(weight,
      `You completed ${clean(evidence.weight)} ${unit} for ${evidence.reps} reps. Try ${clean(weight)} ${unit} across your working sets for the ${target.repMin}–${target.repMax} rep target. ` +
      (target.repMax > 12 ? "Higher-rep targets use demonstrated loads rather than estimated-strength extrapolation." : "This estimate uses your completed reps and rounds down to your available increment."));
  }

  const hold = (reason: string) => suggestion(consistent, reason);
  if (latestIndex > 0)
    return hold(`Hold ${clean(consistent)} ${unit}. A newer workout is unfinished; finish it before changing the working weight.`);
  if (!sameTargets(latest.item.target, target))
    return hold(`Hold ${clean(consistent)} ${unit} while you establish results for the changed sets or rep target.`);
  const previous = history[latestIndex + 1];
  if (!previous || previous.session.status !== "completed")
    return hold(`Hold ${clean(consistent)} ${unit}. Two consecutive finished workouts with matching targets are needed before changing the weight.`);
  const previousResults = workingResults(previous, unit);
  const workingCount = latest.item.sets.filter((set) => set.classification !== "warmup").length;
  const priorWorkingCount = previous.item.sets.filter((set) => set.classification !== "warmup").length;
  if (!sameTargets(previous.item.target, target) || workingCount !== priorWorkingCount)
    return hold(`Hold ${clean(consistent)} ${unit}. The previous workout used different working-set targets.`);
  if (uniformWeight(previousResults) === null || !equal(uniformWeight(previousResults)!, consistent))
    return hold(`Hold ${clean(consistent)} ${unit}. Previous working weights differ; establish two workouts at this load.`);
  if (results.length !== workingCount || previousResults.length !== priorWorkingCount)
    return hold(`Hold ${clean(consistent)} ${unit}. Skipped or incomplete working sets interrupt progression. ${finishReason}`);
  const upperReached = results.every((set) => set.reps >= target.repMax) &&
    previousResults.every((set) => set.reps >= target.repMax);
  const minimumMissed = results.some((set) => set.reps < target.repMin) &&
    previousResults.some((set) => set.reps < target.repMin);
  if (!upperReached && !minimumMissed)
    return hold(`Hold ${clean(consistent)} ${unit} while building reps. Every working set must reach ${target.repMax} reps in two consecutive finished workouts before an increase.`);
  if (upperReached && (dayDifference(date, latest.session.date) > 28 ||
    dayDifference(latest.session.date, previous.session.date) > 28))
    return hold(`Hold ${clean(consistent)} ${unit}. A training gap exceeding 28 days pauses automatic increases.`);
  if (!validIncrement || consistent <= 0 || increment / consistent > 0.1 + Number.EPSILON)
    return hold(`Hold ${clean(consistent)} ${unit}. The configured increment would exceed 10%; choose a smaller increment in Settings.`);
  if (minimumMissed)
    return suggestion(Math.max(0, consistent - increment),
      `A working set missed ${target.repMin} reps in each of two finished workouts at ${clean(consistent)} ${unit}. Reduce one increment to ${clean(Math.max(0, consistent - increment))} ${unit}.`);
  return suggestion(consistent + increment,
    `Every working set reached ${target.repMax} reps in two consecutive finished workouts at ${clean(consistent)} ${unit}. Increase one increment to ${clean(consistent + increment)} ${unit}.`);
}
