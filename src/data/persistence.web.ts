import type { AppData } from "../domain/types";
import { initialData } from "../domain/library";
import { parseBackup } from "../domain/backup";
import { changedRows, makeProfileDocument, makeCompletionDocument, projectData } from "../sync/projection";
import type { SyncLocalState, SyncRepository } from "../sync/controller";
import { makeBatch, type DocumentChange, type UploadBatch, type SyncIdentity, type UploadDocument } from "../sync/protocol";

let syncState: SyncLocalState | null = null;
let staging: SyncLocalState | null = null;
let priorData: AppData | null = null;
let frozen: UploadBatch | null = null;
const outbox = new Map<string, DocumentChange>();
const known = new Map<string, UploadDocument>();
const key = "workout-browser-preview-v1";
function same(a: SyncIdentity | null, b: SyncIdentity) {
  return !!a && a.projectId === b.projectId && a.deviceId === b.deviceId && a.generationId === b.generationId;
}
export async function loadData(): Promise<AppData> {
  const value = localStorage.getItem(key);
  priorData = value ? parseBackup(value) : initialData();
  if (value && JSON.parse(value).schemaVersion === 1) {
    localStorage.setItem("workout-browser-before-v1-to-v2", value);
    localStorage.setItem(key, JSON.stringify(priorData));
  }
  return priorData;
}
export async function writeData(data: AppData): Promise<void> {
  localStorage.setItem(key, JSON.stringify(data));
  if (syncState?.enabled && priorData) {
    const changes = changedRows(projectData(priorData, syncState.deviceId, syncState.label), projectData(data, syncState.deviceId, syncState.label));
    if (changes.length) {
      const revision = ++syncState.clock;
      changes.forEach((doc) => { outbox.set(doc.key, { ...doc, revision }); if (!doc.deleted) known.set(doc.key, doc); });
    }
  }
  priorData = data;
}
export const syncRepository: SyncRepository = {
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
  disconnect: async () => { if (syncState) syncState.enabled = false; },
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
