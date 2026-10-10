import { openDatabaseAsync } from "expo-sqlite";
import { AppData } from "../domain/types";
import { parseBackup } from "../domain/backup";
import { initialData } from "../domain/library";
import { createRetryableResource } from "./retryableResource";

// Open lazily, and discard rejected open attempts so the loading screen's Try again works.
const getDatabase = createRetryableResource(() =>
  openDatabaseAsync("workout.db"),
);
export async function loadData(): Promise<AppData> {
  const db = await getDatabase();
  await db.execAsync(
    "PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS app_state (id INTEGER PRIMARY KEY CHECK (id = 1), value TEXT NOT NULL); PRAGMA user_version = 1;",
  );
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM app_state WHERE id = 1",
  );
  return row ? parseBackup(row.value) : initialData();
}
export async function writeData(data: AppData): Promise<void> {
  const serialized = JSON.stringify(data);
  parseBackup(serialized);
  const db = await getDatabase();
  // A single SQLite statement commits the full snapshot or leaves the previous row intact.
  await db.runAsync(
    "INSERT INTO app_state (id,value) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
    serialized,
  );
}
