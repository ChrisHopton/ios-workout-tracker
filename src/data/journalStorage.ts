import { FRESH_START_EPOCH } from "../sync/reset";
import type { ResetIntent } from "../sync/reset";
import { upgradeData, type StoredAppData } from "../domain/backup";
import { initialData } from "../domain/library";
import { AppData, WorkoutSession } from "../domain/types";
import { snapshot } from "./snapshot";
import { createSyncJournal } from "../sync/journal";
import type { BootstrapDraft } from "../sync/bootstrap";
import type { SyncIdentity } from "../sync/protocol";
import type { SyncLocalState } from "../sync/controller";

export interface Connection {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, ...params: (string | number)[]): Promise<unknown>;
  getFirstAsync<T>(
    sql: string,
    ...params: (string | number)[]
  ): Promise<T | null>;
  getAllAsync<T>(sql: string, ...params: (string | number)[]): Promise<T[]>;
}
export interface JournalDatabase extends Connection {
  withExclusiveTransactionAsync(
    task: (transaction: Connection) => Promise<void>,
  ): Promise<void>;
}
interface StoredSession {
  session: WorkoutSession;
  position: number;
}

export function createJournalStorage(db: JournalDatabase, options: { createId?: () => string; cleanupRecovery?: () => Promise<void>; beforeMigration?: (data: StoredAppData, fromVersion: number, toVersion: number) => Promise<void> } = {}) {
  const sync = createSyncJournal(db);
  let tail: Promise<unknown> = Promise.resolve();
  function serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = tail.then(operation);
    tail = result.catch(() => undefined);
    return result;
  }
  let saved: AppData | undefined;
  let loading: Promise<AppData> | undefined;
  let metadata = "";
  let sessions = new Map<string, StoredSession>();

  async function write(data: AppData, migrate = false): Promise<void> {
    const next = snapshot(data, saved);
    const { sessions: records, ...details } = next;
    const sameMetadata = metadata !== "" && saved &&
      (Object.keys(details) as (keyof typeof details)[]).every((key) => details[key] === saved![key]);
    const nextMetadata = sameMetadata ? metadata : JSON.stringify(details);
    const nextSessions = new Map<string, StoredSession>();
    const changed: (StoredSession & { text: string })[] = [];
    for (const [position, session] of records.entries()) {
      const prior = sessions.get(session.id);
      const entry = { session, position };
      nextSessions.set(session.id, entry);
      if (!prior || prior.session !== session || prior.position !== position) {
        const text = JSON.stringify(session);
        if (
          !prior ||
          prior.position !== position ||
          JSON.stringify(prior.session) !== text
        )
          changed.push({ ...entry, text });
      }
    }
    const removed = [...sessions.keys()].filter((id) => !nextSessions.has(id));
    if (
      metadata !== nextMetadata ||
      changed.length ||
      removed.length ||
      migrate
    ) {
      await db.withExclusiveTransactionAsync(async (tx) => {
        if (metadata !== nextMetadata) {
          await tx.runAsync(
            "INSERT INTO journal_meta (id, value) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value",
            nextMetadata,
          );
        }
        for (const entry of changed) {
          await tx.runAsync(
            "INSERT INTO workout_sessions (id, position, value) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET position = excluded.position, value = excluded.value",
            entry.session.id,
            entry.position,
            entry.text,
          );
        }
        for (const id of removed)
          await tx.runAsync("DELETE FROM workout_sessions WHERE id = ?", id);
        await sync.capture(tx, saved, next);
        if (migrate) await tx.execAsync("DROP TABLE app_state;");
        await tx.execAsync("PRAGMA user_version = 6;");
      });
    }
    // Advance the comparison cache only after the complete transaction succeeds
    saved = next;
    metadata = nextMetadata;
    sessions = nextSessions;
  }

  async function prepareFreshStart() {
    await sync.initialize();
    await db.execAsync("PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS journal_meta (id INTEGER PRIMARY KEY CHECK (id = 1), value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS workout_sessions (id TEXT PRIMARY KEY, position INTEGER NOT NULL, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS app_lifecycle (id INTEGER PRIMARY KEY CHECK(id = 1), epoch TEXT NOT NULL, cleanup_complete INTEGER NOT NULL);");
    const marker = await db.getFirstAsync<{ epoch: string; cleanup_complete: number }>("SELECT epoch, cleanup_complete FROM app_lifecycle WHERE id = 1");
    if (marker && (marker.epoch !== FRESH_START_EPOCH || ![0, 1].includes(marker.cleanup_complete)))
      throw new Error("The saved app lifecycle needs attention.");
    if (!marker) {
      const next = snapshot(initialData());
      const { sessions: _records, ...details } = next;
      const createId = options.createId ?? (() => globalThis.crypto.randomUUID());
      await db.withExclusiveTransactionAsync(async tx => {
        await sync.resetForFreshStart(tx, createId);
        await tx.execAsync("DELETE FROM workout_sessions; DELETE FROM journal_meta; DROP TABLE IF EXISTS app_state;");
        await tx.runAsync("INSERT INTO journal_meta (id, value) VALUES (1, ?)", JSON.stringify(details));
        await tx.runAsync("INSERT INTO app_lifecycle (id, epoch, cleanup_complete) VALUES (1, ?, 0)", FRESH_START_EPOCH);
        await tx.execAsync("PRAGMA user_version = 6;");
      });
      saved = undefined; metadata = ""; sessions = new Map();
    }
    if (!marker || marker.cleanup_complete === 0) {
      await options.cleanupRecovery?.();
      // Release deleted journal/queue pages and their WAL copies before publishing fresh data.
      await db.execAsync("VACUUM; PRAGMA wal_checkpoint(TRUNCATE);");
      await db.runAsync("UPDATE app_lifecycle SET cleanup_complete = 1 WHERE id = 1");
    }
  }

  async function read(): Promise<AppData> {
    await prepareFreshStart();
    const row = await db.getFirstAsync<{ value: string }>(
      "SELECT value FROM journal_meta WHERE id = 1",
    );
    if (row) {
      const records = await db.getAllAsync<{ value: string; position: number }>(
        "SELECT value, position FROM workout_sessions ORDER BY position",
      );
      const raw = {
        ...JSON.parse(row.value),
        sessions: records.map((record) => JSON.parse(record.value)),
      };
      const next = snapshot(upgradeData(raw));
      saved = raw as AppData;
      metadata = row.value;
      sessions = new Map(
        raw.sessions.map((session: WorkoutSession, index: number) => [
          session.id,
          {
            session,
            position: records[index].position,
          },
        ]),
      );
      await write(next);
      await db.execAsync("PRAGMA user_version = 6;");
      return next;
    }
    throw new Error("The saved journal is missing. Your app data needs attention.");
  }

  function load(): Promise<AppData> {
    loading ??= serial(read).finally(() => {
      loading = undefined;
    });
    return loading;
  }

  const repository = {
    pendingReset: () => serial(() => sync.pendingReset()),
    completeReset: (intent: ResetIntent, identity: SyncIdentity, label: string) => serial(() => sync.completeReset(intent, identity, label)),
    prepareBootstrap: (draft: BootstrapDraft) => serial(() => sync.prepareBootstrap(draft)),
    state: () => serial(() => sync.state()),
    pendingEnrollment: () => serial(() => sync.pendingEnrollment()),
    prepareEnrollment: (identity: SyncIdentity, label: string, installationId: string) =>
      serial(() => sync.prepareEnrollment(identity, label, installationId)),
    activateEnrollment: (candidate: SyncLocalState) =>
      serial(async () => {
        if (!saved) await read();
        await sync.activateEnrollment(saved!, candidate);
      }),
    disconnect: () => serial(() => sync.disconnect()),
    setLabel: (label: string) =>
      serial(async () => {
        if (!saved) await read();
        await sync.setLabel(saved!, label);
      }),
    pendingCount: () => serial(() => sync.pendingCount()),
    inFlight: () => serial(() => sync.inFlight()),
    reserveAttempt: (writes: number, at: number) => serial(() => sync.reserveAttempt(writes, at)),
    acknowledge: (batchId: string, acks: { key: string; revision: number }[], at: string) =>
      serial(() => sync.acknowledge(batchId, acks, at)),
  };

  return {
    load,
    write: (data: AppData) => serial(() => write(data)),
    sync: repository,
  };
}
