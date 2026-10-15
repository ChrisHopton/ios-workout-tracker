import { parseDate, today } from "./dates";
import { convertWeight, numericWeight } from "./recommendations";
import { AppData, BodyWeightEntry, newId, Unit } from "./types";

export function latestBodyWeight(entries: BodyWeightEntry[], date: string): BodyWeightEntry | null {
  parseDate(date);
  let latest: BodyWeightEntry | null = null;
  for (const entry of entries) {
    if (entry.date > date) continue;
    if (!latest || entry.date > latest.date ||
      (entry.date === latest.date && entry.updatedAt > latest.updatedAt)) latest = entry;
  }
  return latest;
}

export function saveBodyWeight(
  data: AppData,
  date: string,
  weightText: string,
  unit: Unit,
  id?: string,
  asOf = today(),
): AppData {
  parseDate(date);
  parseDate(asOf);
  if (date > asOf) throw new Error("Body weight cannot be recorded for a future date.");
  const weight = numericWeight(weightText);
  const weightKg = weight === null ? null : convertWeight(weight, unit, "kg");
  if (weightKg === null || weightKg <= 0 || weightKg > 500)
    throw new Error("Enter a body weight greater than zero and no more than 500 kg (1,102 lb).");
  if (id && !data.bodyWeights.some((entry) => entry.id === id))
    throw new Error("This measurement no longer exists. Cancel editing and add a new entry.");
  const duplicate = data.bodyWeights.find((entry) => entry.date === date && entry.id !== id);
  if (duplicate) throw new Error("A measurement already exists for this date. Edit that entry instead.");
  const entry: BodyWeightEntry = { id: id ?? newId("body-weight"), date, weightKg, updatedAt: new Date().toISOString() };
  return {
    ...data,
    bodyWeights: id
      ? data.bodyWeights.map((current) => current.id === id ? entry : current)
      : [...data.bodyWeights, entry],
  };
}

export function removeBodyWeight(data: AppData, id: string): AppData {
  return { ...data, bodyWeights: data.bodyWeights.filter((entry) => entry.id !== id) };
}
