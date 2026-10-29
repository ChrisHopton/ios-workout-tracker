import { validateResetIntent } from "./reset";
import type { SyncRepository, SyncSecrets } from "./controller";
import { identityOf, sameIdentity, type AnonymousSyncCredentials } from "./protocol";
import { SyncError } from "./transport";

import { automaticPhoneLabel, validateBootstrap } from "./bootstrapDraft";
export { automaticPhoneLabel, validateBootstrap, type BootstrapDraft } from "./bootstrapDraft";

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
    const reset = await repository.pendingReset?.();
    if (reset) {
      const intent = validateResetIntent(reset);
      if (!secrets.migrateReset || !repository.completeReset) throw new SyncError("The fresh start cannot finish in this build.", false, "storage");
      if (intent.sources.some(source => source.projectId !== options.projectId) ||
          (intent.bootstrap && intent.bootstrap.projectId !== options.projectId))
        throw new SyncError("The upload project has changed. Contact the app owner.", false, "invalid");
      const reconciled = await secrets.migrateReset(intent);
      let credentials = reconciled ?? pendingCredentials;
      if (!credentials) {
        if (!canSend()) return false;
        credentials = await options.signup({ deviceId: intent.target.deviceId, generationId: intent.target.generationId }, canSend);
        pendingCredentials = credentials;
      }
      if (credentials.version !== 3 || credentials.projectId !== options.projectId || credentials.generationId !== intent.target.generationId ||
          (!reconciled && credentials.deviceId !== intent.target.deviceId))
        throw new SyncError("The fresh start identity could not be verified.", false, "invalid");
      await secrets.save(credentials);
      await repository.completeReset(intent, identityOf(credentials), automaticPhoneLabel(options.modelName, intent.target.installationId));
      pendingCredentials = null;
      return true;
    }
    const [state, staged, saved] = await Promise.all([
      repository.state(), repository.pendingEnrollment(), secrets.load(),
    ]);
    if (state || staged) {
      if (saved?.version === 3 && ((state?.enabled && state.bound && sameIdentity(state, saved)) || sameIdentity(staged, saved))) return true;
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
    let credentials = saved?.version === 3 && matchesDraft(saved) ? saved :
      pendingCredentials && matchesDraft(pendingCredentials) ? pendingCredentials : null;
    if (!credentials) {
      if (!canSend()) return false;
      credentials = await options.signup({ deviceId: draft.deviceId, generationId: draft.generationId }, canSend);
      pendingCredentials = credentials;
      if (credentials.version !== 3 || !matchesDraft(credentials)) throw new SyncError("The new upload identity could not be verified.", false, "invalid");
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
