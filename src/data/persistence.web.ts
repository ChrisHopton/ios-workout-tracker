import { FRESH_START_EPOCH } from "../sync/reset";
import { validateBootstrap, type BootstrapDraft } from "../sync/bootstrap";
import type { AppData } from "../domain/types";
import { initialData } from "../domain/library";
import { snapshot } from "./snapshot";
import { upgradeData, validateStoredData, type StoredAppData } from "../domain/backup";
import { changedRows, makeProfileDocument, makeCompletionDocument, projectData } from "../sync/projection";
import type { SyncLocalState, SyncRepository } from "../sync/controller";
import { makeBatch, sameIdentity, type DocumentChange, type UploadBatch, type UploadDocument } from "../sync/protocol";

let syncState: SyncLocalState | null = null;
let staging: SyncLocalState | null = null;
let priorData: AppData | null = null;
let frozen: UploadBatch | null = null;
const outbox = new Map<string, DocumentChange>();
const known = new Map<string, UploadDocument>();
const key = "workout-browser-preview-v1";
const same = sameIdentity;
let bootstrap: BootstrapDraft | null = null;
const lifecycleKey = "workout-browser-lifecycle";
const dataKey = "workout-browser-preview-v3";
export async function loadData(): Promise<AppData> {
  const marker = localStorage.getItem(lifecycleKey);
  if (marker !== null && marker !== FRESH_START_EPOCH) throw new Error("The browser preview lifecycle needs attention.");
  if (marker === null) {
    // The single new data slot is authoritative. Retrying a failed marker write only repeats this
    // reset before onboarding has ever been shown; a completed marker never erases new work.
    localStorage.setItem(dataKey, JSON.stringify(initialData()));
    localStorage.removeItem(key);
    localStorage.removeItem("workout-browser-before-v1-to-v2");
    localStorage.setItem(lifecycleKey, FRESH_START_EPOCH);
    syncState = null; staging = null; frozen = null; bootstrap = null; outbox.clear(); known.clear();
  }
  const value = localStorage.getItem(dataKey);
  if (!value) throw new Error("The browser preview journal is missing.");
  const stored = validateStoredData(JSON.parse(value));
  const next = snapshot(upgradeData(stored));
  if (stored.schemaVersion !== 4) {
    const recoveryKey = "workout-browser-before-v" + stored.schemaVersion + "-to-v4";
    const recovery = localStorage.getItem(recoveryKey);
    if (recovery !== null) {
      if (validateStoredData(JSON.parse(recovery)).schemaVersion !== stored.schemaVersion)
        throw new Error("The browser recovery copy needs attention.");
    } else localStorage.setItem(recoveryKey, value);
    persist(next, stored);
  } else priorData = next;
  return next;
}
function persist(data: AppData, before: StoredAppData | null) {
  const changes = syncState?.enabled && before
    ? changedRows(projectData(before, syncState.deviceId, syncState.label), projectData(data, syncState.deviceId, syncState.label)) : [];
  const revision = syncState && changes.length ? syncState.clock + 1 : null;
  if (revision !== null && !Number.isSafeInteger(revision)) throw new Error("The preview upload revision needs attention.");
  // Compute and validate the upload delta before the only durable browser write.
  localStorage.setItem(dataKey, JSON.stringify(data));
  if (syncState && revision !== null) {
    syncState.clock = revision;
    changes.forEach(doc => { outbox.set(doc.key, { ...doc, revision }); if (!doc.deleted) known.set(doc.key, doc); });
  }
  priorData = data;
}
export async function writeData(data: AppData): Promise<void> {
  persist(snapshot(data, priorData ?? undefined), priorData);
}
export const syncRepository: SyncRepository = {
  prepareBootstrap: async (candidate) => { bootstrap ??= validateBootstrap(candidate); return { ...bootstrap }; },
  state: async () => syncState ? { ...syncState } : null,
  pendingEnrollment: async () => staging ? { ...staging } : null,
  prepareEnrollment: async (identity, label, installationId) => {
    const prior = same(syncState, identity) ? syncState : same(staging, identity) ? staging : null;
    staging = prior ? { ...prior, label } : { ...identity, label, installationId, clock: 0, lastSyncedAt: null, enabled: false, bound: false, initialComplete: false };
    return { ...staging };
  },
  activateEnrollment: async (candidate) => {
    const data = priorData ?? await loadData();
    const retained = same(syncState, candidate);
    const enabled = syncState?.enabled;
    syncState = { ...(retained ? syncState! : candidate), label: candidate.label, enabled: true, bound: true };
    staging = null;
    bootstrap = null;
    if (!retained) { outbox.clear(); known.clear(); frozen = null; }
    if (!retained || !enabled) {
      const revision = ++syncState.clock;
      const docs = projectData(data, syncState.deviceId, syncState.label);
      const keys = new Set(docs.map((doc) => doc.key));
      for (const doc of known.values()) if (!keys.has(doc.key) && doc.kind !== "completion") outbox.set(doc.key, { ...doc, payload: {}, deleted: true, revision });
      docs.forEach((doc) => { outbox.set(doc.key, { ...doc, revision, deleted: false }); known.set(doc.key, doc); });
    } else {
      const doc = makeProfileDocument(data.settings, syncState.deviceId, syncState.label);
      outbox.set(doc.key, { ...doc, revision: ++syncState.clock, deleted: false });
    }
  },
  disconnect: async () => { if (syncState) syncState.enabled = false; staging = null; },
  setLabel: async (label) => {
    if (!syncState || !priorData) throw new Error("Connect the preview first.");
    syncState.label = label;
    const doc = makeProfileDocument(priorData.settings, syncState.deviceId, label);
    outbox.set(doc.key, { ...doc, revision: ++syncState.clock, deleted: false });
  },
  pendingCount: async () => outbox.size,
  inFlight: async () => {
    if (frozen) return frozen;
    if (!syncState?.enabled) return null;
    if (!outbox.size && !syncState.initialComplete) {
      const doc = makeCompletionDocument();
      outbox.set(doc.key, { ...doc, revision: ++syncState.clock, deleted: false });
    }
    const changes = makeBatch(syncState, [...outbox.values()], syncState.installationId).changes;
    if (!changes.length) return null;
    frozen = { id: changes.map((doc) => doc.key + "@" + doc.revision).join("|"), changes: JSON.parse(JSON.stringify(changes)) };
    return frozen;
  },
  reserveAttempt: async () => ({ allowed: true, retryAt: null }),
  acknowledge: async (batchId, acks, at) => {
    if (frozen?.id !== batchId) return;
    for (const ack of acks) {
      if (outbox.get(ack.key)?.revision === ack.revision) {
        if (outbox.get(ack.key)?.deleted) known.delete(ack.key);
        outbox.delete(ack.key);
      }
      if (frozen.changes.find((doc) => doc.key === ack.key)?.kind === "completion" && syncState) syncState.initialComplete = true;
    }
    frozen = null;
    if (syncState) syncState.lastSyncedAt = at;
  },
};
