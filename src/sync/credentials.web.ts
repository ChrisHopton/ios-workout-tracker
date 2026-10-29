import { resetCredentials, type ResetIntent } from "./reset";
import { sameIdentity, validateCredentials, type SyncCredentials, type AnonymousSyncCredentials } from "./protocol";

let credentials: SyncCredentials | null = null;
let refreshToken: string | null = null;
function same(value: SyncCredentials): boolean {
  const checked = validateCredentials(value);
  if (credentials && credentials.version !== 1 && checked.version !== 1) {
    return sameIdentity(credentials, checked) && credentials.apiKey === checked.apiKey;
  }
  return credentials !== null && JSON.stringify(checked) === JSON.stringify(credentials);
}
export async function loadCredentials(): Promise<SyncCredentials | null> {
  return credentials ? { ...credentials } : null;
}
export async function saveCredentials(value: SyncCredentials): Promise<void> {
  try {
    const checked = validateCredentials(value);
    if (!same(checked)) refreshToken = checked.version !== 1 ? checked.refreshToken : null;
    credentials = checked.version !== 1 && refreshToken ? { ...checked, refreshToken } : checked;
  } catch {
    throw new Error("The cloud preview connection is invalid.");
  }
}
export async function loadRefreshToken(value: SyncCredentials): Promise<string | null> {
  return same(value) ? refreshToken ?? (credentials && credentials.version !== 1 ? credentials.refreshToken : null) : null;
}
export async function saveRefreshToken(value: SyncCredentials, token: string): Promise<void> {
  if (typeof token !== "string" || !/^[!-~]{1,16384}$/.test(token)) {
    throw new Error("The cloud preview authorization is invalid.");
  }
  if (same(value)) {
    refreshToken = token;
    if (credentials && credentials.version !== 1) credentials = { ...credentials, refreshToken: token };
  }
}
export async function removeCredentials(): Promise<void> {
  credentials = null;
  refreshToken = null;
}

export async function migrateResetCredentials(intent: ResetIntent): Promise<AnonymousSyncCredentials | null> {
  const next = resetCredentials(credentials, refreshToken, intent);
  if (next) await saveCredentials(next);
  return next;
}
