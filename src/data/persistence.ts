import { openDatabaseAsync } from "expo-sqlite";
import { AppData } from "../domain/types";
import { createRetryableResource } from "./retryableResource";
import { createJournalStorage } from "./journalStorage";

const getStorage = createRetryableResource(async () =>
  createJournalStorage(await openDatabaseAsync("workout.db")),
);

export async function loadData(): Promise<AppData> {
  return (await getStorage()).load();
}

export async function writeData(data: AppData): Promise<void> {
  await (await getStorage()).write(data);
}

export const syncRepository = {
  state: async () => (await getStorage()).sync.state(),
  connect: async (deviceId: string, label: string, floor: number) =>
    (await getStorage()).sync.connect(deviceId, label, floor),
  disconnect: async () => (await getStorage()).sync.disconnect(),
  setLabel: async (label: string) => (await getStorage()).sync.setLabel(label),
  pendingCount: async () => (await getStorage()).sync.pendingCount(),
  pending: async () => (await getStorage()).sync.pending(),
  acknowledge: async (acks: { key: string; revision: number }[], at: string) =>
    (await getStorage()).sync.acknowledge(acks, at),
};
