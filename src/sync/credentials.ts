import { resetCredentials, type ResetIntent } from "./reset";
import * as SecureStore from "expo-secure-store";
import { sameIdentity, validateCredentials, type SyncCredentials, type AnonymousSyncCredentials } from "./protocol";

const KEY = "workout.firebase.credentials.v1";
const LEGACY_KEY = "workout.sheets.credentials.v1";
const OPTIONS = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
interface StoredCredentials {
  credentials: SyncCredentials;
  refreshToken: string | null;
}
let tail: Promise<unknown> = Promise.resolve();

function serial<T>(operation: () => Promise<T>): Promise<T> {
  const result = tail.then(operation);
  tail = result.catch(() => undefined);
  return result;
}
function same(left: SyncCredentials, right: SyncCredentials): boolean {
  const a = validateCredentials(left);
  const b = validateCredentials(right);
  if (a.version !== 1 && b.version !== 1) return sameIdentity(a, b) && a.apiKey === b.apiKey;
  return JSON.stringify(a) === JSON.stringify(b);
}
function token(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !/^[!-~]{1,16384}$/.test(value)) throw new Error();
  return value;
}
class InvalidStoredCredentials extends Error {}
async function read(): Promise<StoredCredentials | null> {
  // Storage errors (for example a locked keychain) must not be treated as missing/corrupt data.
  const text = await SecureStore.getItemAsync(KEY, OPTIONS);
  if (text === null) return null;
  try {
    const value: unknown = JSON.parse(text);
    if (
      !value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).length !== 2 ||
      !Object.hasOwn(value, "credentials") || !Object.hasOwn(value, "refreshToken")
    ) throw new Error();
    const stored = value as StoredCredentials;
    return {
      credentials: validateCredentials(stored.credentials),
      refreshToken: token(stored.refreshToken),
    };
  } catch {
    throw new InvalidStoredCredentials();
  }
}

export function loadCredentials(): Promise<SyncCredentials | null> {
  return serial(async () => {
    try {
      await SecureStore.deleteItemAsync(LEGACY_KEY, OPTIONS);
      return (await read())?.credentials ?? null;
    } catch {
      throw new Error("The saved cloud connection could not be read. Unlock your phone and try again.");
    }
  });
}
export function saveCredentials(credentials: SyncCredentials): Promise<void> {
  return serial(async () => {
    try {
      const checked = validateCredentials(credentials);
      let previous: StoredCredentials | null = null;
      try { previous = await read(); } catch (error) {
        if (!(error instanceof InvalidStoredCredentials)) throw error;
      }
      const refreshToken = previous && same(previous.credentials, checked)
        ? previous.refreshToken ?? (previous.credentials.version !== 1 ? previous.credentials.refreshToken : null)
        : checked.version !== 1 ? checked.refreshToken : null;
      await SecureStore.setItemAsync(KEY, JSON.stringify({
        credentials: checked.version !== 1 && refreshToken ? { ...checked, refreshToken } : checked,
        refreshToken,
      }), OPTIONS);
      await SecureStore.deleteItemAsync(LEGACY_KEY, OPTIONS);
    } catch {
      throw new Error("The cloud connection could not be saved securely. Try again.");
    }
  });
}
export function loadRefreshToken(credentials: SyncCredentials): Promise<string | null> {
  return serial(async () => {
    try {
      const stored = await read();
      return stored && same(stored.credentials, credentials)
        ? stored.refreshToken ?? (stored.credentials.version !== 1 ? stored.credentials.refreshToken : null)
        : null;
    } catch {
      throw new Error("The saved cloud authorization could not be read. Unlock your phone and try again.");
    }
  });
}
export function saveRefreshToken(credentials: SyncCredentials, refreshToken: string): Promise<void> {
  return serial(async () => {
    try {
      const checked = token(refreshToken);
      const stored = await read();
      if (!stored || !same(stored.credentials, credentials) || stored.refreshToken === checked) return;
      await SecureStore.setItemAsync(KEY, JSON.stringify({
        credentials: stored.credentials.version !== 1 ? { ...stored.credentials, refreshToken: checked } : stored.credentials,
        refreshToken: checked,
      }), OPTIONS);
    } catch {
      throw new Error("Cloud authorization could not be saved securely. Try again.");
    }
  });
}
export function removeCredentials(): Promise<void> {
  return serial(async () => {
    let failed = false;
    try { await SecureStore.deleteItemAsync(KEY, OPTIONS); } catch { failed = true; }
    try { await SecureStore.deleteItemAsync(LEGACY_KEY, OPTIONS); } catch { failed = true; }
    if (failed) throw new Error("The saved cloud connection could not be removed. Try again.");
  });
}

/** Preserve the latest token and accept either side of a crash between SQLite and Keychain. */
export function migrateResetCredentials(intent: ResetIntent): Promise<AnonymousSyncCredentials | null> {
  return serial(async () => {
    const stored = await read();
    const next = resetCredentials(stored?.credentials ?? null, stored?.refreshToken ?? null, intent);
    if (next) await SecureStore.setItemAsync(KEY, JSON.stringify({ credentials: next, refreshToken: next.refreshToken }), OPTIONS);
    return next;
  });
}
