import { sameIdentity, validateCredentials, validateIdentity, type AnonymousSyncCredentials, type SyncCredentials, type SyncIdentity } from "./protocol";
import { validateBootstrap, type BootstrapDraft } from "./bootstrapDraft";

export const FRESH_START_EPOCH = "profile-onboarding-2026-10";
export interface ResetIntent {
  version: 1;
  epoch: typeof FRESH_START_EPOCH;
  sources: SyncIdentity[];
  bootstrap: BootstrapDraft | null;
  target: { deviceId: string; generationId: string; installationId: string };
}
export function validateResetIntent(value: unknown): ResetIntent {
  const intent = value as ResetIntent;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  if (!intent || typeof intent !== "object" || Array.isArray(intent) ||
      Object.keys(intent).sort().join(",") !== "bootstrap,epoch,sources,target,version" ||
      intent.version !== 1 || intent.epoch !== FRESH_START_EPOCH || !Array.isArray(intent.sources) || intent.sources.length > 2 ||
      !intent.target || Object.keys(intent.target).sort().join(",") !== "deviceId,generationId,installationId" ||
      !Object.values(intent.target).every(id => typeof id === "string" && uuid.test(id)))
    throw new Error("The saved fresh start identity needs attention.");
  for (const source of intent.sources) {
    const identity = validateIdentity(source);
    if (Object.keys(source).sort().join(",") !== Object.keys(identity).sort().join(","))
      throw new Error("The saved fresh start identity needs attention.");
  }
  if (intent.bootstrap !== null) validateBootstrap(intent.bootstrap);
  if (!intent.sources.length && !intent.bootstrap) throw new Error("The saved fresh start has no source identity.");
  return intent;
}
function matchesDraft(credentials: SyncCredentials, draft: BootstrapDraft | null): boolean {
  return !!draft && credentials.projectId === draft.projectId && credentials.deviceId === draft.deviceId && credentials.generationId === draft.generationId;
}
/** Pure half of the serialized secure-store rewrite; secrets never enter the SQLite intent. */
export function resetCredentials(value: SyncCredentials | null, refreshToken: string | null, candidate: ResetIntent): AnonymousSyncCredentials | null {
  const intent = validateResetIntent(candidate);
  if (!value) {
    if (intent.sources.length) throw new Error("The saved cloud identity is missing. Uploads need repair.");
    return null; // A persisted bootstrap can precede its first successful signup.
  }
  const saved = validateCredentials(value);
  const source = intent.sources.find(identity => sameIdentity(identity, saved));
  const previousAutomatic = intent.sources.find(identity => identity.layout === "automatic" && identity.uid === saved.uid && identity.deviceId === saved.deviceId && identity.projectId === saved.projectId);
  if (saved.version === 3 && saved.generationId === intent.target.generationId &&
      (previousAutomatic || (intent.bootstrap && saved.deviceId === intent.bootstrap.deviceId && saved.projectId === intent.bootstrap.projectId) || saved.deviceId === intent.target.deviceId)) return validateCredentials({ ...saved, refreshToken: refreshToken ?? saved.refreshToken }) as AnonymousSyncCredentials;
  if (!source && !matchesDraft(saved, intent.bootstrap))
    throw new Error("The saved cloud identity does not match the fresh start. Uploads need repair.");
  if (saved.version === 1) return null; // This deliberate migration is the only legacy-account replacement.
  if (saved.version !== 2) throw new Error("The fresh start identity changed. Uploads need repair.");
  return validateCredentials({ ...saved, version: 3, generationId: intent.target.generationId,
    refreshToken: refreshToken ?? saved.refreshToken }) as AnonymousSyncCredentials;
}
