import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import * as DocumentPicker from "expo-document-picker";
import { MAX_BACKUP_BYTES } from "../domain/backup";
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
