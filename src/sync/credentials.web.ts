import { validateCredentials, type SyncCredentials } from "./protocol";

let credentials: SyncCredentials | null = null;
let refreshToken: string | null = null;
function same(value: SyncCredentials): boolean {
  return credentials !== null &&
    JSON.stringify(validateCredentials(value)) === JSON.stringify(credentials);
}
export async function loadCredentials(): Promise<SyncCredentials | null> {
  return credentials ? { ...credentials } : null;
}
export async function saveCredentials(value: SyncCredentials): Promise<void> {
  try {
    const checked = validateCredentials(value);
    if (!same(checked)) refreshToken = null;
    credentials = checked;
  } catch {
    throw new Error("The cloud preview connection is invalid.");
  }
}
export async function loadRefreshToken(value: SyncCredentials): Promise<string | null> {
  return same(value) ? refreshToken : null;
}
export async function saveRefreshToken(value: SyncCredentials, token: string): Promise<void> {
  if (typeof token !== "string" || !/^[!-~]{1,16384}$/.test(token)) {
    throw new Error("The cloud preview authorization is invalid.");
  }
  if (same(value)) refreshToken = token;
}
export async function removeCredentials(): Promise<void> {
  credentials = null;
  refreshToken = null;
}
