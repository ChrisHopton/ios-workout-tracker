import { AppData, EQUIPMENT, MUSCLE_GROUPS, WorkoutTemplate } from "./types";

export const MAX_BACKUP_BYTES = 10 * 1024 * 1024;
type ObjectValue = Record<string, unknown>;
function fail(path: string, detail: string): never {
  throw new Error(`Invalid backup: ${path} ${detail}.`);
}
function object(value: unknown, path: string, keys: string[]): ObjectValue {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(path, "must be an object");
  const item = value as ObjectValue;
  for (const key of keys)
    if (!Object.prototype.hasOwnProperty.call(item, key))
      fail(`${path}.${key}`, "is missing");
  for (const key of Object.keys(item))
    if (!keys.includes(key))
      fail(`${path}.${key}`, "is not supported in version 1");
  return item;
}
function string(
  value: unknown,
  path: string,
  max = 200,
  allowEmpty = false,
): string {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (!allowEmpty && !value.trim()) ||
    Array.from(value).some(
      (char) =>
        char.charCodeAt(0) < 32 && ![9, 10, 13].includes(char.charCodeAt(0)),
    )
  )
    fail(
      path,
      `must be ${allowEmpty ? "a" : "a nonempty"} string of at most ${max} characters`,
    );
  return value;
}
function number(
  value: unknown,
  path: string,
  min: number,
  max: number,
  integer = false,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (integer && !Number.isInteger(value))
  )
    fail(
      path,
      `must be ${integer ? "an integer" : "a number"} between ${min} and ${max}`,
    );
  return value;
}
function choice(
  value: unknown,
  path: string,
  values: readonly string[],
): string {
  if (typeof value !== "string" || !values.includes(value))
    fail(path, `must be one of ${values.join(", ")}`);
  return value;
}
function array(value: unknown, path: string, max: number, min = 0): unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max)
    fail(path, `must contain between ${min} and ${max} items`);
  return value;
}
function unique(values: unknown[], path: string): void {
  if (new Set(values).size !== values.length)
    fail(path, "contains duplicate values");
}
function date(value: unknown, path: string): string {
  const result = string(value, path, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result))
    fail(path, "must be a YYYY-MM-DD calendar date");
  const parsed = new Date(`${result}T00:00:00.000Z`);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== result
  )
    fail(path, "is not a real calendar date");
  return result;
}
function timestamp(value: unknown, path: string): string {
  const result = string(value, path, 24);
  const parsed = new Date(result);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(result) ||
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString() !== result
  )
    fail(path, "must be an ISO UTC timestamp");
  return result;
}
function exercise(value: unknown, path: string): ObjectValue {
  const item = object(value, path, [
    "id",
    "name",
    "group",
    "equipment",
    "incrementLb",
    "incrementKg",
  ]);
  string(item.id, `${path}.id`, 100);
  string(item.name, `${path}.name`, 120);
  choice(item.group, `${path}.group`, MUSCLE_GROUPS);
  choice(item.equipment, `${path}.equipment`, EQUIPMENT);
  number(item.incrementLb, `${path}.incrementLb`, 0.001, 1000);
  number(item.incrementKg, `${path}.incrementKg`, 0.001, 1000);
  return item;
}
function target(value: unknown, path: string): ObjectValue {
  const item = object(value, path, ["exerciseId", "sets", "repMin", "repMax"]);
  string(item.exerciseId, `${path}.exerciseId`, 100);
  number(item.sets, `${path}.sets`, 1, 30, true);
  const min = number(item.repMin, `${path}.repMin`, 1, 1000, true);
  number(item.repMax, `${path}.repMax`, min, 1000, true);
  return item;
}
function templates(
  value: unknown,
  path: string,
  exerciseIds?: Set<unknown>,
): WorkoutTemplate[] {
  const items = array(value, path, 1000).map((value, index) => {
    const at = `${path}[${index}]`;
    const item = object(value, at, [
      "id",
      "title",
      "exercises",
      "weekdays",
      "archived",
      "updatedAt",
    ]);
    string(item.id, `${at}.id`, 100);
    string(item.title, `${at}.title`, 120);
    if (typeof item.archived !== "boolean")
      fail(`${at}.archived`, "must be true or false");
    timestamp(item.updatedAt, `${at}.updatedAt`);
    const days = array(item.weekdays, `${at}.weekdays`, 7);
    days.forEach((day, index) =>
      number(day, `${at}.weekdays[${index}]`, 0, 6, true),
    );
    unique(days, `${at}.weekdays`);
    const targets = array(item.exercises, `${at}.exercises`, 100, 1).map(
      (entry, index) => target(entry, `${at}.exercises[${index}]`),
    );
    unique(
      targets.map((entry) => entry.exerciseId),
      `${at}.exercises.exerciseId`,
    );
    if (exerciseIds)
      targets.forEach((entry, index) => {
        if (!exerciseIds.has(entry.exerciseId))
          fail(
            `${at}.exercises[${index}].exerciseId`,
            "does not reference an existing exercise",
          );
      });
    return item as unknown as WorkoutTemplate;
  });
  unique(
    items.map((item) => item.id),
    `${path}.id`,
  );
  for (let day = 0; day < 7; day++)
    if (
      items.filter((item) => !item.archived && item.weekdays.includes(day))
        .length > 2
    )
      fail(path, `assigns more than two active workouts to weekday ${day}`);
  return items;
}
function draft(value: unknown, path: string, reps: boolean): string {
  const result = string(value, path, 16, true);
  if (!(reps ? /^\d*$/ : /^\d*(\.\d*)?$/).test(result))
    fail(path, "must be a nonnegative numeric draft or empty");
  if (result && result !== "." && Number(result) > (reps ? 1000 : 100000))
    fail(path, "exceeds the supported range");
  return result;
}
function validate(value: unknown): AppData {
  const data = object(value, "backup", [
    "schemaVersion",
    "settings",
    "exercises",
    "templates",
    "scheduleRevisions",
    "sessions",
  ]);
  if (data.schemaVersion !== 1)
    fail("schemaVersion", "must be 1; this backup may need a newer app");
  const settings = object(data.settings, "settings", [
    "age",
    "gender",
    "heightCm",
    "unit",
  ]);
  const age = string(settings.age, "settings.age", 3, true);
  if (
    age !== "" &&
    (!/^\d+$/.test(age) || Number(age) < 1 || Number(age) > 130)
  )
    fail("settings.age", "must be empty or an age from 1 to 130");
  string(settings.gender, "settings.gender", 80, true);
  if (settings.heightCm !== null)
    number(settings.heightCm, "settings.heightCm", 1, 300);
  choice(settings.unit, "settings.unit", ["lb", "kg"]);
  const exercises = array(data.exercises, "exercises", 5000).map(
    (item, index) => exercise(item, `exercises[${index}]`),
  );
  unique(
    exercises.map((item) => item.id),
    "exercises.id",
  );
  templates(
    data.templates,
    "templates",
    new Set(exercises.map((item) => item.id)),
  );
  const revisions = array(
    data.scheduleRevisions,
    "scheduleRevisions",
    10000,
  ).map((value, index) => {
    const at = `scheduleRevisions[${index}]`;
    const item = object(value, at, [
      "id",
      "effectiveDate",
      "anchorMonday",
      "slots",
      "templates",
    ]);
    string(item.id, `${at}.id`, 100);
    date(item.effectiveDate, `${at}.effectiveDate`);
    const anchor = date(item.anchorMonday, `${at}.anchorMonday`);
    if (new Date(`${anchor}T00:00:00.000Z`).getUTCDay() !== 1)
      fail(`${at}.anchorMonday`, "must be a Monday");
    const snapshots = templates(item.templates, `${at}.templates`);
    const slots = array(item.slots, `${at}.slots`, 7).map((value, index) => {
      const slotAt = `${at}.slots[${index}]`;
      const slot = object(value, slotAt, ["weekday", "workoutIds"]);
      number(slot.weekday, `${slotAt}.weekday`, 0, 6, true);
      const ids = array(slot.workoutIds, `${slotAt}.workoutIds`, 2);
      ids.forEach((id, index) => {
        string(id, `${slotAt}.workoutIds[${index}]`, 100);
        const workout = snapshots.find((template) => template.id === id);
        if (
          !workout ||
          workout.archived ||
          !workout.weekdays.includes(slot.weekday as number)
        )
          fail(
            `${slotAt}.workoutIds[${index}]`,
            "must reference an active snapshot assigned to this weekday",
          );
      });
      unique(ids, `${slotAt}.workoutIds`);
      return slot;
    });
    unique(
      slots.map((slot) => slot.weekday),
      `${at}.slots.weekday`,
    );
    for (const snapshot of snapshots.filter((template) => !template.archived))
      for (const day of snapshot.weekdays) {
        if (
          !slots.some(
            (slot) =>
              slot.weekday === day &&
              (slot.workoutIds as unknown[]).includes(snapshot.id),
          )
        )
          fail(
            `${at}.slots`,
            "must contain every active snapshot weekday assignment",
          );
      }
    return item;
  });
  unique(
    revisions.map((item) => item.id),
    "scheduleRevisions.id",
  );
  unique(
    revisions.map((item) => item.effectiveDate),
    "scheduleRevisions.effectiveDate",
  );
  const sessions = array(data.sessions, "sessions", 20000).map(
    (value, index) => {
      const at = `sessions[${index}]`;
      const item = object(value, at, [
        "id",
        "date",
        "title",
        "templateId",
        "unit",
        "status",
        "startedAt",
        "updatedAt",
        "finishedAt",
        "exercises",
      ]);
      string(item.id, `${at}.id`, 100);
      date(item.date, `${at}.date`);
      string(item.title, `${at}.title`, 120);
      string(item.templateId, `${at}.templateId`, 100);
      choice(item.unit, `${at}.unit`, ["lb", "kg"]);
      choice(item.status, `${at}.status`, ["in_progress", "completed"]);
      timestamp(item.startedAt, `${at}.startedAt`);
      timestamp(item.updatedAt, `${at}.updatedAt`);
      if (item.finishedAt !== null)
        timestamp(item.finishedAt, `${at}.finishedAt`);
      if (item.status === "completed" && item.finishedAt === null)
        fail(`${at}.finishedAt`, "is required for a finished workout");
      if (item.status === "in_progress" && item.finishedAt !== null)
        fail(`${at}.finishedAt`, "must be null while recording");
      const entries = array(item.exercises, `${at}.exercises`, 100, 1).map(
        (value, index) => {
          const entryAt = `${at}.exercises[${index}]`;
          const entry = object(value, entryAt, [
            "exercise",
            "target",
            "suggestion",
            "sets",
          ]);
          const definition = exercise(entry.exercise, `${entryAt}.exercise`);
          const prescription = target(entry.target, `${entryAt}.target`);
          if (prescription.exerciseId !== definition.id)
            fail(
              `${entryAt}.target.exerciseId`,
              "must match its exercise snapshot",
            );
          const suggestion = object(entry.suggestion, `${entryAt}.suggestion`, [
            "weights",
            "reason",
          ]);
          string(suggestion.reason, `${entryAt}.suggestion.reason`, 2000);
          const weights = array(
            suggestion.weights,
            `${entryAt}.suggestion.weights`,
            prescription.sets as number,
            prescription.sets as number,
          );
          weights.forEach((weight, index) => {
            if (weight !== null)
              number(
                weight,
                `${entryAt}.suggestion.weights[${index}]`,
                0,
                100000,
              );
          });
          if (
            definition.equipment === "bodyweight" &&
            weights.some((weight) => weight !== null)
          )
            fail(
              `${entryAt}.suggestion.weights`,
              "must be null for bodyweight exercises",
            );
          array(
            entry.sets,
            `${entryAt}.sets`,
            prescription.sets as number,
            prescription.sets as number,
          ).forEach((value, index) => {
            const setAt = `${entryAt}.sets[${index}]`;
            const set = object(value, setAt, ["weight", "reps", "status"]);
            const weight = draft(set.weight, `${setAt}.weight`, false);
            const reps = draft(set.reps, `${setAt}.reps`, true);
            choice(set.status, `${setAt}.status`, [
              "pending",
              "completed",
              "skipped",
            ]);
            if (set.status === "completed") {
              if (weight && Number(weight) > 10000)
                fail(
                  `${setAt}.weight`,
                  "must not exceed 10000 for a completed set",
                );
              if (!reps || Number(reps) < 1)
                fail(
                  `${setAt}.reps`,
                  "requires at least one rep for a completed set",
                );
              if (
                definition.equipment !== "bodyweight" &&
                (!weight || weight === ".")
              )
                fail(
                  `${setAt}.weight`,
                  "requires a weight for a completed set",
                );
            }
            if (item.status === "completed" && set.status === "pending")
              fail(
                `${setAt}.status`,
                "must be completed or explicitly skipped in a finished workout",
              );
          });
          return definition.id;
        },
      );
      unique(entries, `${at}.exercises.exercise.id`);
      if (
        item.status === "completed" &&
        !(item.exercises as ObjectValue[]).some((entry) =>
          (entry.sets as ObjectValue[]).some(
            (set) => set.status === "completed",
          ),
        )
      )
        fail(
          `${at}.exercises`,
          "requires at least one completed set in a finished workout",
        );
      return item;
    },
  );
  unique(
    sessions.map((item) => item.id),
    "sessions.id",
  );
  unique(
    sessions.map((item) => item.date),
    "sessions.date",
  );
  return data as unknown as AppData;
}
function byteLength(text: string): number {
  // Avoid a Node Buffer dependency in React Native. Count UTF-8 bytes, including surrogate pairs.
  let bytes = 0;
  for (let index = 0; index < text.length; index++) {
    const point = text.charCodeAt(index);
    if (point < 0x80) bytes += 1;
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
    if (bytes > MAX_BACKUP_BYTES) return bytes;
  }
  return bytes;
}
export function parseBackup(text: string): AppData {
  if (
    typeof text !== "string" ||
    text.length > MAX_BACKUP_BYTES ||
    byteLength(text) > MAX_BACKUP_BYTES
  )
    throw new Error(
      "Backup is too large. Choose a JSON backup smaller than 10 MiB.",
    );
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(
      "This file is not valid JSON. Choose a Workout backup exported from Settings.",
    );
  }
  return validate(value);
}
export function serializeBackup(data: AppData): string {
  validate(data);
  const text = JSON.stringify(data, null, 2);
  if (byteLength(text) > MAX_BACKUP_BYTES)
    throw new Error("Backup exceeds the 10 MiB size limit.");
  return text;
}
