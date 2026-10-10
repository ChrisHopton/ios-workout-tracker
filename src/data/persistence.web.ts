import { AppData } from "../domain/types";
import { initialData } from "../domain/library";
import { parseBackup } from "../domain/backup";
// Browser preview only. Native iOS uses persistence.ts and SQLite.
const key = "workout-browser-preview-v1";
export async function loadData(): Promise<AppData> {
  const value = localStorage.getItem(key);
  return value ? parseBackup(value) : initialData();
}
export async function writeData(data: AppData): Promise<void> {
  localStorage.setItem(key, JSON.stringify(data));
}
