import { removeBodyWeight, saveBodyWeight } from "../domain/bodyWeight";
import { convertWeight, numericWeight } from "../domain/recommendations";
import type { AppData, Unit } from "../domain/types";

export type BodyWeightDraft = {
  date: string;
  weight: string;
  unit: Unit;
  id?: string;
  canonicalKg: number | null;
};

export function convertBodyWeightDraft(weight: string, from: Unit, to: Unit, canonicalKg: number | null) {
  const numeric = numericWeight(weight);
  const kg = canonicalKg ?? (numeric === null ? null : convertWeight(numeric, from, "kg"));
  return {
    weight: kg === null ? weight : String(Math.round(convertWeight(kg, "kg", to) * 1000) / 1000),
    canonicalKg: kg,
  };
}

export type SavedBodyWeightDraft = { id: string; date: string };

export function saveBodyWeightDraft(data: AppData, draft: BodyWeightDraft, asOf: string, saved?: SavedBodyWeightDraft | null) {
  // The quick entry updates today's record; explicit history edits keep duplicate-date validation.
  const id = draft.id ?? (saved?.date === draft.date ? saved.id : undefined) ?? (draft.date === asOf
    ? data.bodyWeights.find((entry) => entry.date === asOf)?.id : undefined);
  const text = draft.canonicalKg === null ? draft.weight : String(convertWeight(draft.canonicalKg, "kg", draft.unit));
  const next = saveBodyWeight(data, draft.date, text, draft.unit, id, asOf);
  const entry = next.bodyWeights.find((item) => id ? item.id === id : item.date === draft.date)!;
  if (draft.canonicalKg !== null) {
    const exact = { ...entry, weightKg: draft.canonicalKg };
    return { data: { ...next, bodyWeights: next.bodyWeights.map((item) => item.id === exact.id ? exact : item) }, entry: exact };
  }
  return { data: next, entry };
}

export function removeBodyWeightDraft(data: AppData, entryId: string, editingId: string | undefined, saved: SavedBodyWeightDraft | null) {
  return {
    data: removeBodyWeight(data, entryId),
    id: editingId === entryId ? undefined : editingId,
    saved: saved?.id === entryId ? null : saved,
    detached: editingId === entryId || saved?.id === entryId,
  };
}