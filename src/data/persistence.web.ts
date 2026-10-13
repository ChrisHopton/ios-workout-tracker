import { AppData } from "../domain/types";
import { initialData } from "../domain/library";
import { parseBackup } from "../domain/backup";
import { changedRows, makePeopleRow, projectData } from "../sync/projection";
import type { SyncLocalState, SyncRepository } from "../sync/controller";
import type { RowChange } from "../sync/protocol";

let syncState: SyncLocalState | null = null;
let priorData: AppData | null = null;
const outbox = new Map<string, RowChange>();
// Browser preview has separate storage from the native app
const key = "workout-browser-preview-v1";
export async function loadData(): Promise<AppData> {
  const value = localStorage.getItem(key);
  priorData = value ? parseBackup(value) : initialData();
  return priorData;
}
export async function writeData(data: AppData): Promise<void> {
  localStorage.setItem(key, JSON.stringify(data));
  if (syncState?.enabled && priorData) {
    const changes = changedRows(
      projectData(priorData, syncState.deviceId, syncState.label),
      projectData(data, syncState.deviceId, syncState.label),
    );
    if (changes.length) {
      const revision = ++syncState.clock;
      changes.forEach((row) => outbox.set(row.key, { ...row, revision }));
    }
  }
  priorData = data;
}

export const syncRepository: SyncRepository = {
  state: async () => (syncState ? { ...syncState } : null),
  connect: async (deviceId, label, floor) => {
    const data = priorData ?? (await loadData());
    syncState = {
      deviceId,
      label,
      clock: Math.max(syncState?.clock ?? 0, floor) + 1,
      lastSyncedAt: null,
      enabled: true,
    };
    outbox.clear();
    projectData(data, deviceId, label).forEach((row) =>
      outbox.set(row.key, {
        ...row,
        revision: syncState!.clock,
        deleted: false,
      }),
    );
  },
  disconnect: async () => {
    if (syncState) syncState.enabled = false;
  },
  setLabel: async (label) => {
    if (!syncState || !priorData) throw new Error("Connect the preview first.");
    syncState.label = label;
    const row = makePeopleRow(priorData.settings, syncState.deviceId, label);
    outbox.set(row.key, {
      ...row,
      revision: ++syncState.clock,
      deleted: false,
    });
  },
  pendingCount: async () => outbox.size,
  pending: async () => [...outbox.values()].slice(0, 100),
  acknowledge: async (acks, at) => {
    acks.forEach((ack) => {
      if (outbox.get(ack.key)?.revision === ack.revision)
        outbox.delete(ack.key);
    });
    if (syncState) syncState.lastSyncedAt = at;
  },
};
