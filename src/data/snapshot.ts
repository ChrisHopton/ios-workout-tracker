import { validateData } from "../domain/backup";
import { AppData } from "../domain/types";

const validated = new WeakSet<AppData>();
const frozen = new WeakSet<object>();

function freeze(value: unknown): void {
  if (!value || typeof value !== "object" || frozen.has(value)) return;
  for (const child of Object.values(value)) freeze(child);
  Object.freeze(value);
  frozen.add(value);
}

export function snapshot(data: AppData, previous?: AppData): AppData {
  if (validated.has(data)) return data;
  validateData(
    data,
    previous && validated.has(previous) ? previous : undefined,
  );
  // Frozen branches can be shared safely by queued saves and the visible journal
  freeze(data);
  validated.add(data);
  return data;
}
