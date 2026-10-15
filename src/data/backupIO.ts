import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import * as DocumentPicker from "expo-document-picker";
import type { AppData } from "../domain/types";
import { validateStoredData, serializeStoredBackup, MAX_BACKUP_BYTES, type LegacyAppData } from "../domain/backup";
export async function exportFile(text: string): Promise<void> {
  if (!(await Sharing.isAvailableAsync()))
    throw new Error("File sharing is unavailable on this device.");
  const file = new File(
    Paths.cache,
    "workout-backup-" +
      new Date().toISOString().replace(/[:.]/g, "-") +
      ".json",
  );
  file.create();
  file.write(text);
  try {
    await Sharing.shareAsync(file.uri, {
      mimeType: "application/json",
      UTI: "public.json",
      dialogTitle: "Save your Workout backup",
    });
  } finally {
    if (file.exists) file.delete();
  }
}
export async function importFile(): Promise<string | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ["application/json", "text/plain"],
    copyToCacheDirectory: true,
  });
  if (result.canceled) return null;
  const asset = result.assets[0];
  const file = new File(asset.uri);
  try {
    if ((asset.size ?? file.size) > MAX_BACKUP_BYTES)
      throw new Error("Choose a backup smaller than 10 MiB.");
    return await file.text();
  } finally {
    if (file.exists) file.delete();
  }
}

export async function preserveMigrationBackup(data: AppData | LegacyAppData, fromVersion: number, toVersion: number): Promise<void> {
  const name = `workout-before-v${fromVersion}-to-v${toVersion}`;
  const backup = new File(Paths.document, name + ".json");
  if (backup.exists) { validateStoredData(JSON.parse(await backup.text())); return; }
  const temporary = new File(Paths.document, name + ".tmp");
  temporary.create({ overwrite: true });
  temporary.write(serializeStoredBackup(data));
  validateStoredData(JSON.parse(await temporary.text()));
  temporary.move(backup);
}
function latestMigrationBackup(): File | undefined {
  return Paths.document.list().filter((entry): entry is File => entry instanceof File && /^workout-before-(?:v\d+-to-v\d+|firestore)\.json$/.test(entry.name))
    .sort((a, b) => (b.modificationTime ?? 0) - (a.modificationTime ?? 0))[0];
}
export function migrationBackupAvailable(): boolean {
  return !!latestMigrationBackup();
}
export async function exportMigrationBackup(): Promise<void> {
  const backup = latestMigrationBackup();
  if (!backup) throw new Error("No pre-migration backup is available.");
  const text = await backup.text();
  validateStoredData(JSON.parse(text));
  await exportFile(text);
}
