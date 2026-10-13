import { Connection, JournalDatabase } from "../data/journalStorage";
import { AppData } from "../domain/types";
import type { SyncLocalState, SyncRepository } from "./controller";
import {
  changedRows,
  makePeopleRow,
  projectData,
  projectMetadata,
  projectSession,
} from "./projection";
import {
  HEADERS,
  MAX_BATCH_ROWS,
  RowChange,
  SheetRow,
  SheetTable,
} from "./protocol";

type StateRow = {
  device_id: string;
  label: string;
  clock: number;
  last_synced_at: string | null;
  enabled: number;
};
type QueueRow = {
  key: string;
  table_name: SheetTable;
  revision: number;
  deleted: number;
  value: string;
};

export function createSyncJournal(db: JournalDatabase) {
  let initialized = false;
  async function initialize() {
    if (initialized) return;
    await db.execAsync(
      "CREATE TABLE IF NOT EXISTS sync_state (id INTEGER PRIMARY KEY CHECK(id = 1), device_id TEXT NOT NULL, label TEXT NOT NULL, clock INTEGER NOT NULL, last_synced_at TEXT, enabled INTEGER NOT NULL); " +
        "CREATE TABLE IF NOT EXISTS sync_rows (key TEXT PRIMARY KEY, table_name TEXT NOT NULL) WITHOUT ROWID; " +
        "CREATE TABLE IF NOT EXISTS sync_outbox (key TEXT PRIMARY KEY, table_name TEXT NOT NULL, revision INTEGER NOT NULL, deleted INTEGER NOT NULL, value TEXT NOT NULL) WITHOUT ROWID;",
    );
    initialized = true;
  }
  async function readState(
    connection: Connection,
  ): Promise<SyncLocalState | null> {
    const row = await connection.getFirstAsync<StateRow>(
      "SELECT * FROM sync_state WHERE id = 1",
    );
    return row
      ? {
          deviceId: row.device_id,
          label: row.label,
          clock: row.clock,
          lastSyncedAt: row.last_synced_at || null,
          enabled: row.enabled === 1,
        }
      : null;
  }
  async function state() {
    await initialize();
    return readState(db);
  }
  function nextClock(clock: number) {
    if (
      !Number.isSafeInteger(clock) ||
      clock < 0 ||
      clock >= Number.MAX_SAFE_INTEGER
    )
      throw new Error("Unable to advance the upload revision Please reconnect");
    return clock + 1;
  }
  function validLabel(label: string) {
    const value = label.trim();
    if (!value || value.length > 80)
      throw new Error("Enter a phone label of 1 to 80 characters.");
    return value;
  }
  async function queue(
    connection: Connection,
    rows: (SheetRow & { deleted: boolean })[],
    revision: number,
  ) {
    for (const row of rows) {
      if (!row.deleted)
        await connection.runAsync(
          "INSERT INTO sync_rows (key, table_name) VALUES (?, ?) ON CONFLICT(key) DO NOTHING",
          row.key,
          row.table,
        );
      await connection.runAsync(
        "INSERT INTO sync_outbox (key, table_name, revision, deleted, value) VALUES (?, ?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET table_name = excluded.table_name, revision = excluded.revision, deleted = excluded.deleted, value = excluded.value",
        row.key,
        row.table,
        revision,
        row.deleted ? 1 : 0,
        JSON.stringify(row.values),
      );
    }
    await connection.runAsync(
      "UPDATE sync_state SET clock = ? WHERE id = 1",
      revision,
    );
  }
  async function capture(
    connection: Connection,
    before: AppData | undefined,
    after: AppData,
  ) {
    const current = await readState(connection);
    if (!current?.enabled) return;
    const oldRows: SheetRow[] = [];
    const newRows: SheetRow[] = [];
    if (
      !before ||
      before.settings !== after.settings ||
      before.exercises !== after.exercises ||
      before.templates !== after.templates ||
      before.scheduleRevisions !== after.scheduleRevisions
    ) {
      if (before)
        oldRows.push(
          ...projectMetadata(before, current.deviceId, current.label),
        );
      newRows.push(...projectMetadata(after, current.deviceId, current.label));
    }
    const prior = new Map(
      before?.sessions.map((session) => [session.id, session]),
    );
    for (const session of after.sessions) {
      const old = prior.get(session.id);
      if (old !== session) {
        if (old) oldRows.push(...projectSession(old, current.deviceId));
        newRows.push(...projectSession(session, current.deviceId));
      }
      prior.delete(session.id);
    }
    for (const removed of prior.values())
      oldRows.push(...projectSession(removed, current.deviceId));
    const changes = changedRows(oldRows, newRows);
    if (changes.length)
      await queue(connection, changes, nextClock(current.clock));
  }
  async function connect(
    data: AppData,
    deviceId: string,
    label: string,
    floor: number,
  ) {
    await initialize();
    const phoneLabel = validLabel(label);
    const current = await state();
    const revision = nextClock(
      Math.max(current?.deviceId === deviceId ? current.clock : 0, floor),
    );
    const rows = projectData(data, deviceId, phoneLabel);
    await db.withExclusiveTransactionAsync(async (tx) => {
      if (current?.deviceId !== deviceId)
        await tx.execAsync("DELETE FROM sync_rows; DELETE FROM sync_outbox;");
      const known = await tx.getAllAsync<{
        key: string;
        table_name: SheetTable;
      }>("SELECT key, table_name FROM sync_rows");
      const active = new Set(rows.map((row) => row.key));
      const removals = known
        .filter((row) => !active.has(row.key))
        .map((row) => ({
          table: row.table_name,
          key: row.key,
          values: HEADERS[row.table_name].map(() => null),
          deleted: true,
        }));
      await tx.runAsync(
        "INSERT INTO sync_state (id, device_id, label, clock, last_synced_at, enabled) VALUES (1, ?, ?, ?, ?, 1) ON CONFLICT(id) DO UPDATE SET device_id = excluded.device_id, label = excluded.label, clock = excluded.clock, last_synced_at = excluded.last_synced_at, enabled = 1",
        deviceId,
        phoneLabel,
        revision,
        current?.deviceId === deviceId ? (current.lastSyncedAt ?? "") : "",
      );
      await queue(
        tx,
        [...rows.map((row) => ({ ...row, deleted: false })), ...removals],
        revision,
      );
    });
  }
  async function disconnect() {
    await initialize();
    await db.withExclusiveTransactionAsync(async (tx) => {
      await tx.runAsync("UPDATE sync_state SET enabled = 0 WHERE id = 1");
    });
  }
  async function setLabel(data: AppData, label: string) {
    const current = await state();
    if (!current) throw new Error("Connect Google Sheets first.");
    const phoneLabel = validLabel(label);
    await db.withExclusiveTransactionAsync(async (tx) => {
      await tx.runAsync(
        "UPDATE sync_state SET label = ? WHERE id = 1",
        phoneLabel,
      );
      if (current.enabled)
        await queue(
          tx,
          [
            {
              ...makePeopleRow(data.settings, current.deviceId, phoneLabel),
              deleted: false,
            },
          ],
          nextClock(current.clock),
        );
    });
  }
  async function pendingCount() {
    await initialize();
    return (
      (
        await db.getFirstAsync<{ count: number }>(
          "SELECT COUNT(*) AS count FROM sync_outbox",
        )
      )?.count ?? 0
    );
  }
  async function pending(): Promise<RowChange[]> {
    await initialize();
    const rows = await db.getAllAsync<QueueRow>(
      `SELECT * FROM sync_outbox ORDER BY revision, key LIMIT ${MAX_BATCH_ROWS}`,
    );
    return rows.map((row) => ({
      table: row.table_name,
      key: row.key,
      values: JSON.parse(row.value),
      revision: row.revision,
      deleted: row.deleted === 1,
    }));
  }
  async function acknowledge(
    acks: { key: string; revision: number }[],
    at: string,
  ) {
    await initialize();
    await db.withExclusiveTransactionAsync(async (tx) => {
      for (const ack of acks) {
        await tx.runAsync(
          "DELETE FROM sync_rows WHERE key = ? AND EXISTS (SELECT 1 FROM sync_outbox WHERE key = ? AND revision = ? AND deleted = 1)",
          ack.key,
          ack.key,
          ack.revision,
        );
        await tx.runAsync(
          "DELETE FROM sync_outbox WHERE key = ? AND revision = ?",
          ack.key,
          ack.revision,
        );
      }
      await tx.runAsync(
        "UPDATE sync_state SET last_synced_at = ? WHERE id = 1",
        at,
      );
    });
    if ((await pendingCount()) === 0) {
      const free = await db.getFirstAsync<{ freelist_count: number }>(
        "PRAGMA freelist_count",
      );
      const size = await db.getFirstAsync<{ page_size: number }>(
        "PRAGMA page_size",
      );
      if ((free?.freelist_count ?? 0) * (size?.page_size ?? 0) >= 1024 * 1024) {
        // Reclaim a large initial upload queue after it drains
        await db
          .execAsync("VACUUM; PRAGMA wal_checkpoint(TRUNCATE);")
          .catch(() => undefined);
      }
    }
  }
  return {
    initialize,
    capture,
    state,
    connect,
    disconnect,
    setLabel,
    pendingCount,
    pending,
    acknowledge,
  } satisfies Omit<SyncRepository, "connect" | "setLabel"> & {
    initialize: typeof initialize;
    capture: typeof capture;
    connect: typeof connect;
    setLabel: typeof setLabel;
  };
}
