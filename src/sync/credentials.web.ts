import { validateCredentials, type SyncCredentials } from "./protocol";

let credentials: SyncCredentials | null = null;

export async function loadCredentials(): Promise<SyncCredentials | null> {
  return credentials ? { ...credentials } : null;
}

export async function saveCredentials(value: SyncCredentials): Promise<void> {
  try {
    credentials = validateCredentials(value);
  } catch {
    throw new Error("The Sheets preview connection is invalid.");
  }
}

export async function removeCredentials(): Promise<void> {
  credentials = null;
}