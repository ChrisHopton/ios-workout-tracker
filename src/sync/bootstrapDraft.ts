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
