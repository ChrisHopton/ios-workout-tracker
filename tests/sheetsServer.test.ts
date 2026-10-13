import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createContext, runInContext } from "node:vm";
import { HEADERS, makeRowKey, parseConnectionCode, RowChange, SheetValue, SyncResponse } from "../src/sync/protocol";
import { createSetupBundle, parseSetupArguments, resolvePrivateOutput, validateEndpoint, writeSetupBundle } from "../scripts/sheetsSetup";

const DEVICE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DEVICE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TOKEN_A = "a".repeat(64);
const TOKEN_B = "b".repeat(64);
const ENDPOINT = "https://script.google.com/macros/s/test-deployment/exec";
const ledgerHeaders = ["Row key", "Device ID", "Revision", "Deleted", "Table"];
const code = readFileSync(resolve("server/Code.gs"), "utf8");

type Cell = { userEnteredValue?: { stringValue?: string; numberValue?: number; boolValue?: boolean; formulaValue?: string } };
type BasicFilter = { range: { sheetId: number; startRowIndex: number; startColumnIndex: number; endColumnIndex: number; endRowIndex?: number } };
type BatchRequest = {
  setBasicFilter?: { filter: BasicFilter };
  appendDimension?: { sheetId: number; dimension: string; length: number };
  updateCells?: { start: { sheetId: number; rowIndex: number; columnIndex: number }; rows: { values: Cell[] }[]; fields: string };
};
class FakeSheet {
  rows: SheetValue[][];
  maximum = 2;
  filter: BasicFilter | null = null;
  hidden = false;
  frozen = 0;
  protected = false;
  constructor(readonly name: string, readonly id: number, headers: readonly string[]) {
    this.rows = [[...headers]];
  }
  getSheetId() { return this.id; }
  getMaxRows() { return this.maximum; }
  getMaxColumns() { return 30; }
  getLastRow() { return this.rows.length; }
  getRange(row: number, column: number, count: number, width: number) {
    const range = {
      getValues: () => Array.from({ length: count }, (_, offset) =>
        Array.from({ length: width }, (_, cell) => this.rows[row + offset - 1]?.[column + cell - 1] ?? "")),
      setValues: (values: SheetValue[][]) => { this.rows = values.map((value) => [...value]); return range; },
      setFontWeight: () => range,
      createFilter: () => range,
    };
    return range;
  }
  insertColumnsAfter() {}
  setFrozenRows(value: number) { this.frozen = value; }
  getFilter() { return this.filter; }
  getProtections() { return []; }
  protect() {
    this.protected = true;
    const protection = {
      setDescription: () => protection, setWarningOnly: (value: boolean) => { assert.equal(value, false); return protection; },
      addEditor: () => protection,
      getEditors: () => [],
      removeEditors: () => protection,
      canDomainEdit: () => false,
    };
    return protection;
  }
  hideSheet() { this.hidden = true; }
}
function harness() {
  const sheets = new Map<string, FakeSheet>();
  for (const [name, headers] of Object.entries(HEADERS)) {
    sheets.set(name, new FakeSheet(name, sheets.size + 1, ["Row key", "Device ID", ...headers]));
  }
  sheets.set("_Sync", new FakeSheet("_Sync", 7, ledgerHeaders));
  const properties: Record<string, string> = {
    WORKOUT_SPREADSHEET_ID: "private-spreadsheet-id",
    WORKOUT_DEVICES: JSON.stringify([
      { deviceId: DEVICE_A, tokenHash: createHash("sha256").update(TOKEN_A).digest("hex") },
      { deviceId: DEVICE_B, tokenHash: createHash("sha256").update(TOKEN_B).digest("hex") },
    ]),
  };
  let accesses = 0;
  let held = false;
  let allowLock = true;
  let releases = 0;
  let calls = 0;
  let failBatch = false;
  let loseResponse = false;
  let duringBatch: (() => void) | undefined;
  let requests: BatchRequest[] = [];
  const workbook = {
    getSheetByName: (name: string) => sheets.get(name),
    getId: () => "private-spreadsheet-id",
    getUrl: () => "https://docs.google.com/spreadsheets/d/private-spreadsheet-id/edit",
    insertSheet: (name: string) => { const sheet = new FakeSheet(name, sheets.size + 1, []); sheets.set(name, sheet); return sheet; },
  };
  const context = createContext({
    PropertiesService: { getScriptProperties: () => ({ getProperty: (name: string) => properties[name], setProperty: (name: string, value: string) => { properties[name] = value; } }) },
    Utilities: {
      newBlob: (value: string) => ({ getBytes: () => [...Buffer.from(value)] }),
      computeDigest: (_algorithm: unknown, value: string) => [...createHash("sha256").update(value).digest()],
      DigestAlgorithm: { SHA_256: "sha256" }, Charset: { UTF_8: "utf8" },
    },
    ContentService: {
      MimeType: { JSON: "application/json" },
      createTextOutput: (value: string) => ({ setMimeType: () => value }),
    },
    LockService: { getScriptLock: () => ({
      tryLock: (timeout: number) => { assert.equal(timeout, 10000); if (held || !allowLock) return false; held = true; return true; },
      waitLock: () => { if (held) throw new Error("busy"); held = true; },
      releaseLock: () => { assert.equal(held, true); held = false; releases++; },
    }) },
    Session: { getEffectiveUser: () => { throw new Error("userinfo.email scope is not granted"); } },
    SpreadsheetApp: {
      openById: (id: string) => { assert.equal(id, "private-spreadsheet-id"); assert.equal(held, true); accesses++; return workbook; },
      create: () => workbook, flush: () => {}, ProtectionType: { SHEET: "sheet" },
    },
    Sheets: { Spreadsheets: { batchUpdate: (batch: { requests: BatchRequest[] }, id: string) => {
      assert.equal(id, "private-spreadsheet-id");
      assert.equal(held, true);
      requests = JSON.parse(JSON.stringify(batch.requests));
      calls++;
      duringBatch?.();
      if (failBatch) throw new Error(`${TOKEN_A} private-spreadsheet-id`);
      const copies = new Map([...sheets.values()].map((sheet) => [sheet.id, { rows: sheet.rows.map((row) => [...row]), maximum: sheet.maximum, filter: sheet.filter }]));
      for (const request of requests) {
        if (request.setBasicFilter) {
          const filter = request.setBasicFilter.filter;
          assert.equal(filter.range.endRowIndex, undefined);
          copies.get(filter.range.sheetId)!.filter = filter;
        }
        if (request.appendDimension) {
          assert.equal(request.appendDimension.dimension, "ROWS");
          copies.get(request.appendDimension.sheetId)!.maximum += request.appendDimension.length;
        }
        if (request.updateCells) {
          const update = request.updateCells;
          assert.equal(update.fields, "userEnteredValue");
          const copy = copies.get(update.start.sheetId)!;
          for (const [offset, row] of update.rows.entries()) {
            const rowIndex = update.start.rowIndex + offset;
            assert.ok(rowIndex < copy.maximum, "grow rows before writing");
            while (copy.rows.length <= rowIndex) copy.rows.push([]);
            copy.rows[rowIndex] = row.values.map((cell) => {
              const value = cell.userEnteredValue;
              assert.equal(value?.formulaValue, undefined);
              return value?.stringValue ?? value?.numberValue ?? value?.boolValue ?? "";
            });
          }
        }
      }
      for (const sheet of sheets.values()) {
        const copy = copies.get(sheet.id)!;
        sheet.rows = copy.rows;
        sheet.maximum = copy.maximum;
        sheet.filter = copy.filter;
      }
      if (loseResponse) throw new Error("response interrupted");
    } } },
  });
  runInContext(code, context);
  const post = (body: unknown): SyncResponse => JSON.parse(context.doPost({ postData: { contents: typeof body === "string" ? body : JSON.stringify(body) } }));
  const request = (changes: RowChange[], deviceId = DEVICE_A, token = TOKEN_A) => post({ version: 1, action: "upload", deviceId, token, changes });
  return {
    context, sheets, properties, post, request,
    stats: () => ({ accesses, releases, calls, held, requests }),
    fail: (value: boolean) => { failBatch = value; },
    lose: (value: boolean) => { loseResponse = value; },
    lock: (value: boolean) => { allowLock = value; },
    during: (value: () => void) => { duringBatch = value; },
  };
}
function change(revision = 1, deviceId = DEVICE_A, source = "same-id"): RowChange {
  return { table: "Exercises", key: makeRowKey("Exercises", deviceId, source), values: [source, 0, "Squat", "Legs", "Barbell", 5, 2.5], revision, deleted: false };
}
function success(response: SyncResponse) {
  assert.equal(response.ok, true);
  if (!response.ok) throw new Error("Expected success");
  return response;
}

test("server headers and deployment settings match the client protocol", () => {
  const server = harness();
  assert.deepEqual(JSON.parse(JSON.stringify(server.context.WORKOUT_HEADERS)), HEADERS);
  const manifest = JSON.parse(readFileSync(resolve("server/appsscript.json"), "utf8").replace(/^\uFEFF/, ""));
  assert.deepEqual(manifest.webapp, { executeAs: "USER_DEPLOYING", access: "ANYONE_ANONYMOUS" });
  assert.ok(manifest.dependencies.enabledAdvancedServices.some((service: { userSymbol: string }) => service.userSymbol === "Sheets"));
});
test("invalid revoked and mismatched credentials cannot access spreadsheet data", () => {
  const server = harness();
  for (const body of [
    { version: 1, action: "hello", deviceId: DEVICE_A, token: TOKEN_B },
    { version: 1, action: "hello", deviceId: DEVICE_B, token: TOKEN_A },
    { version: 1, action: "hello", deviceId: DEVICE_A, token: "invalid" },
  ]) assert.equal(server.post(body).ok, false);
  server.properties.WORKOUT_DEVICES = "[]";
  assert.equal(server.request([change()]).ok, false);
  assert.equal(server.stats().accesses, 0);
  assert.equal(server.stats().releases, 0);
});
test("namespace and malformed payload validation rejects the entire batch before reads", () => {
  const server = harness();
  const invalid = [
    { ...change(), key: makeRowKey("Exercises", DEVICE_B, "same-id") },
    { ...change(), table: "Other" },
    { ...change(), values: ["short"] },
    { ...change(), revision: 0 },
    { ...change(), revision: Number.MAX_SAFE_INTEGER + 1 },
    { ...change(), values: ["x", 0, { injection: true }, "Legs", "Barbell", 5, 2.5] },
    { ...change(), key: `Exercises:${DEVICE_A}:%73ame-id` },
    { ...change(), values: ["x", 0, "a".repeat(4097), "Legs", "Barbell", 5, 2.5] },
  ];
  for (const row of invalid) assert.equal(server.request([change(2), row as RowChange]).ok, false);
  assert.equal(server.request([change(), change(2)]).ok, false);
  assert.equal(server.post("{").ok, false);
  assert.equal(server.post(" ".repeat(256 * 1024 + 1)).ok, false);
  assert.equal(server.request(Array.from({ length: 101 }, (_, i) => change(1, DEVICE_A, String(i)))).ok, false);
  assert.equal(server.stats().accesses, 0);
});
test("both device namespaces coexist and hello only returns that device maximum", () => {
  const server = harness();
  success(server.request([change(5)]));
  success(server.request([change(20, DEVICE_B)], DEVICE_B, TOKEN_B));
  const rows = server.sheets.get("Exercises")!.rows;
  assert.equal(rows.length, 3);
  assert.notEqual(rows[1][0], rows[2][0]);
  assert.equal(rows[1][1], DEVICE_A);
  assert.equal(rows[2][1], DEVICE_B);
  const hello = success(server.post({ version: 1, action: "hello", deviceId: DEVICE_A, token: TOKEN_A }));
  assert.deepEqual(hello, { version: 1, ok: true, deviceId: DEVICE_A, maxRevision: 5, acknowledged: [] });
  assert.equal(JSON.stringify(hello).includes("Squat"), false);
});
test("newer edits replace rows while duplicate and older requests are acknowledged without writes", () => {
  const server = harness();
  success(server.request([change(5)]));
  const newer = change(6);
  newer.values[2] = "Front squat";
  success(server.request([newer]));
  const before = server.stats().calls;
  assert.deepEqual(success(server.request([change(5)])).acknowledged, [{ key: change().key, revision: 5 }]);
  success(server.request([newer]));
  assert.equal(server.stats().calls, before);
  assert.equal(server.sheets.get("Exercises")!.rows[1][4], "Front squat");
});
test("persistent deletion markers prevent old uploads from resurrecting deleted rows", () => {
  const server = harness();
  success(server.request([change(5)]));
  const deleted = { ...change(6), deleted: true };
  success(server.request([deleted]));
  assert.ok(server.sheets.get("Exercises")!.rows[1].every((value) => value === ""));
  success(server.request([change(5)]));
  assert.equal(server.sheets.get("_Sync")!.rows[1][2], 6);
  assert.equal(server.sheets.get("_Sync")!.rows[1][3], true);
  assert.ok(server.sheets.get("Exercises")!.rows[1].every((value) => value === ""));
  success(server.request([change(7, DEVICE_A, "another-id")]));
  assert.equal(server.sheets.get("Exercises")!.rows.length, 2);
});
test("fresh key lookup remains correct when the owner sorts rows", () => {
  const server = harness();
  success(server.request([change(1, DEVICE_A, "one"), change(2, DEVICE_A, "two")]));
  server.sheets.get("Exercises")!.rows.reverse();
  const exerciseRows = server.sheets.get("Exercises")!.rows;
  exerciseRows.unshift(exerciseRows.pop()!);
  const ledgerRows = server.sheets.get("_Sync")!.rows;
  [ledgerRows[1], ledgerRows[2]] = [ledgerRows[2], ledgerRows[1]];
  const edited = change(3, DEVICE_A, "one");
  edited.values[2] = "Edited";
  success(server.request([edited]));
  const row = server.sheets.get("Exercises")!.rows.find((value) => value[0] === edited.key)!;
  assert.equal(row[4], "Edited");
  assert.equal(server.sheets.get("Exercises")!.rows.find((value) => value[0] === change(1, DEVICE_A, "two").key)![4], "Squat");
});
test("locking serializes overlapping device requests and releases after failures", () => {
  const server = harness();
  let concurrent: SyncResponse | undefined;
  server.during(() => { concurrent = server.request([change(1, DEVICE_B)], DEVICE_B, TOKEN_B); });
  success(server.request([change()]));
  assert.deepEqual(concurrent, { version: 1, ok: false, error: "Sync busy", retryable: true });
  assert.equal(server.stats().releases, 1);
  assert.equal(server.stats().held, false);
  server.lock(false);
  assert.equal(server.request([change(2)]).ok, false);
  assert.equal(server.stats().releases, 1);
});
test("an atomic write failure acknowledges no rows and a retry persists data and ledger together", () => {
  const server = harness();
  server.fail(true);
  const failed = server.request([change(), change(2, DEVICE_A, "other")]);
  assert.deepEqual(failed, { version: 1, ok: false, error: "Sync unavailable", retryable: true });
  assert.equal(JSON.stringify(failed).includes(TOKEN_A), false);
  assert.equal(server.sheets.get("Exercises")!.rows.length, 1);
  assert.equal(server.sheets.get("_Sync")!.rows.length, 1);
  assert.equal(server.stats().held, false);
  server.fail(false);
  assert.equal(success(server.request([change(), change(2, DEVICE_A, "other")])).acknowledged.length, 2);
  assert.equal(server.sheets.get("Exercises")!.rows.length, 3);
  assert.equal(server.sheets.get("_Sync")!.rows.length, 3);
});
test("a lost response is safely retried from the committed ledger", () => {
  const server = harness();
  server.lose(true);
  assert.equal(server.request([change()]).ok, false);
  server.lose(false);
  const before = server.stats().calls;
  assert.equal(success(server.request([change()])).acknowledged.length, 1);
  assert.equal(server.stats().calls, before);
  assert.equal(server.sheets.get("Exercises")!.rows.length, 2);
});
test("formula-looking text uses literal string values and scalar types are preserved", () => {
  const server = harness();
  const row = change();
  row.values[2] = '=IMPORTXML("https://example.com", "//x")';
  success(server.request([row]));
  const write = server.stats().requests.find((request) => request.updateCells?.start.sheetId === 1 + Object.keys(HEADERS).indexOf("Exercises"))!.updateCells!;
  assert.deepEqual(write.rows[0].values[4].userEnteredValue, { stringValue: row.values[2] });
  assert.equal(server.sheets.get("Exercises")!.rows[1][7], 5);
});
test("workbook initialization protects tabs without an email scope and hides the ledger", () => {
  const server = harness();
  delete server.properties.WORKOUT_SPREADSHEET_ID;
  for (const sheet of server.sheets.values()) sheet.rows = [];
  server.context.initializeWorkbook();
  assert.equal(server.properties.WORKOUT_SPREADSHEET_ID, "private-spreadsheet-id");
  for (const sheet of server.sheets.values()) {
    assert.equal(sheet.frozen, 1);
    assert.equal(sheet.protected, true);
    assert.ok(sheet.rows[0].length);
    assert.equal(sheet.filter?.range.endRowIndex, undefined);
    assert.equal(sheet.filter?.range.endColumnIndex, sheet.rows[0].length);
    assert.equal(sheet.filter?.range.startRowIndex, 0);
  }
  assert.equal(server.sheets.get("_Sync")!.hidden, true);
  assert.equal(server.stats().requests.length, 7);
  success(server.request([change(1, DEVICE_A, "one"), change(2, DEVICE_A, "two")]));
  assert.equal(server.sheets.get("Exercises")!.maximum, 3);
  assert.equal(server.sheets.get("Exercises")!.filter?.range.endRowIndex, undefined);
  assert.equal(server.stats().held, false);
});
test("setup utility creates private parseable per-device codes and hashes only server properties", () => {
  const bundle = createSetupBundle(ENDPOINT);
  const configured = JSON.parse(bundle.scriptProperties.WORKOUT_DEVICES) as { deviceId: string; tokenHash: string }[];
  assert.equal(bundle.devices.length, 2);
  assert.notEqual(bundle.devices[0].deviceId, bundle.devices[1].deviceId);
  for (const [index, device] of bundle.devices.entries()) {
    const credentials = parseConnectionCode(device.setupCode);
    assert.equal(credentials.deviceId, configured[index].deviceId);
    assert.equal(credentials.endpoint, ENDPOINT);
    assert.equal(credentials.token.length, 64);
    assert.equal(configured[index].tokenHash, createHash("sha256").update(credentials.token).digest("hex"));
    assert.equal(bundle.scriptProperties.WORKOUT_DEVICES.includes(credentials.token), false);
  }
  assert.equal(parseConnectionCode(createSetupBundle(ENDPOINT, 1, DEVICE_A).devices[0].setupCode).deviceId, DEVICE_A);
});
test("setup utility rejects unsafe endpoints repo output and unintended overwrite", () => {
  for (const endpoint of ["http://script.google.com/macros/s/id/exec", `${ENDPOINT}?secret=x`, ENDPOINT.replace("/exec", "/dev"), "https://example.com/exec"]) assert.throws(() => validateEndpoint(endpoint));
  assert.throws(() => createSetupBundle(ENDPOINT, 2, DEVICE_A));
  assert.throws(() => parseSetupArguments(["--endpoint", ENDPOINT, "--devices", "3"]));
  assert.equal(parseSetupArguments(["--endpoint", ENDPOINT, "--device-id", DEVICE_A]).count, 1);
  assert.throws(() => resolvePrivateOutput(process.cwd(), join(process.cwd(), "private-setup.json")));
  const directory = mkdtempSync(join(tmpdir(), "workout-setup-"));
  try {
    const output = join(directory, "private-setup.json");
    const bundle = createSetupBundle(ENDPOINT);
    writeSetupBundle(bundle, process.cwd(), output);
    assert.throws(() => writeSetupBundle(bundle, process.cwd(), output));
    writeSetupBundle(bundle, process.cwd(), output, true);
    assert.equal(JSON.parse(readFileSync(output, "utf8")).devices.length, 2);
  } finally {
    assert.equal(resolve(dirname(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith("workout-setup-"));
    rmSync(directory, { recursive: true, force: true });
  }
});
