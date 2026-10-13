export type SheetTable =
  | "People"
  | "Exercises"
  | "Plans"
  | "Schedules"
  | "Workouts"
  | "Sets";
export type SheetValue = string | number | boolean | null;
export interface SheetRow {
  table: SheetTable;
  key: string;
  values: SheetValue[];
}
export interface RowChange extends SheetRow {
  revision: number;
  deleted: boolean;
}
export interface SyncCredentials {
  version: 1;
  endpoint: string;
  deviceId: string;
  token: string;
}
export interface SyncRequest {
  version: 1;
  action: "hello" | "upload";
  deviceId: string;
  token: string;
  changes?: RowChange[];
}
export type SyncResponse =
  | {
      version: 1;
      ok: true;
      deviceId: string;
      maxRevision: number;
      acknowledged: { key: string; revision: number }[];
    }
  | { version: 1; ok: false; error: string; retryable: boolean };

export const HEADERS: Record<SheetTable, readonly string[]> = {
  People: ["Phone label", "Age", "Gender", "Height cm", "Preferred unit"],
  Exercises: [
    "Exercise ID",
    "Exercise index",
    "Name",
    "Muscle group",
    "Equipment",
    "Increment lb",
    "Increment kg",
  ],
  Plans: [
    "Row type",
    "Template ID",
    "Template index",
    "Title",
    "Archived",
    "Updated at",
    "Exercise index",
    "Exercise ID",
    "Sets",
    "Rep min",
    "Rep max",
    "Weekday index",
    "Weekday",
  ],
  Schedules: [
    "Row type",
    "Revision ID",
    "Revision index",
    "Effective date",
    "Anchor Monday",
    "Slot index",
    "Weekday",
    "Workout index",
    "Workout ID",
    "Template index",
    "Template ID",
    "Title",
    "Archived",
    "Updated at",
    "Exercise index",
    "Exercise ID",
    "Sets",
    "Rep min",
    "Rep max",
    "Template weekday index",
    "Template weekday",
  ],
  Workouts: [
    "Session ID",
    "Date",
    "Title",
    "Template ID",
    "Unit",
    "Status",
    "Started at",
    "Updated at",
    "Finished at",
    "Exercise count",
  ],
  Sets: [
    "Row type",
    "Session ID",
    "Exercise index",
    "Exercise ID",
    "Exercise name",
    "Muscle group",
    "Equipment",
    "Increment lb",
    "Increment kg",
    "Target exercise ID",
    "Target sets",
    "Target rep min",
    "Target rep max",
    "Suggestion reason",
    "Recorded set count",
    "Suggestion count",
    "Set index",
    "Suggested weight",
    "Suggestion present",
    "Actual present",
    "Actual weight",
    "Actual reps",
    "Set status",
  ],
};

export const MAX_BATCH_ROWS = 100;
export const MAX_BATCH_BYTES = 256 * 1024;
export const MAX_ROW_BYTES = 16 * 1024;
export const MAX_CONNECTION_CODE_BYTES = 4096;
const ENDPOINT = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TOKEN = /^[0-9a-f]{64}$/;
const TABLES = Object.keys(HEADERS) as SheetTable[];

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => actual.includes(key));
}
export function validateEndpoint(value: unknown): string {
  if (typeof value !== "string" || !ENDPOINT.test(value))
    throw new Error("Invalid Sheets endpoint");
  return value;
}
export function validateCredentials(value: unknown): SyncCredentials {
  if (
    !record(value) ||
    !exactKeys(value, ["version", "endpoint", "deviceId", "token"]) ||
    value.version !== 1 ||
    typeof value.deviceId !== "string" ||
    !UUID.test(value.deviceId) ||
    typeof value.token !== "string" ||
    !TOKEN.test(value.token)
  )
    throw new Error("Invalid Sheets connection");
  validateEndpoint(value.endpoint);
  return {
    version: 1,
    endpoint: value.endpoint as string,
    deviceId: value.deviceId,
    token: value.token,
  };
}

export function byteLength(text: string): number {
  let bytes = 0;
  for (let index = 0; index < text.length; index++) {
    const point = text.charCodeAt(index);
    if (point < 0x80) bytes++;
    else if (point < 0x800) bytes += 2;
    else if (
      point >= 0xd800 &&
      point <= 0xdbff &&
      index + 1 < text.length &&
      text.charCodeAt(index + 1) >= 0xdc00 &&
      text.charCodeAt(index + 1) <= 0xdfff
    ) {
      bytes += 4;
      index++;
    } else bytes += 3;
  }
  return bytes;
}
function decodeBase64Url(text: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(text) || text.length % 4 === 1)
    throw new Error("Invalid encoding");
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let buffer = 0;
  let bits = 0;
  let escaped = "";
  for (const character of text) {
    buffer = (buffer << 6) | alphabet.indexOf(character);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      const byte = (buffer >>> bits) & 0xff;
      escaped += `%${byte.toString(16).padStart(2, "0")}`;
      buffer &= (1 << bits) - 1;
    }
  }
  if (buffer !== 0) throw new Error("Invalid encoding");
  return decodeURIComponent(escaped);
}
export function parseConnectionCode(value: unknown): SyncCredentials {
  try {
    if (
      typeof value !== "string" ||
      byteLength(value) > MAX_CONNECTION_CODE_BYTES
    )
      throw new Error("Invalid code");
    const code = value.trim();
    if (!code.startsWith("WORKOUT1.")) throw new Error("Invalid code");
    return validateCredentials(JSON.parse(decodeBase64Url(code.slice(9))));
  } catch {
    throw new Error("Invalid Sheets connection code");
  }
}

export function makeRowKey(
  table: SheetTable,
  deviceId: string,
  ...source: (string | number)[]
): string {
  return [table, deviceId, ...source].map((part) => encodeURIComponent(part)).join(":");
}
function deviceKey(value: unknown, deviceId: string, table?: SheetTable): value is string {
  if (typeof value !== "string") return false;
  const parts = value.split(":");
  if (
    parts.length < 3 ||
    !TABLES.includes(parts[0] as SheetTable) ||
    (table !== undefined && parts[0] !== table) ||
    parts[1] !== encodeURIComponent(deviceId)
  )
    return false;
  try {
    return parts.every(
      (part) => part.length > 0 && encodeURIComponent(decodeURIComponent(part)) === part,
    );
  } catch {
    return false;
  }
}
function revision(value: unknown, zero = false): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= (zero ? 0 : 1);
}
function validChange(change: RowChange, deviceId: string): boolean {
  return (
    record(change) &&
    TABLES.includes(change.table) &&
    deviceKey(change.key, deviceId, change.table) &&
    revision(change.revision) &&
    typeof change.deleted === "boolean" &&
    Array.isArray(change.values) &&
    change.values.length === HEADERS[change.table].length &&
    change.values.every(
      (value) =>
        value === null ||
        typeof value === "string" ||
        typeof value === "boolean" ||
        (typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER),
    )
  );
}
export function makeBatch(
  credentials: SyncCredentials,
  changes: RowChange[],
): SyncRequest {
  const checked = validateCredentials(credentials);
  const request: SyncRequest = {
    version: 1,
    action: "upload",
    deviceId: checked.deviceId,
    token: checked.token,
    changes: [],
  };
  let bytes = byteLength(JSON.stringify(request));
  let full = false;
  for (const change of changes) {
    if (!validChange(change, checked.deviceId)) throw new Error("Invalid sync row");
    const size = byteLength(JSON.stringify(change));
    if (size >= MAX_ROW_BYTES) throw new Error("A sync row exceeds the supported size");
    const separator = request.changes!.length > 0 ? 1 : 0;
    if (
      full ||
      request.changes!.length >= MAX_BATCH_ROWS ||
      bytes + size + separator > MAX_BATCH_BYTES
    ) {
      full = true;
      continue;
    }
    request.changes!.push(change);
    bytes += size + separator;
  }
  return request;
}

export function parseSyncResponse(value: unknown, deviceId: string): SyncResponse {
  const invalid = () => new Error("Invalid Sheets response");
  if (!UUID.test(deviceId) || !record(value) || value.version !== 1)
    throw invalid();
  if (value.ok === false) {
    if (
      !exactKeys(value, ["version", "ok", "error", "retryable"]) ||
      typeof value.error !== "string" ||
      !value.error.trim() ||
      value.error.length > 300 ||
      typeof value.retryable !== "boolean"
    )
      throw invalid();
    return { version: 1, ok: false, error: value.error, retryable: value.retryable };
  }
  if (
    value.ok !== true ||
    !exactKeys(value, ["version", "ok", "deviceId", "maxRevision", "acknowledged"]) ||
    value.deviceId !== deviceId ||
    !revision(value.maxRevision, true) ||
    !Array.isArray(value.acknowledged) ||
    value.acknowledged.length > MAX_BATCH_ROWS
  )
    throw invalid();
  const acknowledged: { key: string; revision: number }[] = [];
  const keys = new Set<string>();
  for (const item of value.acknowledged) {
    if (
      !record(item) ||
      !exactKeys(item, ["key", "revision"]) ||
      !deviceKey(item.key, deviceId) ||
      item.key.length >= MAX_ROW_BYTES ||
      !revision(item.revision) ||
      item.revision > value.maxRevision ||
      keys.has(item.key)
    )
      throw invalid();
    keys.add(item.key);
    acknowledged.push({ key: item.key, revision: item.revision });
  }
  return {
    version: 1,
    ok: true,
    deviceId,
    maxRevision: value.maxRevision,
    acknowledged,
  };
}

