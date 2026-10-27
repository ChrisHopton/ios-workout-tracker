import { ExerciseHistory } from "../../domain/analytics";
import { Equipment, MuscleGroup } from "../../domain/types";

export const ANALYTICS_PERIODS = [4, 8, 12] as const;
export type AnalyticsPeriod = typeof ANALYTICS_PERIODS[number];
export type ProgressMetric = "weight" | "reps" | "strength";
export type ExerciseFilter = MuscleGroup | "All";

export function recentExercises(histories: readonly ExerciseHistory[], limit = 5): ExerciseHistory[] {
  return histories.filter((history) => history.points.length > 0).sort((a, b) =>
    b.points[b.points.length - 1].date.localeCompare(a.points[a.points.length - 1].date)
    || a.name.localeCompare(b.name) || a.variantId.localeCompare(b.variantId),
  ).slice(0, limit);
}

export function filterExercises(histories: readonly ExerciseHistory[], query: string, group: ExerciseFilter): ExerciseHistory[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return recentExercises(histories, histories.length).filter((history) => {
    const label = `${history.name} ${history.equipment} ${history.group}`.toLocaleLowerCase();
    return (group === "All" || history.group === group) && terms.every((term) => label.includes(term));
  });
}

export function exerciseRoute(variantId: string) {
  return { pathname: "/analytics-exercise" as const, params: { variantId } };
}

export function selectedExercise(histories: readonly ExerciseHistory[], variantId: string | string[] | undefined): ExerciseHistory | undefined {
  // A missing or stale link must never silently open a different exercise or equipment variant.
  return typeof variantId === "string" ? histories.find((history) => history.variantId === variantId) : undefined;
}

export function effectiveMetric(equipment: Equipment, metric: ProgressMetric): ProgressMetric {
  return equipment === "bodyweight" ? "reps" : metric;
}

export const round = (value: number) => Math.round(value * 100) / 100;
