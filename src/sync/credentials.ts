import * as SecureStore from "expo-secure-store";
import { validateCredentials, type SyncCredentials } from "./protocol";

const KEY = "workout.sheets.credentials.v1";
const OPTIONS = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export async function loadCredentials(): Promise<SyncCredentials | null> {
  try {
    const value = await SecureStore.getItemAsync(KEY, OPTIONS);
    return value === null ? null : validateCredentials(JSON.parse(value));
  } catch {
    throw new Error("The saved Sheets connection could not be read. Reconnect and try again.");
  }
}

export async function saveCredentials(credentials: SyncCredentials): Promise<void> {
  try {
    await SecureStore.setItemAsync(
      KEY,
      JSON.stringify(validateCredentials(credentials)),
      OPTIONS,
    );
  } catch {
    throw new Error("The Sheets connection could not be saved securely. Try again.");
  }
}

export async function removeCredentials(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(KEY, OPTIONS);
  } catch {
    throw new Error("The saved Sheets connection could not be removed. Try again.");
  }
}