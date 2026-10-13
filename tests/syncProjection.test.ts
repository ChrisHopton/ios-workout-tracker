import test from "node:test";
import assert from "node:assert/strict";
import { AppData, WorkoutSession, WorkoutTemplate } from "../src/domain/types";
import {
  byteLength,
  HEADERS,
  makeBatch,
  makeRowKey,
  MAX_BATCH_BYTES,
  MAX_BATCH_ROWS,
  MAX_ROW_BYTES,
  parseConnectionCode,
  parseSyncResponse,
  RowChange,
  SheetRow,
  SyncCredentials,
  validateCredentials,
  validateEndpoint,
} from "../src/sync/protocol";
import {
  changedRows,
  makePeopleRow,
  projectData,
  projectMetadata,
  projectSession,
} from "../src/sync/projection";

const DEVICE_A = "11111111-1111-4111-8111-111111111111";
const DEVICE_B = "22222222-2222-4222-8222-222222222222";
const credentials: SyncCredentials = {
  version: 1,
  endpoint: "https://script.google.com/macros/s/FAKE_deployment-123/exec",
  deviceId: DEVICE_A,
  token: "0".repeat(64),
};
const timestamp = "2025-03-09T12:34:56.000Z";

function fixture(): AppData {
  const template: WorkoutTemplate = {
    id: "plan:one/日本",
    title: "=SUM(1,2)",
    exercises: [{ exerciseId: "exercise:one/日本", sets: 2, repMin: 8, repMax: 12 }],
    weekdays: [6, 0],
    archived: false,
    updatedAt: timestamp,
  };
  const unused: WorkoutTemplate = {
    id: "plan:unused",
    title: "=SUM(1,2)",
    exercises: [{ exerciseId: "exercise:bodyweight", sets: 1, repMin: 5, repMax: 9 }],
    weekdays: [],
    archived: true,
    updatedAt: "2024-12-31T01:00:00.000Z",
  };
  const session: WorkoutSession = {
    id: "session:old/🧪",
    date: "2025-03-09",
    title: "Old title",
    templateId: template.id,
    unit: "kg",
    status: "in_progress",
    startedAt: timestamp,
    updatedAt: timestamp,
    finishedAt: null,
    exercises: [
      {
        exercise: {
          id: "exercise:one/日本",
          name: "Historical lift",
          group: "Back",
          equipment: "barbell",
          incrementLb: 10,
          incrementKg: 5,
        },
        target: { exerciseId: "exercise:one/日本", sets: 2, repMin: 3, repMax: 7 },
        suggestion: { weights: [0, 52.5], reason: "=literal suggestion 🧪" },
        sets: [
          { weight: "0", reps: "007", status: "completed" },
          { weight: "", reps: "", status: "pending" },
        ],
      },
      {
        exercise: {
          id: "exercise:bodyweight",
          name: "Old push-up",
          group: "Chest",
          equipment: "bodyweight",
          incrementLb: 5,
          incrementKg: 2.5,
        },
        target: { exerciseId: "exercise:bodyweight", sets: 2, repMin: 10, repMax: 15 },
        suggestion: { weights: [null, null], reason: "Bodyweight reps only" },
        sets: [
          { weight: "", reps: "12", status: "completed" },
          { weight: "", reps: "", status: "skipped" },
        ],
      },
    ],
  };
  return {
    schemaVersion: 1,
    settings: { age: "29", gender: "+literal gender", heightCm: 181.5, unit: "lb" },
    exercises: [
      { ...session.exercises[0].exercise, name: "Current lift", incrementLb: 5, incrementKg: 2.5 },
      { ...session.exercises[1].exercise, name: "Current push-up" },
    ],
    templates: [template, unused],
    scheduleRevisions: [{
      id: "revision:old",
      effectiveDate: "2025-03-09",
      anchorMonday: "2025-03-03",
      slots: [{ weekday: 6, workoutIds: [template.id] }, { weekday: 0, workoutIds: [] }],
      templates: [
        { ...template, title: "Historical plan", exercises: [{ ...template.exercises[0], sets: 4 }] },
        unused,
      ],
    }],
    sessions: [session],
  };
}
function columns(item: SheetRow): Record<string, unknown> {
  assert.equal(item.values.length, HEADERS[item.table].length);
  return Object.fromEntries(HEADERS[item.table].map((header, index) => [header, item.values[index]]));
}
function encodeCode(value: unknown): string {
  return `WORKOUT1.${Buffer.from(JSON.stringify(value), "utf8").toString("base64url")}`;
}
function change(index: number, gender = ""): RowChange {
  return {
    ...makePeopleRow({ age: "", gender, heightCm: null, unit: "lb" }, DEVICE_A, "Phone"),
    key: makeRowKey("People", DEVICE_A, "profile", index),
    revision: index + 1,
    deleted: false,
  };
}

test("projection snapshots use fixed scalar columns and canonical device scoped keys", () => {
  const data = fixture();
  const before = JSON.stringify(data);
  const rows = projectData(data, DEVICE_A, "=literal phone 🧪");
  assert.equal(new Set(rows.map((item) => item.key)).size, rows.length);
  for (const item of rows) {
    assert.equal(item.values.length, HEADERS[item.table].length);
    assert.ok(byteLength(JSON.stringify(item)) < MAX_ROW_BYTES);
    assert.ok(item.values.every((value) => value === null || ["string", "number", "boolean"].includes(typeof value)));
    assert.ok(item.key.startsWith(`${item.table}:${DEVICE_A}:`));
    for (const part of item.key.split(":"))
      assert.equal(encodeURIComponent(decodeURIComponent(part)), part);
  }
  assert.deepEqual(rows[0], {
    table: "People",
    key: `People:${DEVICE_A}:profile`,
    values: ["=literal phone 🧪", "29", "+literal gender", 181.5, "lb"],
  });
  assert.equal(JSON.stringify(data), before);
  assert.deepEqual(projectData(data, DEVICE_A, "=literal phone 🧪"), rows);
  assert.deepEqual(projectData(data, DEVICE_A, "Phone"), [
    ...projectMetadata(data, DEVICE_A, "Phone"),
    ...projectSession(data.sessions[0], DEVICE_A),
  ]);
});

test("same names and IDs across two phones keep distinct rows and preserve literal text", () => {
  const data = fixture();
  const first = projectData(data, DEVICE_A, "Same phone name");
  const second = projectData(data, DEVICE_B, "Same phone name");
  assert.equal(first.length, second.length);
  assert.equal(new Set([...first, ...second].map((item) => item.key)).size, first.length * 2);
  assert.deepEqual(first.map((item) => item.values), second.map((item) => item.values));
  const plans = first.filter((item) => item.table === "Plans" && columns(item)["Row type"] === "template");
  assert.equal(plans.length, 2);
  assert.notEqual(plans[0].key, plans[1].key);
  assert.equal(columns(plans[0]).Title, "=SUM(1,2)");
  assert.equal(columns(plans[1]).Title, "=SUM(1,2)");
  assert.equal(makeRowKey("Workouts", DEVICE_A, "a:b/c % 日本"), `Workouts:${DEVICE_A}:a%3Ab%2Fc%20%25%20%E6%97%A5%E6%9C%AC`);
});

test("historical schedules retain empty slots unassigned templates and ordered targets", () => {
  const data = fixture();
  const rows = projectMetadata(data, DEVICE_A, "Phone");
  const history = rows.filter((item) => item.table === "Schedules").map(columns);
  assert.deepEqual(history.find((item) => item["Row type"] === "revision"), {
    "Row type": "revision", "Revision ID": "revision:old", "Revision index": 0,
    "Effective date": "2025-03-09", "Anchor Monday": "2025-03-03", "Slot index": null,
    Weekday: null, "Workout index": null, "Workout ID": null, "Template index": null,
    "Template ID": null, Title: null, Archived: null, "Updated at": null,
    "Exercise index": null, "Exercise ID": null, Sets: null, "Rep min": null,
    "Rep max": null, "Template weekday index": null, "Template weekday": null,
  });
  assert.deepEqual(history.filter((item) => item["Row type"] === "slot").map((item) => [item["Slot index"], item.Weekday]), [[0, 6], [1, 0]]);
  assert.deepEqual(history.filter((item) => item["Row type"] === "assignment").map((item) => [item["Slot index"], item["Workout index"], item["Workout ID"]]), [[0, 0, data.templates[0].id]]);
  const headers = history.filter((item) => item["Row type"] === "template");
  assert.deepEqual(headers.map((item) => [item["Template index"], item["Template ID"], item.Title, item.Archived, item["Updated at"]]), [
    [0, data.templates[0].id, "Historical plan", false, timestamp],
    [1, "plan:unused", "=SUM(1,2)", true, "2024-12-31T01:00:00.000Z"],
  ]);
  const target = history.find((item) => item["Row type"] === "exercise" && item["Template index"] === 0)!;
  assert.deepEqual([target["Exercise index"], target["Exercise ID"], target.Sets, target["Rep min"], target["Rep max"]], [0, data.exercises[0].id, 4, 8, 12]);
  assert.deepEqual(history.filter((item) => item["Row type"] === "weekday").map((item) => [item["Template weekday index"], item["Template weekday"]]), [[0, 6], [1, 0]]);
  const changed = structuredClone(data);
  changed.templates[0].title = "New name";
  changed.templates[0].exercises[0].repMin = 9;
  changed.exercises[0].name = "New definition";
  assert.equal(changedRows(rows, projectMetadata(changed, DEVICE_A, "Phone")).some((item) => item.table === "Schedules"), false);
});

test("sets preserve the complete historical definition targets suggestions unit and actual drafts", () => {
  const data = fixture();
  const rows = projectSession(data.sessions[0], DEVICE_A);
  assert.deepEqual(columns(rows[0]), {
    "Session ID": "session:old/🧪", Date: "2025-03-09", Title: "Old title",
    "Template ID": data.templates[0].id, Unit: "kg", Status: "in_progress",
    "Started at": timestamp, "Updated at": timestamp, "Finished at": null, "Exercise count": 2,
  });
  const sets = rows.filter((item) => item.table === "Sets" && columns(item)["Row type"] === "set").map(columns);
  assert.deepEqual(sets[0], {
    "Row type": "set", "Session ID": "session:old/🧪", "Exercise index": 0,
    "Exercise ID": data.exercises[0].id, "Exercise name": "Historical lift",
    "Muscle group": "Back", Equipment: "barbell", "Increment lb": 10,
    "Increment kg": 5, "Target exercise ID": data.exercises[0].id,
    "Target sets": 2, "Target rep min": 3, "Target rep max": 7,
    "Suggestion reason": "=literal suggestion 🧪", "Recorded set count": 2,
    "Suggestion count": 2, "Set index": 0, "Suggested weight": 0,
    "Suggestion present": true, "Actual present": true, "Actual weight": "0",
    "Actual reps": "007", "Set status": "completed",
  });
  assert.deepEqual(sets.map((item) => [item["Exercise index"], item["Set index"], item["Suggested weight"], item["Actual weight"], item["Actual reps"], item["Set status"]]), [
    [0, 0, 0, "0", "007", "completed"], [0, 1, 52.5, "", "", "pending"],
    [1, 0, null, "", "12", "completed"], [1, 1, null, "", "", "skipped"],
  ]);
  assert.equal(sets[2].Equipment, "bodyweight");
  const changed = structuredClone(data);
  changed.settings.unit = "kg";
  changed.exercises[0].name = "Renamed current definition";
  changed.templates[0].exercises[0].sets = 3;
  assert.deepEqual(projectSession(changed.sessions[0], DEVICE_A), rows);
  const finished = { ...data.sessions[0], status: "completed" as const, finishedAt: timestamp };
  assert.equal(columns(projectSession(finished, DEVICE_A)[0])["Finished at"], timestamp);
});

test("prescribed missing actuals and suggestions stay distinct from blank and null entries", () => {
  const session = fixture().sessions[0];
  session.exercises[0].sets = [session.exercises[0].sets[0]];
  session.exercises[0].suggestion.weights = [null];
  const rows = projectSession(session, DEVICE_A).filter((item) => item.table === "Sets").map(columns);
  const header = rows.find((item) => item["Row type"] === "exercise" && item["Exercise index"] === 0)!;
  assert.equal(header["Recorded set count"], 1);
  assert.equal(header["Suggestion count"], 1);
  const sets = rows.filter((item) => item["Row type"] === "set" && item["Exercise index"] === 0);
  assert.equal(sets[0]["Suggested weight"], null);
  assert.equal(sets[0]["Suggestion present"], true);
  assert.equal(sets[1]["Suggestion present"], false);
  assert.equal(sets[1]["Actual present"], false);
  assert.equal(sets[1]["Actual weight"], null);
});

test("clear versus zero changes exactly one set row and deletion creates fixed length tombstones", () => {
  const data = fixture();
  const before = projectData(data, DEVICE_A, "Phone");
  const changed = structuredClone(data);
  changed.sessions[0].exercises[0].sets[0].weight = "";
  const delta = changedRows(before, projectData(changed, DEVICE_A, "Phone"));
  assert.equal(delta.length, 1);
  assert.equal(delta[0].table, "Sets");
  assert.equal(delta[0].deleted, false);
  assert.equal(columns(delta[0])["Actual weight"], "");
  const removed = changedRows(before, projectMetadata(data, DEVICE_A, "Phone"));
  assert.equal(removed.length, projectSession(data.sessions[0], DEVICE_A).length);
  assert.ok(removed.every((item) => item.deleted && ["Workouts", "Sets"].includes(item.table)));
  assert.deepEqual(removed.map(({ deleted, ...item }) => item), projectSession(data.sessions[0], DEVICE_A));
  assert.deepEqual(changedRows(before, before), []);
  assert.deepEqual(changedRows([], before), before.map((item) => ({ ...item, deleted: false })));
});

test("renaming a phone changes only its People row even with a large history", () => {
  const data = fixture();
  data.sessions = Array.from({ length: 200 }, (_, index) => ({ ...data.sessions[0], id: `history-${index}` }));
  const before = projectData(data, DEVICE_A, "Before");
  const changed = changedRows(before, projectData(data, DEVICE_A, "After"));
  assert.equal(changed.length, 1);
  assert.equal(changed[0].table, "People");
  assert.equal(changed[0].values[0], "After");
});

test("large templates and schedule snapshots split into rows below the per row bound", () => {
  const data = fixture();
  const large = data.templates[0];
  large.exercises = Array.from({ length: 100 }, (_, index) => ({ exerciseId: `id-${index}`, sets: 30, repMin: 1, repMax: 1000 }));
  data.scheduleRevisions[0].templates = [structuredClone(large), data.templates[1]];
  const rows = projectMetadata(data, DEVICE_A, "Phone");
  assert.equal(rows.filter((item) => item.table === "Plans" && columns(item)["Row type"] === "exercise").length, 101);
  assert.equal(rows.filter((item) => item.table === "Schedules" && columns(item)["Row type"] === "exercise").length, 101);
  assert.ok(rows.every((item) => byteLength(JSON.stringify(item)) < MAX_ROW_BYTES));
});

test("UTF8 counting matches browser encoded bytes including surrogate replacement", () => {
  for (const value of ["", "ascii", "é", "日本", "🧪", "aé日本🧪z", "\ud800", "\udfff", "\ud800A"])
    assert.equal(byteLength(value), Buffer.byteLength(value, "utf8"));
});

test("batches retain a bounded leading prefix by both row count and exact UTF8 body bytes", () => {
  const short = Array.from({ length: 105 }, (_, index) => change(index));
  const rowLimited = makeBatch(credentials, short);
  assert.equal(rowLimited.action, "upload");
  assert.equal(rowLimited.changes!.length, MAX_BATCH_ROWS);
  assert.deepEqual(rowLimited.changes, short.slice(0, MAX_BATCH_ROWS));
  assert.equal(short.length, 105);
  const unicode = Array.from({ length: 100 }, (_, index) => change(index, "🧪".repeat(1900)));
  const byteLimited = makeBatch(credentials, unicode);
  const count = byteLimited.changes!.length;
  assert.ok(count > 0 && count < MAX_BATCH_ROWS);
  assert.deepEqual(byteLimited.changes, unicode.slice(0, count));
  assert.ok(byteLength(JSON.stringify(byteLimited)) <= MAX_BATCH_BYTES);
  assert.ok(byteLength(JSON.stringify({ ...byteLimited, changes: unicode.slice(0, count + 1) })) > MAX_BATCH_BYTES);
  assert.deepEqual(makeBatch(credentials, []).changes, []);
});

test("oversized and malformed rows fail generically even beyond the selected prefix", () => {
  const rows = Array.from({ length: 100 }, (_, index) => change(index));
  const oversized = change(100, "🧪".repeat(MAX_ROW_BYTES));
  assert.throws(() => makeBatch(credentials, [...rows, oversized]), /exceeds the supported size/);
  for (const bad of [
    { ...change(0), revision: 0 },
    { ...change(0), revision: Number.MAX_SAFE_INTEGER + 1 },
    { ...change(0), values: [] },
    { ...change(0), key: makeRowKey("People", DEVICE_B, "profile") },
    { ...change(0), key: `People:${DEVICE_A}:lower%2fslash` },
    { ...change(0), values: ["Phone", "", "", Infinity, "lb"] },
  ])
    assert.throws(() => makeBatch(credentials, [bad]), /Invalid sync row/);
});

test("connection codes require canonical encoding bounded size exact credentials and allowed endpoint", () => {
  assert.deepEqual(validateCredentials(credentials), credentials);
  assert.equal(validateEndpoint(credentials.endpoint), credentials.endpoint);
  const code = encodeCode(credentials);
  assert.deepEqual(parseConnectionCode(code), credentials);
  assert.deepEqual(parseConnectionCode(`  ${code}\n`), credentials);
  for (const endpoint of [
    "http://script.google.com/macros/s/id/exec",
    "https://script.google.com.evil.example/macros/s/id/exec",
    "https://script.google.com/macros/s/id/exec?secret=x",
    "https://script.google.com/macros/s/id/exec#fragment",
    "https://user@script.google.com/macros/s/id/exec",
    "https://script.google.com/macros/s/with.dot/exec",
    "https://script.google.com/macros/s/id/dev",
    "https://script.google.com/macros/s/id/exec\n",
  ])
    assert.throws(() => parseConnectionCode(encodeCode({ ...credentials, endpoint })), /Invalid Sheets connection code/);
  for (const value of [
    { ...credentials, version: 2 }, { ...credentials, deviceId: "not-a-uuid" },
    { ...credentials, deviceId: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA" },
    { ...credentials, token: "A".repeat(64) }, { ...credentials, token: "0".repeat(63) },
    { ...credentials, extra: true }, { ...credentials, endpoint: undefined },
  ])
    assert.throws(() => parseConnectionCode(encodeCode(value)), /Invalid Sheets connection code/);
  for (const invalid of ["", code.replace("WORKOUT1.", "WORKOUT2."), `${code}=`, "WORKOUT1._w", "WORKOUT1.A", `WORKOUT1.${"A".repeat(4096)}`, null])
    assert.throws(() => parseConnectionCode(invalid), /Invalid Sheets connection code/);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let noncanonical = code;
  if ((code.length - 9) % 4 === 0) noncanonical = encodeCode({ ...credentials, endpoint: credentials.endpoint.replace("123", "1234") });
  const last = noncanonical.at(-1)!;
  noncanonical = noncanonical.slice(0, -1) + alphabet[alphabet.indexOf(last) + 1];
  assert.throws(() => parseConnectionCode(noncanonical), /Invalid Sheets connection code/);
});

test("responses validate device revision acknowledgments and failure shape before changing local state", () => {
  const key = makeRowKey("Workouts", DEVICE_A, "session");
  const success = { version: 1, ok: true, deviceId: DEVICE_A, maxRevision: 4, acknowledged: [{ key, revision: 4 }] };
  assert.deepEqual(parseSyncResponse(success, DEVICE_A), success);
  assert.deepEqual(parseSyncResponse({ ...success, maxRevision: 0, acknowledged: [] }, DEVICE_A), { ...success, maxRevision: 0, acknowledged: [] });
  const failure = { version: 1, ok: false, error: "Temporary service issue", retryable: true };
  assert.deepEqual(parseSyncResponse(failure, DEVICE_A), failure);
  for (const value of [
    null, [], { ...success, version: 2 }, { ...success, ok: "true" },
    { ...success, deviceId: DEVICE_B }, { ...success, maxRevision: -1 },
    { ...success, maxRevision: 4.5 }, { ...success, extra: true },
    { ...success, acknowledged: [{ key, revision: 0 }] },
    { ...success, acknowledged: [{ key, revision: 5 }] },
    { ...success, acknowledged: [{ key, revision: 4, extra: true }] },
    { ...success, acknowledged: [{ key, revision: 4 }, { key, revision: 3 }] },
    { ...success, acknowledged: [{ key: makeRowKey("Sets", DEVICE_B, "session"), revision: 4 }] },
    { ...success, acknowledged: [{ key: `Unknown:${DEVICE_A}:session`, revision: 4 }] },
    { ...success, acknowledged: [{ key: `Sets:${DEVICE_A}:bad%2fkey`, revision: 4 }] },
    { ...failure, retryable: "true" }, { ...failure, error: "" },
    { ...failure, error: "e".repeat(301) }, { ...failure, extra: true },
  ])
    assert.throws(() => parseSyncResponse(value, DEVICE_A), /Invalid Sheets response/);
});
