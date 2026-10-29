import * as Crypto from "expo-crypto";
import type { ResetIntent } from "../sync/reset";
import { removeRecoveryCopies } from "./backupIO";
import { openDatabaseAsync } from "expo-sqlite";
import type { AppData } from "../domain/types";
import type { BootstrapDraft } from "../sync/bootstrap";
import type { SyncIdentity } from "../sync/protocol";
import type { SyncLocalState } from "../sync/controller";
import { createRetryableResource } from "./retryableResource";
import { createJournalStorage } from "./journalStorage";

const getStorage = createRetryableResource(async () =>
  createJournalStorage(await openDatabaseAsync("workout.db"), { createId: () => Crypto.randomUUID(), cleanupRecovery: removeRecoveryCopies }),
);
export async function loadData(): Promise<AppData> { return (await getStorage()).load(); }
export async function writeData(data: AppData): Promise<void> { await (await getStorage()).write(data); }
export const syncRepository = {
  pendingReset: async () => (await getStorage()).sync.pendingReset(),
  completeReset: async (intent: ResetIntent, identity: SyncIdentity, label: string) => (await getStorage()).sync.completeReset(intent, identity, label),
  prepareBootstrap: async (draft: BootstrapDraft) => (await getStorage()).sync.prepareBootstrap(draft),
  state: async () => (await getStorage()).sync.state(),
  pendingEnrollment: async () => (await getStorage()).sync.pendingEnrollment(),
  prepareEnrollment: async (identity: SyncIdentity, label: string, installationId: string) =>
    (await getStorage()).sync.prepareEnrollment(identity, label, installationId),
  activateEnrollment: async (state: SyncLocalState) => (await getStorage()).sync.activateEnrollment(state),
  disconnect: async () => (await getStorage()).sync.disconnect(),
  setLabel: async (label: string) => (await getStorage()).sync.setLabel(label),
  pendingCount: async () => (await getStorage()).sync.pendingCount(),
  inFlight: async () => (await getStorage()).sync.inFlight(),
  reserveAttempt: async (writes: number, at: number) => (await getStorage()).sync.reserveAttempt(writes, at),
  acknowledge: async (batchId: string, acks: { key: string; revision: number }[], at: string) =>
    (await getStorage()).sync.acknowledge(batchId, acks, at),
};
