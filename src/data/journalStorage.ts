import { parseBackup, upgradeData, validateStoredData, type LegacyAppData } from "../domain/backup";
import { initialData } from "../domain/library";
import { AppData, WorkoutSession } from "../domain/types";
import { snapshot } from "./snapshot";
import { createSyncJournal } from "../sync/journal";
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

export function createJournalStorage(db: JournalDatabase, options: { beforeMigration?: (data: AppData | LegacyAppData, fromVersion: number, toVersion: number) => Promise<void> } = {}) {
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
    const nextMetadata = JSON.stringify(details);
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
        await tx.execAsync("PRAGMA user_version = 5;");
      });
    }
    // Advance the comparison cache only after the complete transaction succeeds
    saved = next;
    metadata = nextMetadata;
    sessions = nextSessions;
  }

  async function backupBeforeMigration() {
    if (!options.beforeMigration) return;
    const version = await db.getFirstAsync<{ user_version: number }>("PRAGMA user_version");
    if (!version || version.user_version < 1 || version.user_version >= 5) return;
    const metaExists = await db.getFirstAsync<{ name: string }>("SELECT name FROM sqlite_master WHERE name = 'journal_meta'");
    if (metaExists) {
      const meta = await db.getFirstAsync<{ value: string }>("SELECT value FROM journal_meta WHERE id = 1");
      if (meta) {
        const rows = await db.getAllAsync<{ value: string }>("SELECT value FROM workout_sessions ORDER BY position");
        await options.beforeMigration(validateStoredData({ ...JSON.parse(meta.value), sessions: rows.map((row) => JSON.parse(row.value)) }), version.user_version, 5);
      }
    } else {
      const legacy = await db.getFirstAsync<{ name: string }>("SELECT name FROM sqlite_master WHERE name = 'app_state'");
      if (legacy) {
        const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM app_state WHERE id = 1");
        if (row) await options.beforeMigration(validateStoredData(JSON.parse(row.value)), version.user_version, 5);
      }
    }
  }

  async function read(): Promise<AppData> {
    await backupBeforeMigration();
    await sync.initialize();
    await db.execAsync(
      "PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS journal_meta (id INTEGER PRIMARY KEY CHECK (id = 1), value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS workout_sessions (id TEXT PRIMARY KEY, position INTEGER NOT NULL, value TEXT NOT NULL);",
    );
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
      await db.execAsync("PRAGMA user_version = 5;");
      return next;
    }
    const legacy = await db.getFirstAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'app_state'",
    );
    if (legacy) {
      const old = await db.getFirstAsync<{ value: string }>(
        "SELECT value FROM app_state WHERE id = 1",
      );
      const next = old ? parseBackup(old.value) : initialData();
      await write(next, true);
      await db.execAsync("VACUUM; PRAGMA wal_checkpoint(TRUNCATE);");
      return next;
    }
    await db.execAsync("PRAGMA user_version = 5;");
    saved = snapshot(initialData());
    return saved;
  }

  function load(): Promise<AppData> {
    loading ??= serial(read).finally(() => {
      loading = undefined;
    });
    return loading;
  }

  const repository = {
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
