import { routineDueDate } from "./routineEngine";
import { AppData, EQUIPMENT, MUSCLE_GROUPS, WorkoutRecurrence, WorkoutSession, WorkoutTemplate } from "./types";
import { addDays, weekdayIndex } from "./dates";
import { templateOccursOn } from "./schedule";
import { ageFromDateOfBirth, emptyProfileSettings, normalizePhone, validateProfileDraft } from "./profile";

export type LegacyProfileSettings = { age: string; gender: string; heightCm: number | null; unit: AppData["settings"]["unit"] };
export type LegacyV3Session = Omit<WorkoutSession, "hasFinished" | "routineOccurrence">;
export type LegacyV3AppData = Omit<AppData, "schemaVersion" | "routineProgress" | "scheduleRevisions" | "sessions"> & {
  schemaVersion: 3;
  scheduleRevisions: Omit<AppData["scheduleRevisions"][number], "routine">[];
  sessions: LegacyV3Session[];
};
export type LegacyV2AppData = Omit<LegacyV3AppData, "schemaVersion" | "settings"> & { schemaVersion: 2; settings: LegacyProfileSettings };
export type StoredAppData = AppData | LegacyV3AppData | LegacyV2AppData | LegacyAppData;

export type LegacyTemplate = Omit<WorkoutTemplate, "recurrence">;
type LegacySessionExercise = Omit<WorkoutSession["exercises"][number], "sets" | "suggestion"> & {
  sets: Omit<WorkoutSession["exercises"][number]["sets"][number], "classification">[];
  suggestion: Omit<WorkoutSession["exercises"][number]["suggestion"], "algorithmVersion">;
};
export type LegacyAppData = Omit<LegacyV2AppData, "schemaVersion" | "bodyWeights" | "templates" | "scheduleRevisions" | "sessions"> & {
  schemaVersion: 1;
  templates: LegacyTemplate[];
  scheduleRevisions: {
    id: string;
    effectiveDate: string;
    anchorMonday: string;
    slots: { weekday: number; workoutIds: string[] }[];
    templates: LegacyTemplate[];
  }[];
  sessions: (Omit<LegacyV3Session, "exercises"> & { exercises: LegacySessionExercise[] })[];
};

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
      fail(`${path}.${key}`, "is not supported in this version");
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
  version: 1 | 2 | 3 | 4,
  exerciseIds?: Set<unknown>,
  checkConflicts = true,
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
      ...(version >= 2 ? ["recurrence"] : []),
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
    if (version >= 2) {
      const raw = item.recurrence as ObjectValue | null;
      const kind = raw && choice(raw.kind, `${at}.recurrence.kind`, ["weekly", "biweekly", "legacy"]);
      const recurrence = object(raw, `${at}.recurrence`, kind === "weekly"
        ? ["kind"]
        : kind === "biweekly"
          ? ["kind", "anchorMonday"]
          : ["kind", "anchorMonday", "weekdaysA", "weekdaysB"]);
      if (kind !== "weekly") {
        const anchor = date(recurrence.anchorMonday, `${at}.recurrence.anchorMonday`);
        if (new Date(`${anchor}T00:00:00.000Z`).getUTCDay() !== 1)
          fail(`${at}.recurrence.anchorMonday`, "must be a Monday");
      }
      if (kind === "legacy") {
        for (const key of ["weekdaysA", "weekdaysB"]) {
          const cycleDays = array(recurrence[key], `${at}.recurrence.${key}`, 7);
          for (const day of cycleDays) {
            number(day, `${at}.recurrence.${key}`, 0, 6, true);
            if (!days.includes(day)) fail(`${at}.recurrence.${key}`, "must use selected weekdays");
          }
          unique(cycleDays, `${at}.recurrence.${key}`);
        }
        const cycleDays = [...recurrence.weekdaysA as number[], ...recurrence.weekdaysB as number[]];
        if (days.some((day) => !cycleDays.includes(day as number)))
          fail(`${at}.recurrence`, "must schedule every selected weekday in at least one week");
      }
    }
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
  if (version === 1) for (let day = 0; day < 7; day++)
    if (
      items.filter((item) => !item.archived && item.weekdays.includes(day))
        .length > 2
    )
      fail(path, `assigns more than two active workouts to weekday ${day}`);
  if (version >= 2 && checkConflicts) {
    for (let offset = 0; offset < 14; offset++) {
      const date = addDays("2000-01-03", offset);
      if (items.filter((item) => templateOccursOn(item, date)).length > 1)
        fail(path, "contains conflicting workout recurrences");
    }
  }
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
function validateRoutine(value: unknown, path: string, snapshots: WorkoutTemplate[]) {
  const mode = choice((value as ObjectValue | null)?.mode, path + ".mode", ["fixed", "flexible"]);
  const routine = object(value, path, mode === "fixed" ? ["mode"] : ["mode", "id", "weekdays", "sequence", "startIndex", "startDate"]);
  if (mode === "fixed") return;
  string(routine.id, path + ".id", 100);
  const days = array(routine.weekdays, path + ".weekdays", 7, 1);
  days.forEach(day => number(day, path + ".weekdays", 0, 6, true));
  unique(days, path + ".weekdays");
  const sequence = array(routine.sequence, path + ".sequence", 1000, 1);
  for (const id of sequence) {
    string(id, path + ".sequence", 100);
    if (!snapshots.some(template => template.id === id && !template.archived))
      fail(path + ".sequence", "must reference active snapshot templates");
  }
  number(routine.startIndex, path + ".startIndex", 0, sequence.length - 1, true);
  date(routine.startDate, path + ".startDate");
}
function validateOccurrence(value: unknown, path: string): ObjectValue {
  const item = object(value, path, ["routineId", "ordinal", "templateId", "dueDate"]);
  string(item.routineId, path + ".routineId", 100);
  number(item.ordinal, path + ".ordinal", 0, Number.MAX_SAFE_INTEGER, true);
  string(item.templateId, path + ".templateId", 100);
  date(item.dueDate, path + ".dueDate");
  return item;
}
function validateRoutineLinks(data: ObjectValue, revisions: ObjectValue[], sessions: ObjectValue[]) {
  const routines = new Map<string, AppData["scheduleRevisions"][number]["routine"] & { mode: "flexible" }>();
  for (const revision of [...revisions].sort((a, b) => String(a.effectiveDate).localeCompare(String(b.effectiveDate)))) {
    const routine = revision.routine as AppData["scheduleRevisions"][number]["routine"];
    if (routine.mode !== "flexible") continue;
    const previous = routines.get(routine.id);
    if (previous && (previous.startDate !== routine.startDate || previous.startIndex !== routine.startIndex ||
      JSON.stringify([...previous.weekdays].sort()) !== JSON.stringify([...routine.weekdays].sort()) ||
      JSON.stringify(previous.sequence) !== JSON.stringify(routine.sequence)))
      fail("scheduleRevisions.routine", "must keep the same configuration for an existing routine ID");
    if (!previous && routine.startDate !== revision.effectiveDate)
      fail("scheduleRevisions.routine.startDate", "must match its first revision effective date");
    routines.set(routine.id, routine);
  }
  function checkOccurrence(item: ObjectValue, path: string) {
    const routine = routines.get(item.routineId as string);
    if (!routine) fail(path + ".routineId", "must reference a saved flexible routine");
    if (routine.sequence[(routine.startIndex + (item.ordinal as number) % routine.sequence.length) % routine.sequence.length] !== item.templateId)
      fail(path + ".templateId", "must match its routine sequence position");
    if (String(item.dueDate) < routine.startDate) fail(path + ".dueDate", "must not precede its routine start");
    if (!routine.weekdays.includes(weekdayIndex(item.dueDate as string)))
      fail(path + ".dueDate", "must be a selected training weekday");
  }
  const progress = array(data.routineProgress, "routineProgress", 20000).map((value, index) => {
    const path = `routineProgress[${index}]`;
    const entry = object(value, path, ["id", "routineId", "ordinal", "templateId", "dueDate", "resolvedDate", "resolvedAt", "outcome", "sessionId"]);
    const occurrence = validateOccurrence({ routineId: entry.routineId, ordinal: entry.ordinal, templateId: entry.templateId, dueDate: entry.dueDate }, path);
    checkOccurrence(occurrence, path);
    if (entry.id !== entry.routineId + ":" + entry.ordinal) fail(path + ".id", "must match its routine occurrence key");
    date(entry.resolvedDate, path + ".resolvedDate");
    timestamp(entry.resolvedAt, path + ".resolvedAt");
    choice(entry.outcome, path + ".outcome", ["completed", "skipped"]);
    if (entry.outcome === "skipped") {
      if (entry.sessionId !== null) fail(path + ".sessionId", "must be null for a skipped occurrence");
    } else string(entry.sessionId, path + ".sessionId", 100);
    return entry;
  });
  unique(progress.map(entry => entry.id), "routineProgress.id");
  const resolved = new Map(progress.map(entry => [entry.id as string, entry]));
  const counts = new Map<string, number>();
  const ordinals = new Map<string, ObjectValue[]>();
  for (const entry of progress) {
    const id = entry.routineId as string;
    const values = ordinals.get(id) ?? [];
    values.push(entry);
    ordinals.set(id, values);
  }
  const routineStarts = new Map([...routines].map(([id, routine]) => [id, routine.startDate]));
  const dueProgress = progress.map((entry) => ({
    routineId: entry.routineId as string,
    outcome: entry.outcome as "completed" | "skipped",
    resolvedDate: entry.resolvedDate as string,
  }));
  function dueAfter(id: string, previous?: ObjectValue): string {
    return routineDueDate(routines.get(id)!, previous
      ? { outcome: previous.outcome as "completed" | "skipped", resolvedDate: previous.resolvedDate as string } : null,
    dueProgress, routineStarts);
  }
  const pendingDue = new Map<string, string>();
  for (const [id, values] of ordinals) {
    values.sort((a, b) => (a.ordinal as number) - (b.ordinal as number));
    if (values.some((value, index) => value.ordinal !== index)) fail("routineProgress.ordinal", "must be contiguous from zero for each routine");
    for (const [index, entry] of values.entries()) {
      const previous = values[index - 1];
      if (String(entry.resolvedDate) < String(previous?.resolvedDate ?? routines.get(id)!.startDate))
        fail("routineProgress.resolvedDate", "must not precede its routine start or previous resolution");
      if (entry.dueDate !== dueAfter(id, previous))
        fail("routineProgress.dueDate", "must follow the previous routine resolution");
    }
    counts.set(id, values.length);
    pendingDue.set(id, dueAfter(id, values[values.length - 1]));
  }
  const linked = new Set<string>();
  for (const session of sessions) {
    if (session.routineOccurrence === null) continue;
    const occurrence = session.routineOccurrence as ObjectValue;
    checkOccurrence(occurrence, "sessions.routineOccurrence");
    const key = occurrence.routineId + ":" + occurrence.ordinal;
    if (linked.has(key)) fail("sessions.routineOccurrence", "must be unique per routine occurrence");
    linked.add(key);
    const completion = resolved.get(key);
    if (session.hasFinished) {
      if (!completion || completion.outcome !== "completed" || completion.sessionId !== session.id ||
        completion.resolvedDate !== session.date || completion.dueDate !== occurrence.dueDate)
        fail("sessions.routineOccurrence", "must match its recorded completion");
    } else if (completion || occurrence.ordinal !== (counts.get(occurrence.routineId as string) ?? 0) ||
      occurrence.dueDate !== (pendingDue.get(occurrence.routineId as string) ?? dueAfter(occurrence.routineId as string))) {
      fail("sessions.routineOccurrence", "must link to the next unresolved occurrence");
    }
  }
  const byId = new Map(sessions.map(session => [session.id, session]));
  for (const entry of progress) {
    if (entry.outcome !== "completed") continue;
    const session = byId.get(entry.sessionId);
    const occurrence = session?.routineOccurrence as ObjectValue | null | undefined;
    if (!session?.hasFinished || !occurrence || occurrence.routineId !== entry.routineId || occurrence.ordinal !== entry.ordinal)
      fail("routineProgress.sessionId", "must reference its finished linked workout");
  }
}

function validateVersion(value: unknown, version: 1 | 2 | 3 | 4, previous?: AppData): ObjectValue {
  const data = object(value, "backup", [
    "schemaVersion",
    "settings",
    "exercises",
    "templates",
    "scheduleRevisions",
    "sessions",
    ...(version >= 2 ? ["bodyWeights"] : []),
    ...(version >= 4 ? ["routineProgress"] : []),
  ]);
  if (data.schemaVersion !== version)
    fail("schemaVersion", `must be ${version}; this backup may need a newer app`);
  const settings = object(data.settings, "settings", version >= 3 ? [
    "phoneCountryCode", "phoneNumber", "firstName", "lastName", "dateOfBirth",
    "gender", "heightCm", "unit", "profileCompletedAt",
  ] : ["age", "gender", "heightCm", "unit"]);
  if (version >= 3) {
    const country = string(settings.phoneCountryCode, "settings.phoneCountryCode", 4);
    if (!/^\+[1-9]\d{0,2}$/.test(country))
      fail("settings.phoneCountryCode", "must be an international country code such as +1");
    const phone = string(settings.phoneNumber, "settings.phoneNumber", 16, true);
    if (phone) {
      try {
        if (normalizePhone(country, phone).phoneNumber !== phone) throw new Error();
      } catch { fail("settings.phoneNumber", "must be a canonical international phone number matching its country code"); }
    }
    string(settings.firstName, "settings.firstName", 100, true);
    string(settings.lastName, "settings.lastName", 100, true);
    const birth = string(settings.dateOfBirth, "settings.dateOfBirth", 10, true);
    if (birth && ageFromDateOfBirth(birth) === null)
      fail("settings.dateOfBirth", "must be a real past or present YYYY-MM-DD date (age 0–130)");
    choice(settings.gender, "settings.gender", ["", "Male", "Female"]);
    if (settings.profileCompletedAt !== null) {
      timestamp(settings.profileCompletedAt, "settings.profileCompletedAt");
      try { validateProfileDraft(settings as unknown as AppData["settings"]); }
      catch { fail("settings.profileCompletedAt", "requires a valid phone, first and last name, date of birth, and gender"); }
    }
  } else {
    const age = string(settings.age, "settings.age", 3, true);
    if (age !== "" && (!/^\d+$/.test(age) || Number(age) < 1 || Number(age) > 130))
      fail("settings.age", "must be empty or an age from 1 to 130");
    string(settings.gender, "settings.gender", 80, true);
  }
  if (settings.heightCm !== null)
    number(settings.heightCm, "settings.heightCm", 1, 300);
  choice(settings.unit, "settings.unit", ["lb", "kg"]);
  if (version >= 2) {
    const weights = array(data.bodyWeights, "bodyWeights", 20000).map((value, index) => {
      const at = `bodyWeights[${index}]`;
      const entry = object(value, at, ["id", "date", "weightKg", "updatedAt"]);
      string(entry.id, `${at}.id`, 100);
      date(entry.date, `${at}.date`);
      number(entry.weightKg, `${at}.weightKg`, Number.MIN_VALUE, 500);
      timestamp(entry.updatedAt, `${at}.updatedAt`);
      return entry;
    });
    unique(weights.map((entry) => entry.id), "bodyWeights.id");
    unique(weights.map((entry) => entry.date), "bodyWeights.date");
  }
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
    version,
    new Set(exercises.map((item) => item.id)),
    version < 4 || !Array.isArray(data.scheduleRevisions) ||
      [...data.scheduleRevisions].sort((a, b) => String(b?.effectiveDate).localeCompare(String(a?.effectiveDate)))[0]?.routine?.mode !== "flexible",
  );
  const unchangedRevisions = new Set(previous?.scheduleRevisions.filter(Object.isFrozen));
  const revisions = array(
    data.scheduleRevisions,
    "scheduleRevisions",
    10000,
  ).map((value, index) => {
    if (unchangedRevisions.has(value as AppData["scheduleRevisions"][number]))
      return value as ObjectValue;
    const at = `scheduleRevisions[${index}]`;
    const item = object(value, at, [
      "id",
      "effectiveDate",
      "anchorMonday",
      "slots",
      "templates",
      ...(version >= 4 ? ["routine"] : []),
    ]);
    string(item.id, `${at}.id`, 100);
    date(item.effectiveDate, `${at}.effectiveDate`);
    const anchor = date(item.anchorMonday, `${at}.anchorMonday`);
    if (new Date(`${anchor}T00:00:00.000Z`).getUTCDay() !== 1)
      fail(`${at}.anchorMonday`, "must be a Monday");
    const flexible = version >= 4 && (item.routine as ObjectValue | null)?.mode === "flexible";
    const snapshots = templates(item.templates, `${at}.templates`, version, undefined, !flexible);
    if (version >= 4) validateRoutine(item.routine, `${at}.routine`, snapshots);
    const slots = array(item.slots, `${at}.slots`, flexible ? 0 : 7).map((value, index) => {
      const slotAt = `${at}.slots[${index}]`;
      const slot = object(value, slotAt, ["weekday", "workoutIds"]);
      number(slot.weekday, `${slotAt}.weekday`, 0, 6, true);
      const ids = array(slot.workoutIds, `${slotAt}.workoutIds`, 2, version >= 2 ? 2 : 0);
      ids.forEach((id, index) => {
        if (version >= 2 && id === null) return;
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
      if (version === 1) unique(ids, `${slotAt}.workoutIds`);
      return slot;
    });
    unique(
      slots.map((slot) => slot.weekday),
      `${at}.slots.weekday`,
    );
    if (version >= 2 && !flexible) {
      for (let offset = 0; offset < 14; offset++) {
        const day = offset % 7;
        const expected = snapshots.find((snapshot) => templateOccursOn(snapshot, addDays(anchor, offset)))?.id ?? null;
        const slot = slots.find((candidate) => candidate.weekday === day);
        const actual = slot ? (slot.workoutIds as (string | null)[])[Math.floor(offset / 7)] : null;
        if (actual !== expected) fail(`${at}.slots`, "must match the snapshot recurrences");
      }
    }
    for (const snapshot of snapshots.filter((template) => !flexible && !template.archived))
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
  const unchangedSessions = new Set(previous?.sessions.filter(Object.isFrozen));
  const sessions = array(data.sessions, "sessions", 20000).map(
    (value, index) => {
      if (unchangedSessions.has(value as AppData["sessions"][number]))
        return value as ObjectValue;
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
        ...(version >= 4 ? ["hasFinished", "routineOccurrence"] : []),
      ]);
      string(item.id, `${at}.id`, 100);
      date(item.date, `${at}.date`);
      string(item.title, `${at}.title`, 120);
      string(item.templateId, `${at}.templateId`, 100);
      choice(item.unit, `${at}.unit`, ["lb", "kg"]);
      choice(item.status, `${at}.status`, ["in_progress", "completed"]);
      if (version >= 4) {
        if (typeof item.hasFinished !== "boolean") fail(`${at}.hasFinished`, "must be true or false");
        if (item.status === "completed" && !item.hasFinished) fail(`${at}.hasFinished`, "must be true for a finished workout");
        if (item.routineOccurrence !== null) {
          const occurrence = validateOccurrence(item.routineOccurrence, `${at}.routineOccurrence`);
          if (occurrence.templateId !== item.templateId) fail(`${at}.routineOccurrence.templateId`, "must match its workout");
        }
      }
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
            ...(version >= 2 ? ["algorithmVersion"] : []),
          ]);
          if (version >= 2 && suggestion.algorithmVersion !== 1 && suggestion.algorithmVersion !== 2)
            fail(`${entryAt}.suggestion.algorithmVersion`, "must be 1 or 2");
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
            const set = object(value, setAt, ["weight", "reps", "status", ...(version >= 2 ? ["classification"] : [])]);
            if (version >= 2) choice(set.classification, `${setAt}.classification`, ["working", "warmup"]);
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
  if (version >= 4) validateRoutineLinks(data, revisions, sessions);
  return data;
}

export function validateData(value: unknown, previous?: AppData): AppData {
  return validateVersion(value, 4, previous) as unknown as AppData;
}

export function validateLegacyData(value: unknown): LegacyAppData {
  return validateVersion(value, 1) as unknown as LegacyAppData;
}

export function validateStoredData(value: unknown): StoredAppData {
  if (value && typeof value === "object") {
    if ((value as ObjectValue).schemaVersion === 1) return validateLegacyData(value);
    if ((value as ObjectValue).schemaVersion === 2) return validateVersion(value, 2) as unknown as LegacyV2AppData;
    if ((value as ObjectValue).schemaVersion === 3) return validateVersion(value, 3) as unknown as LegacyV3AppData;
    if ((value as ObjectValue).schemaVersion === 4) return validateData(value);
  }
  return fail("schemaVersion", "must be 1, 2, 3, or 4; this backup may need a newer app");
}

function upgradedTemplate(template: LegacyTemplate, anchorMonday: string, slots: { weekday: number; workoutIds: string[] }[]): WorkoutTemplate {
  const weekdaysA = template.weekdays.filter((day) => slots.find((slot) => slot.weekday === day)?.workoutIds[0] === template.id);
  const weekdaysB = template.weekdays.filter((day) => {
    const ids = slots.find((slot) => slot.weekday === day)?.workoutIds;
    return ids?.[ids.length === 1 ? 0 : 1] === template.id;
  });
  let recurrence: WorkoutRecurrence;
  if (weekdaysA.length === template.weekdays.length && weekdaysB.length === template.weekdays.length)
    recurrence = { kind: "weekly" };
  else if (weekdaysA.length === template.weekdays.length && weekdaysB.length === 0)
    recurrence = { kind: "biweekly", anchorMonday };
  else if (weekdaysB.length === template.weekdays.length && weekdaysA.length === 0)
    recurrence = { kind: "biweekly", anchorMonday: addDays(anchorMonday, 7) };
  else
    recurrence = { kind: "legacy", anchorMonday, weekdaysA, weekdaysB };
  return { ...template, weekdays: [...template.weekdays], exercises: template.exercises.map((entry) => ({ ...entry })), recurrence };
}

function upgradeV3Data(data: LegacyV3AppData): AppData {
  return validateData({
    ...data, schemaVersion: 4, routineProgress: [],
    scheduleRevisions: data.scheduleRevisions.map(revision => ({ ...revision, routine: { mode: "fixed" } })),
    // Older formats cleared finishedAt when editing, so an in-progress record may have been finished.
    // Protect every pre-v4 session from destructive cancellation/date moves without changing its status.
    sessions: data.sessions.map(session => ({ ...session, hasFinished: true, routineOccurrence: null })),
  });
}

function upgradeV2Data(data: LegacyV2AppData): AppData {
  const normalizedGender = data.settings.gender.trim().toLowerCase();
  return upgradeV3Data({
    ...data, schemaVersion: 3,
    settings: {
      ...emptyProfileSettings(), heightCm: data.settings.heightCm, unit: data.settings.unit,
      gender: normalizedGender === "male" ? "Male" : normalizedGender === "female" ? "Female" : "",
    },
  });
}

export function upgradeData(value: unknown): AppData {
  const legacy = validateStoredData(value);
  if (legacy.schemaVersion === 4) return legacy;
  if (legacy.schemaVersion === 3) return upgradeV3Data(legacy);
  if (legacy.schemaVersion === 2) return upgradeV2Data(legacy);
  const latest = [...legacy.scheduleRevisions].sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))[0];
  const anchorMonday = latest?.anchorMonday ?? "2000-01-03";
  const currentSlots = Array.from({ length: 7 }, (_, weekday) => {
    const assigned = legacy.templates.filter((template) => !template.archived && template.weekdays.includes(weekday)).map((template) => template.id);
    const existing = latest?.slots.find((slot) => slot.weekday === weekday)?.workoutIds ?? [];
    return { weekday, workoutIds: [...existing.filter((id) => assigned.includes(id)), ...assigned.filter((id) => !existing.includes(id))] };
  });
  const upgraded: LegacyV2AppData = {
    ...legacy,
    schemaVersion: 2,
    settings: { ...legacy.settings },
    bodyWeights: [],
    exercises: legacy.exercises.map((exercise) => ({ ...exercise })),
    templates: legacy.templates.map((template) => template.archived
      ? { ...template, weekdays: [...template.weekdays], exercises: template.exercises.map((entry) => ({ ...entry })), recurrence: { kind: "weekly" } }
      : upgradedTemplate(template, anchorMonday, currentSlots)),
    scheduleRevisions: legacy.scheduleRevisions.map((revision) => ({
      ...revision,
      slots: revision.slots.map((slot) => ({
        ...slot,
        workoutIds: slot.workoutIds.length === 0
          ? [null, null]
          : slot.workoutIds.length === 1 ? [slot.workoutIds[0], slot.workoutIds[0]] : [...slot.workoutIds],
      })),
      templates: revision.templates.map((template) => template.archived
        ? { ...template, weekdays: [...template.weekdays], exercises: template.exercises.map((entry) => ({ ...entry })), recurrence: { kind: "weekly" } }
        : upgradedTemplate(template, revision.anchorMonday, revision.slots)),
    })),
    sessions: legacy.sessions.map((session) => ({
      ...session,
      exercises: session.exercises.map((entry) => ({
        ...entry,
        exercise: { ...entry.exercise },
        target: { ...entry.target },
        suggestion: { ...entry.suggestion, weights: [...entry.suggestion.weights], algorithmVersion: 1 },
        sets: entry.sets.map((set) => ({ ...set, classification: "working" })),
      })),
    })),
  };
  return upgradeV2Data(upgraded);
}
function byteLength(text: string): number {
  // Count UTF8 bytes without adding a native dependency
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
  return upgradeData(value);
}
export function serializeBackup(data: AppData): string {
  validateData(data);
  const text = JSON.stringify(data);
  if (byteLength(text) > MAX_BACKUP_BYTES)
    throw new Error("Backup exceeds the 10 MiB size limit.");
  return text;
}

export function serializeStoredBackup(data: StoredAppData): string {
  validateStoredData(data);
  return JSON.stringify(data);
}
