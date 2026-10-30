import { SessionExercise, Unit } from "../domain/types";

export function nextStepForDisplay(item: SessionExercise, unit: Unit): string {
  const target = `${item.target.sets} sets × ${item.target.repMin}–${item.target.repMax} reps`;
  if (item.exercise.equipment === "bodyweight") return target;
  const weights = item.suggestion.weights;
  if (!weights.length || weights.some((value) => value === null))
    return `Choose a starting weight · ${target}`;
  const loads = [...new Set(weights)].map((value) => String(value));
  return loads.length === 1
    ? `${loads[0]} ${unit} · ${target}`
    : `${weights.join(" / ")} ${unit} · ${target}`;
}
