import type { SyncRepository, SyncSecrets } from "./controller";
import { identityOf, sameIdentity, type AnonymousSyncCredentials } from "./protocol";
import { SyncError } from "./transport";

export interface BootstrapDraft {
  version: 1;
  projectId: string;
  deviceId: string;
  generationId: string;
  installationId: string;
  label: string;
}
export function validateBootstrap(value: unknown): BootstrapDraft {
  const draft = value as BootstrapDraft;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  if (!draft || typeof draft !== "object" || Array.isArray(draft) ||
      Object.keys(draft).sort().join(",") !== "deviceId,generationId,installationId,label,projectId,version" ||
      draft.version !== 1 || typeof draft.projectId !== "string" || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(draft.projectId) ||
      ![draft.deviceId, draft.generationId, draft.installationId].every((id) => typeof id === "string" && uuid.test(id)) ||
      typeof draft.label !== "string" || !draft.label.trim() || draft.label.length > 80) {
    throw new SyncError("The saved upload setup needs attention. Your workouts remain on this phone.", false, "storage");
  }
  return draft;
}
export function automaticPhoneLabel(model: string | null, installationId: string): string {
  const suffix = installationId.replace(/-/g, "").slice(-6).toUpperCase();
  return `${(model?.trim() || "iPhone").slice(0, 68)} · ${suffix}`;
}
export interface BootstrapOptions {
  projectId: string;
  apiKey: string;
  modelName: string | null;
  createId: () => string;
  signup: (identity: { deviceId: string; generationId: string }, canSend: () => boolean) => Promise<AnonymousSyncCredentials>;
}
/** Runs before the upload controller. No network data is written until secure identity persistence succeeds. */
export function createAutomaticBootstrap(repository: SyncRepository, secrets: SyncSecrets, options: BootstrapOptions) {
  let pendingCredentials: AnonymousSyncCredentials | null = null;
  let running: Promise<boolean> | null = null;
  async function prepare(canSend: () => boolean): Promise<boolean> {
    const [state, staged, saved] = await Promise.all([
      repository.state(), repository.pendingEnrollment(), secrets.load(),
    ]);
    if (state || staged) {
      if (saved && ((state?.enabled && state.bound && sameIdentity(state, saved)) || sameIdentity(staged, saved))) return true;
      throw new SyncError("The saved upload identity needs attention. Your workouts remain on this phone.", false, "storage");
    }
    if (!repository.prepareBootstrap) throw new SyncError("Automatic uploads are unavailable in this build.", false, "invalid");
    const installationId = options.createId();
    // The repository refuses any orphaned queue/history/revision state. A surviving Keychain entry
    // alone can belong to an uninstalled app, so a proven fresh local installation gets a new UID.
    const draft = await repository.prepareBootstrap(validateBootstrap({
      version: 1, projectId: options.projectId, deviceId: options.createId(),
      generationId: options.createId(), installationId,
      label: automaticPhoneLabel(options.modelName, installationId),
    }));
    if (draft.projectId !== options.projectId) throw new SyncError("The upload project has changed. Contact the app owner.", false, "invalid");
    const matchesDraft = (value: AnonymousSyncCredentials) => value.projectId === draft.projectId &&
      value.deviceId === draft.deviceId && value.generationId === draft.generationId;
    let credentials = saved?.version === 2 && matchesDraft(saved) ? saved :
      pendingCredentials && matchesDraft(pendingCredentials) ? pendingCredentials : null;
    if (!credentials) {
      if (!canSend()) return false;
      credentials = await options.signup({ deviceId: draft.deviceId, generationId: draft.generationId }, canSend);
      pendingCredentials = credentials;
      if (!matchesDraft(credentials)) throw new SyncError("The new upload identity could not be verified.", false, "invalid");
    }
    // Keep an authenticated result in memory if the Keychain write fails, rather than creating
    // another account on every retry. A crash before persistence may leave an empty Auth account.
    await secrets.save(credentials);
    await repository.prepareEnrollment(identityOf(credentials), draft.label, draft.installationId);
    pendingCredentials = null;
    return true;
  }
  return (canSend: () => boolean): Promise<boolean> => {
    running ??= prepare(canSend).finally(() => { running = null; });
    return running;
  };
}
