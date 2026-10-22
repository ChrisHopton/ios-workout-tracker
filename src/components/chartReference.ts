export interface ChartReference { value: number; label: string }
export function chartScale(values: readonly number[], reference?: ChartReference) {
  const validReference = reference && Number.isFinite(reference.value) && reference.value > 0 ? reference : undefined;
  return { max: Math.max(1, ...values.filter(Number.isFinite), validReference?.value ?? 0), reference: validReference };
}
