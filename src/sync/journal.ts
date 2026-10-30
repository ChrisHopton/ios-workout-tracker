import { FRESH_START_EPOCH, validateResetIntent, type ResetIntent } from "./reset";
import type { Connection, JournalDatabase } from "../data/journalStorage";
import { validateBootstrap, type BootstrapDraft } from "./bootstrap";
import type { StoredAppData } from "../domain/backup";
import type { AppData } from "../domain/types";
import type { SyncLocalState } from "./controller";
import { changedRows, makeProfileDocument, projectData, projectMetadata, projectSession, makeCompletionDocument } from "./projection";
import { validateIdentity, makeBatch, sameIdentity, type SyncIdentity, type UploadBatch, type UploadDocument, type UploadKind } from "./protocol";

interface StoredQueue {
  key: string;
  kind: UploadKind;
  revision: number;
  deleted: number;
  payload: string;
}
const LIMIT = 8000;

export function pacificDay(at: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(at));
}
export function nextPacificDay(at: number): number {
  const day = pacificDay(at);
  let low = at;
  let high = at + 26 * 60 * 60 * 1000;
  while (high - low > 1000) {
    const middle = Math.floor((low + high) / 2);
    if (pacificDay(middle) === day) low = middle;
    else high = middle;
  }
  return high;
}
function nextClock(clock: number): number {
  if (!Number.isSafeInteger(clock) || clock < 0 || clock >= Number.MAX_SAFE_INTEGER)
    throw new Error("The upload revision is invalid. Request a replacement connection code.");
  return clock + 1;
}
function checkedLabel(label: string): string {
  const value = label.trim();
  if (!value || value.length > 80) throw new Error("Enter a phone label of 1 to 80 characters.");
  return value;
}
function checkedState(value: string): SyncLocalState {
  const state = JSON.parse(value) as SyncLocalState;
  validateIdentity(state);
  nextClock(state.clock);
  checkedLabel(state.label);
  if (!state.projectId || !state.deviceId || !state.generationId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(state.installationId) ||
    typeof state.enabled !== "boolean" || typeof state.bound !== "boolean" || typeof state.initialComplete !== "boolean")
    throw new Error("The local upload identity is invalid. Request a replacement connection code.");
  return state;
}
export function createSyncJournal(db: JournalDatabase) {
  let initialized = false;
  async function initialize() {
    if (initialized) return;
    await db.withExclusiveTransactionAsync(async (tx) => {
      await tx.execAsync(
        "CREATE TABLE IF NOT EXISTS upload_reset (id INTEGER PRIMARY KEY CHECK(id = 1), value TEXT NOT NULL); " +
        "CREATE TABLE IF NOT EXISTS upload_bootstrap (id INTEGER PRIMARY KEY CHECK(id = 1), value TEXT NOT NULL); " +
        "CREATE TABLE IF NOT EXISTS upload_state (id INTEGER PRIMARY KEY CHECK(id = 1), value TEXT NOT NULL); " +
        "CREATE TABLE IF NOT EXISTS upload_enrollment (id INTEGER PRIMARY KEY CHECK(id = 1), value TEXT NOT NULL); " +
        "CREATE TABLE IF NOT EXISTS upload_records (key TEXT PRIMARY KEY, kind TEXT NOT NULL) WITHOUT ROWID; " +
        "CREATE TABLE IF NOT EXISTS upload_outbox (key TEXT PRIMARY KEY, kind TEXT NOT NULL, revision INTEGER NOT NULL, deleted INTEGER NOT NULL, payload TEXT NOT NULL) WITHOUT ROWID; " +
        "CREATE TABLE IF NOT EXISTS upload_inflight (id INTEGER PRIMARY KEY CHECK(id = 1), value TEXT NOT NULL); " +
        "CREATE TABLE IF NOT EXISTS upload_budget (id INTEGER PRIMARY KEY CHECK(id = 1), day TEXT NOT NULL, attempts INTEGER NOT NULL); " +
        "CREATE TABLE IF NOT EXISTS upload_sequence (id INTEGER PRIMARY KEY CHECK(id = 1), counter INTEGER NOT NULL); " +
        "INSERT OR IGNORE INTO upload_sequence (id, counter) VALUES (1, 0);"
      );
    });
    initialized = true;
  }
  /** Called inside the journal reset transaction, before any old queue can be exposed. */
  async function resetForFreshStart(tx: Connection, createId: () => string) {
    const active = await readState(tx);
    const staged = await readState(tx, "upload_enrollment");
    const row = await tx.getFirstAsync<{ value: string }>("SELECT value FROM upload_bootstrap WHERE id = 1");
    const bootstrap = row ? validateBootstrap(JSON.parse(row.value)) : null;
    const sources = [active, staged].filter((value): value is SyncLocalState => value !== null).map(validateIdentity);
    if (!sources.length && !bootstrap) {
      for (const table of ["upload_records", "upload_outbox", "upload_inflight"]) {
        const evidence = await tx.getFirstAsync<{ count: number }>("SELECT COUNT(*) AS count FROM " + table);
        if (!evidence || evidence.count !== 0) throw new Error("Existing upload state needs repair before the fresh start.");
      }
      const sequence = await tx.getFirstAsync<{ counter: number }>("SELECT counter FROM upload_sequence WHERE id = 1");
      if (!sequence || sequence.counter !== 0) throw new Error("Existing upload revisions need repair before the fresh start.");
    }
    if (sources.length || bootstrap) {
      const intent = validateResetIntent({ version: 1, epoch: FRESH_START_EPOCH, sources, bootstrap,
        target: { deviceId: createId(), generationId: createId(), installationId: createId() } });
      await tx.runAsync("INSERT INTO upload_reset (id, value) VALUES (1, ?)", JSON.stringify(intent));
    }
    // Keep today's attempted-write budget. Rotating a generation must not bypass the quota.
    await tx.execAsync("DROP TABLE IF EXISTS sync_state; DROP TABLE IF EXISTS sync_rows; DROP TABLE IF EXISTS sync_outbox; DELETE FROM upload_state; DELETE FROM upload_enrollment; DELETE FROM upload_bootstrap; DELETE FROM upload_records; DELETE FROM upload_outbox; DELETE FROM upload_inflight; UPDATE upload_sequence SET counter = 0 WHERE id = 1;");
  }
  async function pendingReset(): Promise<ResetIntent | null> {
    await initialize();
    const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM upload_reset WHERE id = 1");
    return row ? validateResetIntent(JSON.parse(row.value)) : null;
  }
  async function completeReset(expected: ResetIntent, identity: SyncIdentity, label: string) {
    await initialize();
    validateResetIntent(expected);
    validateIdentity(identity);
    await db.withExclusiveTransactionAsync(async tx => {
      const row = await tx.getFirstAsync<{ value: string }>("SELECT value FROM upload_reset WHERE id = 1");
      if (!row || JSON.stringify(validateResetIntent(JSON.parse(row.value))) !== JSON.stringify(expected) ||
          identity.layout !== "automatic" || identity.generationId !== expected.target.generationId)
        throw new Error("The fresh start identity changed. Try again.");
      await storeState(tx, { ...identity, installationId: expected.target.installationId, label: checkedLabel(label),
        clock: 0, lastSyncedAt: null, enabled: false, bound: false, initialComplete: false }, "upload_enrollment");
      await tx.execAsync("DELETE FROM upload_reset;");
    });
  }
  async function readState(connection: Connection, table = "upload_state", invalid: "reject" | "ignore" = "reject"): Promise<SyncLocalState | null> {
    const row = await connection.getFirstAsync<{ value: string }>(`SELECT value FROM ${table} WHERE id = 1`);
    // Recovery may ignore malformed identities but database failures must abort the transaction
    try {
      return row ? checkedState(row.value) : null;
    } catch (error) {
      if (invalid === "ignore") return null;
      throw error;
    }
  }
  async function storeState(connection: Connection, state: SyncLocalState, table = "upload_state") {
    await connection.runAsync(`INSERT INTO ${table} (id, value) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value`, JSON.stringify(state));
  }
  async function prepareBootstrap(candidate: BootstrapDraft): Promise<BootstrapDraft> {
    await initialize();
    validateBootstrap(candidate);
    if (await pendingReset()) throw new Error("Finish the saved fresh start before enrollment.");
    let result!: BootstrapDraft;
    await db.withExclusiveTransactionAsync(async (tx) => {
      // SQL failures and malformed identities are deliberately not treated as absence.
      if (await readState(tx) || await readState(tx, "upload_enrollment"))
        throw new Error("An upload identity already exists.");
      const stored = await tx.getFirstAsync<{ value: string }>("SELECT value FROM upload_bootstrap WHERE id = 1");
      for (const table of ["upload_records", "upload_outbox", "upload_inflight", "upload_budget"]) {
        const evidence = await tx.getFirstAsync<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table}`);
        if (!evidence || evidence.count !== 0) throw new Error("Existing upload state needs owner repair.");
      }
      const sequence = await tx.getFirstAsync<{ counter: number }>("SELECT counter FROM upload_sequence WHERE id = 1");
      if (!sequence || sequence.counter !== 0) throw new Error("Existing upload revisions need owner repair.");
      if (stored) { result = validateBootstrap(JSON.parse(stored.value)); return; }
      result = candidate;
      await tx.runAsync("INSERT INTO upload_bootstrap (id, value) VALUES (1, ?)", JSON.stringify(result));
    });
    return result;
  }
  async function pendingEnrollment() { await initialize(); return readState(db, "upload_enrollment"); }
  async function state() {
    await initialize();
    return readState(db);
  }
  async function queue(connection: Connection, changes: (UploadDocument & { deleted: boolean })[], state: SyncLocalState) {
    if (!changes.length) return;
    const revision = nextClock(state.clock);
    for (const change of changes) {
      if (!change.deleted)
        await connection.runAsync("INSERT INTO upload_records (key, kind) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET kind = excluded.kind", change.key, change.kind);
      await connection.runAsync(
        "INSERT INTO upload_outbox (key, kind, revision, deleted, payload) VALUES (?, ?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET kind = excluded.kind, revision = excluded.revision, deleted = excluded.deleted, payload = excluded.payload",
        change.key, change.kind, revision, change.deleted ? 1 : 0, JSON.stringify(change.payload),
      );
    }
    state.clock = revision;
    await storeState(connection, state);
  }
  async function capture(connection: Connection, before: StoredAppData | undefined, after: AppData) {
    const current = await readState(connection, "upload_state", "ignore");
    if (!current?.enabled) return;
    const oldDocs: UploadDocument[] = [];
    const newDocs: UploadDocument[] = [];
    if (!before || before.settings !== after.settings || (!("bodyWeights" in before) || before.bodyWeights !== after.bodyWeights) || before.exercises !== after.exercises ||
      before.templates !== after.templates || before.scheduleRevisions !== after.scheduleRevisions ||
      !("routineProgress" in before) || before.routineProgress !== after.routineProgress) {
      if (before) oldDocs.push(...projectMetadata(before, current.deviceId, current.label));
      newDocs.push(...projectMetadata(after, current.deviceId, current.label));
    }
    const prior = new Map(before?.sessions.map((session) => [session.id, session]));
    for (const session of after.sessions) {
      const old = prior.get(session.id);
      if (old !== session) {
        if (old) oldDocs.push(...projectSession(old, current.deviceId));
        newDocs.push(...projectSession(session, current.deviceId));
      }
      prior.delete(session.id);
    }
    for (const session of prior.values()) oldDocs.push(...projectSession(session, current.deviceId));
    await queue(connection, changedRows(oldDocs, newDocs), current);
  }
  async function prepareEnrollment(identity: SyncIdentity, label: string, installationId: string): Promise<SyncLocalState> {
    await initialize();
    let candidate!: SyncLocalState;
    await db.withExclusiveTransactionAsync(async (tx) => {
      const current = await readState(tx, "upload_state", "ignore");
      const staged = await readState(tx, "upload_enrollment", "ignore");
      const prior = sameIdentity(current, identity) ? current : sameIdentity(staged, identity) ? staged : null;
      candidate = prior ? { ...prior, label: checkedLabel(label) } : {
        ...identity, installationId, label: checkedLabel(label), clock: 0,
        lastSyncedAt: null, enabled: false, bound: false, initialComplete: false,
      };
      if (!/^[0-9a-f-]{36}$/.test(candidate.installationId))
        throw new Error("The local upload identity is invalid.");
      await storeState(tx, candidate, "upload_enrollment");
    });
    return candidate;
  }
  async function activateEnrollment(data: AppData, candidate: SyncLocalState) {
    await initialize();
    await db.withExclusiveTransactionAsync(async (tx) => {
      const staged = await readState(tx, "upload_enrollment", "ignore");
      if (!staged || JSON.stringify(staged) !== JSON.stringify(candidate))
        throw new Error("The pending database connection changed. Try again.");
      const current = await readState(tx, "upload_state", "ignore");
      const same = sameIdentity(current, candidate);
      const activated = { ...(same ? current! : candidate), label: candidate.label, bound: true, enabled: true };
      if (!same) {
        await tx.execAsync("DELETE FROM upload_records; DELETE FROM upload_outbox; DELETE FROM upload_inflight;");
      }
      await storeState(tx, activated);
      if (!same || !current?.enabled) {
        const docs = projectData(data, activated.deviceId, activated.label);
        const active = new Set(docs.map((doc) => doc.key));
        const known = await tx.getAllAsync<{ key: string; kind: UploadKind }>("SELECT key, kind FROM upload_records WHERE kind != 'completion'");
        const removed = known.filter((doc) => !active.has(doc.key)).map((doc) => ({ ...doc, payload: {}, deleted: true }));
        await queue(tx, [...docs.map((doc) => ({ ...doc, deleted: false })), ...removed], activated);
      } else if (current.label !== activated.label) {
        await queue(tx, [{ ...makeProfileDocument(data.settings, activated.deviceId, activated.label), deleted: false }], activated);
      }
      await tx.execAsync("DELETE FROM upload_enrollment; DELETE FROM upload_bootstrap;");
    });
  }
  async function disconnect() {
    await initialize();
    await db.withExclusiveTransactionAsync(async (tx) => {
      const current = await readState(tx, "upload_state", "ignore");
      if (current) await storeState(tx, { ...current, enabled: false });
      await tx.runAsync("DELETE FROM upload_enrollment");
    });
  }
  async function setLabel(data: AppData, label: string) {
    await initialize();
    await db.withExclusiveTransactionAsync(async (tx) => {
      const current = await readState(tx, "upload_state", "ignore");
      if (!current) throw new Error("Connect the database first.");
      current.label = checkedLabel(label);
      await storeState(tx, current);
      if (current.enabled) await queue(tx, [{ ...makeProfileDocument(data.settings, current.deviceId, current.label), deleted: false }], current);
    });
  }
  async function pendingCount() {
    await initialize();
    return (await db.getFirstAsync<{ count: number }>("SELECT COUNT(*) AS count FROM upload_outbox"))?.count ?? 0;
  }
  async function inFlight(): Promise<UploadBatch | null> {
    await initialize();
    let batch: UploadBatch | null = null;
    await db.withExclusiveTransactionAsync(async (tx) => {
      const frozen = await tx.getFirstAsync<{ value: string }>("SELECT value FROM upload_inflight WHERE id = 1");
      if (frozen) { batch = JSON.parse(frozen.value) as UploadBatch; return; }
      const current = await readState(tx, "upload_state", "ignore");
      if (!current?.enabled || !current.bound) return;
      let rows = await tx.getAllAsync<StoredQueue>("SELECT * FROM upload_outbox ORDER BY revision, key LIMIT 10");
      if (!rows.length && !current.initialComplete) {
        await queue(tx, [{ ...makeCompletionDocument(), deleted: false }], current);
        rows = await tx.getAllAsync<StoredQueue>("SELECT * FROM upload_outbox ORDER BY revision, key LIMIT 10");
      }
      const pending = rows.map((row) => ({ key: row.key, kind: row.kind, revision: row.revision, deleted: row.deleted === 1, payload: JSON.parse(row.payload) }));
      const selected = makeBatch(current, pending, current.installationId).changes;
      if (!selected.length) return;
      const sequence = await tx.getFirstAsync<{ counter: number }>("SELECT counter FROM upload_sequence WHERE id = 1");
      const serial = nextClock(sequence?.counter ?? 0);
      await tx.runAsync("UPDATE upload_sequence SET counter = ? WHERE id = 1", serial);
      batch = { id: current.generationId + ":" + serial, changes: selected };
      await tx.runAsync("INSERT INTO upload_inflight (id, value) VALUES (1, ?)", JSON.stringify(batch));
    });
    return batch;
  }
  async function reserveAttempt(writes: number, at: number) {
    await initialize();
    if (!Number.isSafeInteger(writes) || writes < 1 || writes > 10 || !Number.isFinite(at))
      throw new Error("Invalid upload attempt.");
    let result = { allowed: false, retryAt: null as number | null };
    await db.withExclusiveTransactionAsync(async (tx) => {
      const row = await tx.getFirstAsync<{ day: string; attempts: number }>("SELECT day, attempts FROM upload_budget WHERE id = 1");
      const day = pacificDay(at);
      const attempts = row?.day === day ? row.attempts : 0;
      if (attempts + writes > LIMIT) {
        result = { allowed: false, retryAt: nextPacificDay(at) };
        return;
      }
      await tx.runAsync("INSERT INTO upload_budget (id, day, attempts) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET day = excluded.day, attempts = excluded.attempts", day, attempts + writes);
      result = { allowed: true, retryAt: null };
    });
    return result;
  }
  async function acknowledge(batchId: string, acks: { key: string; revision: number }[], at: string) {
    await initialize();
    await db.withExclusiveTransactionAsync(async (tx) => {
      const row = await tx.getFirstAsync<{ value: string }>("SELECT value FROM upload_inflight WHERE id = 1");
      if (!row) return;
      const batch = JSON.parse(row.value) as UploadBatch;
      if (batch.id !== batchId) return;
      if (acks.length !== batch.changes.length || acks.some((ack, i) => ack.key !== batch.changes[i].key || ack.revision !== batch.changes[i].revision))
        throw new Error("The upload confirmation is invalid.");
      const current = await readState(tx, "upload_state", "ignore");
      if (!current) return;
      for (const doc of batch.changes) {
        if (doc.deleted)
          await tx.runAsync("DELETE FROM upload_records WHERE key = ? AND NOT EXISTS (SELECT 1 FROM upload_outbox WHERE key = ? AND revision != ?)", doc.key, doc.key, doc.revision);
        await tx.runAsync("DELETE FROM upload_outbox WHERE key = ? AND revision = ?", doc.key, doc.revision);
        if (doc.kind === "completion") current.initialComplete = true;
      }
      await tx.execAsync("DELETE FROM upload_inflight;");
      current.lastSyncedAt = at;
      await storeState(tx, current);
    });
    if ((await pendingCount()) === 0) {
      const free = await db.getFirstAsync<{ freelist_count: number }>("PRAGMA freelist_count");
      const size = await db.getFirstAsync<{ page_size: number }>("PRAGMA page_size");
      if ((free?.freelist_count ?? 0) * (size?.page_size ?? 0) >= 1024 * 1024)
        await db.execAsync("VACUUM; PRAGMA wal_checkpoint(TRUNCATE);").catch(() => undefined);
    }
  }
  return { initialize, resetForFreshStart, pendingReset, completeReset, capture, prepareBootstrap, state, pendingEnrollment, prepareEnrollment, activateEnrollment, disconnect, setLabel, pendingCount, inFlight, reserveAttempt, acknowledge };
}
