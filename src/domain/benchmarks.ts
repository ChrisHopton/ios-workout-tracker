import bodyTable from "../data/benchmarks/body-weight.json";
import strengthTable from "../data/benchmarks/strength.json";
import { dayDifference } from "./dates";
import { latestBodyWeight } from "./bodyWeight";
import { BodyWeightEntry, Equipment, ProfileSettings } from "./types";

export type ReferenceGroup = "female" | "male";
export interface Cohort {
  group: string;
  ageMin: number;
  ageMax: number | null;
  lower: number;
  upper: number;
  count: number;
}
export interface BodyCohort extends Cohort {
  effectiveCount: number;
  meanKg: number | null;
}
export interface StrengthCohort extends Cohort {
  squatKg: number | null;
  benchKg: number | null;
  deadliftKg: number | null;
}
export type Benchmark =
  | { available: false; reason: string }
  | { available: true; valueKg: number; cohort: Cohort; widerBand: boolean };
const insufficient = { available: false, reason: "Not enough matching data." } as const;
const liftFields = {
  "exercise-barbell-squat": "squatKg",
  "exercise-bench-press": "benchKg",
  "exercise-deadlift": "deadliftKg",
} as const;

export function referenceGroupForGender(gender: string): ReferenceGroup | null {
  const normalized = gender.trim().toLowerCase();
  return normalized === "female" || normalized === "male" ? normalized : null;
}
function profileAge(age: string): number | null {
  return /^\d+$/.test(age) && Number(age) >= 1 && Number(age) <= 130 ? Number(age) : null;
}
function matches(row: Cohort, group: ReferenceGroup, age: number, size: number, width: number) {
  return row.group === group && row.ageMin <= age && (row.ageMax === null || age <= row.ageMax)
    && row.lower === Math.floor(size / width) * width && row.upper === row.lower + width;
}
export function bodyWeightBenchmark(
  profile: Pick<ProfileSettings, "age" | "heightCm">,
  group: ReferenceGroup | null,
  rows: readonly BodyCohort[] = bodyTable.cohorts,
): Benchmark {
  if (!group) return { available: false, reason: "Choose a reference group in Comparison details." };
  const age = profileAge(profile.age);
  if (age === null || profile.heightCm === null) return { available: false, reason: "Add age and height in Settings to compare." };
  if (age < 20 || !Number.isFinite(profile.heightCm) || profile.heightCm <= 0) return insufficient;
  for (const width of [10, 20]) {
    const row = rows.find((entry) => matches(entry, group, age, profile.heightCm!, width));
    if (row && row.count >= 100 && row.effectiveCount >= 50 && row.meanKg !== null && Number.isFinite(row.meanKg) && row.meanKg > 0)
      return { available: true, valueKg: row.meanKg, cohort: row, widerBand: width === 20 };
  }
  return insufficient;
}
export function supportsStrengthBenchmark(exerciseId: string, equipment: Equipment): boolean {
  return equipment === "barbell" && Object.hasOwn(liftFields, exerciseId);
}
export function strengthBenchmark(
  exerciseId: string,
  equipment: Equipment,
  ageText: string,
  group: ReferenceGroup | null,
  weightKg: number | null,
  rows: readonly StrengthCohort[] = strengthTable.cohorts,
): Benchmark {
  if (!supportsStrengthBenchmark(exerciseId, equipment)) return { available: false, reason: "No matching benchmark for this exercise and equipment." };
  if (!group) return { available: false, reason: "Choose a reference group in Comparison details." };
  const age = profileAge(ageText);
  if (age === null || weightKg === null) return { available: false, reason: "Add age and body weight in Settings to compare." };
  if (age < 18 || !Number.isFinite(weightKg) || weightKg <= 0) return insufficient;
  const field = liftFields[exerciseId as keyof typeof liftFields];
  for (const width of [10, 20]) {
    const row = rows.find((entry) => matches(entry, group, age, weightKg, width));
    const value = row?.[field];
    if (row && row.count >= 100 && value != null && Number.isFinite(value) && value > 0)
      return { available: true, valueKg: value, cohort: row, widerBand: width === 20 };
  }
  return insufficient;
}
export function benchmarkMeasurement(entries: BodyWeightEntry[], asOf: string) {
  const measurement = latestBodyWeight(entries, asOf);
  return measurement ? { ...measurement, stale: dayDifference(asOf, measurement.date) > 28 } : null;
}
export function cohortLabel(cohort: Cohort, size: "height" | "weight"): string {
  const age = cohort.ageMax === null ? cohort.ageMin + "+" : cohort.ageMin + "–" + cohort.ageMax;
  return (cohort.group === "female" ? "Female" : "Male") + " · age " + age + " · "
    + cohort.lower + "–<" + cohort.upper + (size === "height" ? " cm tall" : " kg body weight");
}
