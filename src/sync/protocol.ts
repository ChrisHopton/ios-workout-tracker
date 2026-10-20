export type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;
export interface JsonObject { [key: string]: JsonValue; }
export const UPLOAD_KINDS = [
  "profile", "body_weight", "exercise", "plan", "schedule", "schedule_template", "workout",
  "workout_exercise", "completion",
] as const;
export type UploadKind = (typeof UPLOAD_KINDS)[number];
export interface UploadDocument {
  key: string;
  kind: UploadKind;
  payload: JsonObject;
}
export interface DocumentChange extends UploadDocument {
  revision: number;
  deleted: boolean;
}
export type RowChange = DocumentChange;
export interface SyncIdentity {
  projectId: string;
  deviceId: string;
  generationId: string;
  layout?: "legacy" | "automatic";
  uid?: string;
}
export interface LegacySyncCredentials extends SyncIdentity {
  version: 1;
  layout?: "legacy";
  apiKey: string;
  uid: string;
  email: string;
  password: string;
}
export interface AnonymousSyncCredentials extends SyncIdentity {
  version: 2;
  layout: "automatic";
  uid: string;
  apiKey: string;
  refreshToken: string;
}
export type SyncCredentials = LegacySyncCredentials | AnonymousSyncCredentials;
export interface UploadBatch {
  id: string;
  changes: DocumentChange[];
}
export interface CommitReceipt {
  acknowledged: { key: string; revision: number }[];
}
export type FirestoreValue =
  | { nullValue: null }
  | { booleanValue: boolean }
  | { integerValue: string }
  | { doubleValue: number }
  | { stringValue: string }
  | { arrayValue: { values: FirestoreValue[] } }
  | { mapValue: { fields: Record<string, FirestoreValue> } };
export interface FirestoreDocument {
  name: string;
  fields: Record<string, FirestoreValue>;
}

export const MAX_BATCH_DOCUMENTS = 10;
export const MAX_BATCH_ROWS = MAX_BATCH_DOCUMENTS;
export const MAX_BATCH_BYTES = 256 * 1024;
export const BATCH_METADATA_RESERVE_BYTES = 8 * 1024;
export const MAX_CONNECTION_CODE_BYTES = 4096;
export const MAX_DOCUMENT_KEY_BYTES = 1500;
const PROJECT_ID = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const API_KEY = /^[A-Za-z0-9_-]{20,128}$/;
const UID = /^[A-Za-z0-9_-]{1,128}$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function record(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => actual.includes(key));
}
export function validateIdentity(value: unknown): SyncIdentity {
  if (
    !record(value) || typeof value.projectId !== "string" || !PROJECT_ID.test(value.projectId) ||
    typeof value.deviceId !== "string" || !UUID.test(value.deviceId) ||
    typeof value.generationId !== "string" || !UUID.test(value.generationId) ||
    (value.layout !== undefined && value.layout !== "legacy" && value.layout !== "automatic") ||
    (value.layout === "automatic" && (typeof value.uid !== "string" || !UID.test(value.uid)))
  ) throw new Error("Invalid Firestore identity");
  const identity = { projectId: value.projectId, deviceId: value.deviceId, generationId: value.generationId };
  return value.layout === "automatic"
    ? { ...identity, layout: "automatic", uid: value.uid as string }
    : identity;
}
export function validateCredentials(value: unknown): SyncCredentials {
  if (
    !record(value) || typeof value.apiKey !== "string" || !API_KEY.test(value.apiKey) ||
    typeof value.uid !== "string" || !UID.test(value.uid)
  ) throw new Error("Invalid Firestore connection");
  const identity = validateIdentity(value);
  if (value.version === 2) {
    if (
      !exactKeys(value, ["version", "layout", "projectId", "apiKey", "deviceId", "generationId", "uid", "refreshToken"]) ||
      value.layout !== "automatic" || typeof value.refreshToken !== "string" ||
      !/^[!-~]{1,16384}$/.test(value.refreshToken)
    ) throw new Error("Invalid Firestore connection");
    return {
      version: 2, ...identity, layout: "automatic", uid: value.uid, apiKey: value.apiKey,
      refreshToken: value.refreshToken,
    };
  }
  if (
    !exactKeys(value, ["version", "projectId", "apiKey", "deviceId", "generationId", "uid", "email", "password"]) ||
    value.version !== 1 || typeof value.email !== "string" || value.email.length > 254 || !EMAIL.test(value.email) ||
    typeof value.password !== "string" || value.password.length < 6 || value.password.length > 256 ||
    /[\u0000-\u001f\u007f]/.test(value.password)
  ) throw new Error("Invalid Firestore connection");
  return {
    version: 1, projectId: identity.projectId, deviceId: identity.deviceId, generationId: identity.generationId,
    apiKey: value.apiKey, uid: value.uid,
    email: value.email, password: value.password,
  };
}
export function identityOf(credentials: SyncCredentials): SyncIdentity {
  return validateIdentity(validateCredentials(credentials));
}
export function sameIdentity(left: SyncIdentity | null | undefined, right: SyncIdentity | null | undefined): boolean {
  if (!left || !right) return false;
  const a = validateIdentity(left);
  const b = validateIdentity(right);
  return a.projectId === b.projectId && a.deviceId === b.deviceId && a.generationId === b.generationId &&
    a.layout === b.layout && a.uid === b.uid;
}
export function documentRoot(identity: SyncIdentity): string {
  const checked = validateIdentity(identity);
  const root = `projects/${checked.projectId}/databases/(default)/documents`;
  return checked.layout === "automatic"
    ? `${root}/automaticUploads/${checked.uid}`
    : `${root}/devices/${checked.deviceId}/generations/${checked.generationId}`;
}
export function byteLength(text: string): number {
  let bytes = 0;
  for (let index = 0; index < text.length; index++) {
    const point = text.charCodeAt(index);
    if (point < 0x80) bytes++;
    else if (point < 0x800) bytes += 2;
    else if (
      point >= 0xd800 && point <= 0xdbff && index + 1 < text.length &&
      text.charCodeAt(index + 1) >= 0xdc00 && text.charCodeAt(index + 1) <= 0xdfff
    ) { bytes += 4; index++; }
    else bytes += 3;
  }
  return bytes;
}
function decodeBase64Url(text: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(text) || text.length % 4 === 1) throw new Error("Invalid encoding");
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
export function parseConnectionCode(value: unknown): LegacySyncCredentials {
  try {
    if (typeof value !== "string" || byteLength(value) > MAX_CONNECTION_CODE_BYTES)
      throw new Error("Invalid code");
    const code = value.trim();
    if (!code.startsWith("WORKOUTFB1.")) throw new Error("Invalid code");
    const credentials = validateCredentials(JSON.parse(decodeBase64Url(code.slice(11))));
    if (credentials.version !== 1) throw new Error("Invalid code");
    return credentials;
  } catch { throw new Error("Invalid Firestore connection code"); }
}
export function makeDocumentKey(kind: UploadKind, deviceId: string, ...source: (string | number)[]): string {
  try {
    if (!UPLOAD_KINDS.includes(kind) || !UUID.test(deviceId)) throw new Error("Invalid key");
    if (kind === "completion") {
      if (source.length) throw new Error("Invalid key");
      return "completion";
    }
    if (!source.length || source.some((part) => String(part).length === 0 || (typeof part === "number" && (!Number.isSafeInteger(part) || part < 0)))) throw new Error("Invalid key");
    const key = [kind, deviceId, ...source].map((part) => encodeURIComponent(part)).join(":");
    if (byteLength(key) > MAX_DOCUMENT_KEY_BYTES) throw new Error("Invalid key");
    return key;
  } catch { throw new Error("Invalid upload document key"); }
}
function validDocumentKey(value: unknown, deviceId?: string, kind?: UploadKind): value is string {
  if (typeof value !== "string" || byteLength(value) > MAX_DOCUMENT_KEY_BYTES) return false;
  if (value === "completion") return kind === undefined || kind === "completion";
  const parts = value.split(":");
  if (
    parts.length < 3 || !UPLOAD_KINDS.includes(parts[0] as UploadKind) || parts[0] === "completion" ||
    (kind !== undefined && parts[0] !== kind) || !UUID.test(parts[1]) ||
    (deviceId !== undefined && parts[1] !== deviceId)
  ) return false;
  try {
    return parts.every((part) => part.length > 0 && encodeURIComponent(decodeURIComponent(part)) === part);
  } catch { return false; }
}
function encodeValue(value: unknown, seen: Set<object>, depth: number, insideArray = false): FirestoreValue {
  if (depth > 19) throw new Error("Invalid upload payload");
  if (value === null) return { nullValue: null };
  if (typeof value === "string") {
    if (byteLength(value) > 1024 * 1024 - 89) throw new Error("Invalid upload payload");
    return { stringValue: value };
  }
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) throw new Error("Invalid upload payload");
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (typeof value !== "object" || seen.has(value)) throw new Error("Invalid upload payload");
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      if (insideArray) throw new Error("Invalid upload payload");
      const values: FirestoreValue[] = [];
      for (let index = 0; index < value.length; index++) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) throw new Error("Invalid upload payload");
        values.push(encodeValue(value[index], seen, depth + 1, true));
      }
      return { arrayValue: { values } };
    }
    if (!record(value)) throw new Error("Invalid upload payload");
    const fields: Record<string, FirestoreValue> = {};
    for (const [key, child] of Object.entries(value)) {
      if (!key || byteLength(key) > 1500 || /^__.*__$/.test(key)) throw new Error("Invalid upload payload");
      fields[key] = encodeValue(child, seen, depth + 1);
    }
    return { mapValue: { fields } };
  } finally { seen.delete(value); }
}
export function encodeFirestoreValue(value: unknown): FirestoreValue {
  return encodeValue(value, new Set(), 0);
}
export function validateDocument(value: unknown, deviceId?: string): UploadDocument {
  if (
    !record(value) || !exactKeys(value, ["key", "kind", "payload"]) ||
    !UPLOAD_KINDS.includes(value.kind as UploadKind) ||
    !validDocumentKey(value.key, deviceId, value.kind as UploadKind) || !record(value.payload) ||
    (value.kind === "completion" && (!exactKeys(value.payload, ["initialUploadComplete"]) || value.payload.initialUploadComplete !== true))
  ) throw new Error("Invalid upload document");
  encodeFirestoreValue(value.payload);
  return { key: value.key, kind: value.kind as UploadKind, payload: value.payload as JsonObject };
}
export function validateDocumentChange(value: unknown, deviceId?: string): DocumentChange {
  if (
    !record(value) || !exactKeys(value, ["key", "kind", "payload", "revision", "deleted"]) ||
    typeof value.revision !== "number" || !Number.isSafeInteger(value.revision) || value.revision < 1 ||
    typeof value.deleted !== "boolean" || (value.kind === "completion" && value.deleted !== false) ||
    (value.deleted === true && (!record(value.payload) || Object.keys(value.payload).length !== 0))
  ) throw new Error("Invalid upload document");
  return {
    ...validateDocument({ key: value.key, kind: value.kind, payload: value.payload }, deviceId),
    revision: value.revision, deleted: value.deleted,
  };
}
export function recordDocumentName(identity: SyncIdentity, key: string): string {
  const checked = validateIdentity(identity);
  if (!validDocumentKey(key, checked.deviceId)) throw new Error("Invalid upload document key");
  return `${documentRoot(checked)}/records/${key}`;
}
export function encodeFirestoreDocument(
  identity: SyncIdentity,
  installationId: string,
  change: DocumentChange,
): FirestoreDocument {
  const checked = validateIdentity(identity);
  if (!UUID.test(installationId)) throw new Error("Invalid installation identity");
  const document = validateDocumentChange(change, checked.deviceId);
  const envelope = encodeFirestoreValue({
    schemaVersion: 1, deviceId: checked.deviceId, generationId: checked.generationId,
    installationId, key: document.key, kind: document.kind, revision: document.revision,
    deleted: document.deleted, payload: document.payload,
  });
  if (!("mapValue" in envelope)) throw new Error("Invalid upload document");
  return { name: recordDocumentName(checked, document.key), fields: envelope.mapValue.fields };
}
export function encodedBatchBytes(identity: SyncIdentity, installationId: string, changes: DocumentChange[]): number {
  return byteLength(JSON.stringify({
    writes: changes.map((change) => ({ update: encodeFirestoreDocument(identity, installationId, change) })),
  }));
}
export function makeBatch(
  identity: SyncIdentity,
  changes: DocumentChange[],
  installationId: string,
): { changes: DocumentChange[] } {
  const checked = validateIdentity(identity);
  if (!UUID.test(installationId)) throw new Error("Invalid installation identity");
  const result: DocumentChange[] = [];
  const keys = new Set<string>();
  let bytes = byteLength(JSON.stringify({ writes: [] }));
  let full = false;
  const limit = MAX_BATCH_BYTES - BATCH_METADATA_RESERVE_BYTES;
  for (const change of changes) {
    const encoded = { update: encodeFirestoreDocument(checked, installationId, change) };
    if (keys.has(change.key)) throw new Error("Duplicate upload document");
    keys.add(change.key);
    const size = byteLength(JSON.stringify(encoded));
    if (size + 13 > limit) throw new Error("A document exceeds the upload size limit");
    const separator = result.length ? 1 : 0;
    if (full || result.length >= MAX_BATCH_DOCUMENTS || bytes + size + separator > limit) {
      full = true;
      continue;
    }
    result.push(JSON.parse(JSON.stringify(change)) as DocumentChange);
    bytes += size + separator;
  }
  return { changes: result };
}
export function parseCommitReceipt(value: unknown, expected?: DocumentChange[]): CommitReceipt {
  if (
    !record(value) || !exactKeys(value, ["acknowledged"]) || !Array.isArray(value.acknowledged) ||
    value.acknowledged.length > MAX_BATCH_DOCUMENTS ||
    (expected !== undefined && value.acknowledged.length !== expected.length)
  ) throw new Error("Invalid upload receipt");
  const acknowledged: { key: string; revision: number }[] = [];
  const keys = new Set<string>();
  for (const [index, item] of value.acknowledged.entries()) {
    if (
      !record(item) || !exactKeys(item, ["key", "revision"]) || !validDocumentKey(item.key) ||
      typeof item.revision !== "number" || !Number.isSafeInteger(item.revision) || item.revision < 1 ||
      keys.has(item.key) ||
      (expected !== undefined && (item.key !== expected[index].key || item.revision !== expected[index].revision))
    ) throw new Error("Invalid upload receipt");
    keys.add(item.key);
    acknowledged.push({ key: item.key, revision: item.revision });
  }
  return { acknowledged };
}
export const validateCommitReceipt = parseCommitReceipt;
