import { MAX_BACKUP_BYTES, validateData } from "./backup";
import { parseDate, today } from "./dates";
import { initialData } from "./library";
import { saveTemplate } from "./schedule";
import { AppData, ExerciseDefinition, WorkoutSession, WorkoutTemplate } from "./types";

export const MAX_WORKOUT_IMPORT_BYTES = MAX_BACKUP_BYTES;

export interface WorkoutImport {
  type: "workout-import";
  version: 1;
  sourceId: string;
  importId: string;
  scheduleStartDate?: string;
  exercises: ExerciseDefinition[];
  templates: WorkoutTemplate[];
  sessions: WorkoutSession[];
}
export interface WorkoutImportConflict {
  kind: "exercise-id" | "plan-id" | "workout-id" | "occupied-date" | "exercise-reference" | "schedule";
  id: string;
  message: string;
  date?: string;
}
export interface WorkoutImportPreview {
  sourceId: string;
  importId: string;
  scheduleStartDate: string | null;
  effectiveDate: string;
  exercisesAdded: number;
  plansAdded: number;
  workoutsAdded: number;
  duplicatesSkipped: number;
  plansUnscheduled: number;
  conflicts: WorkoutImportConflict[];
  requiresUnscheduledConsent: boolean;
}
export interface WorkoutImportOptions {
  allowUnscheduledPlans?: boolean;
  /** Today's local date, injectable for preview consistency and tests. */
  effectiveDate?: string;
}

function fail(detail: string): never {
  throw new Error("Invalid workout import: " + detail);
}
function utf8Bytes(text: string): number {
  let bytes = 0;
  for (let index = 0; index < text.length; index++) {
    const point = text.charCodeAt(index);
    if (point < 0x80) bytes += 1;
    else if (point < 0x800) bytes += 2;
    else if (point >= 0xd800 && point <= 0xdbff && index + 1 < text.length &&
      text.charCodeAt(index + 1) >= 0xdc00 && text.charCodeAt(index + 1) <= 0xdfff) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
    if (bytes > MAX_WORKOUT_IMPORT_BYTES) break;
  }
  return bytes;
}

/** Only training data is accepted; profile, measurements and credentials are not an import format. */
export function validateWorkoutImport(value: unknown): WorkoutImport {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("expected an object.");
  const item = value as Record<string, unknown>;
  const required = ["type", "version", "sourceId", "importId", "exercises", "templates", "sessions"];
  const allowed = [...required, "scheduleStartDate"];
  if (required.some(key => !Object.prototype.hasOwnProperty.call(item, key)) ||
    Object.keys(item).some(key => !allowed.includes(key))) fail("unsupported or missing fields.");
  if (item.type !== "workout-import" || item.version !== 1) fail("unsupported file type or version.");
  for (const key of ["sourceId", "importId"]) {
    if (typeof item[key] !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(item[key] as string)) {
      fail(key + " must be a stable identifier of at most 100 characters.");
    }
  }
  if (Object.prototype.hasOwnProperty.call(item, "scheduleStartDate")) {
    if (typeof item.scheduleStartDate !== "string") fail("scheduleStartDate must be a local calendar date.");
    parseDate(item.scheduleStartDate as string);
  }
  if (!Array.isArray(item.templates) || item.templates.length > 1000) fail("templates must contain at most 1,000 plans.");
  const base = initialData();
  try {
    // Existing backup validation covers exercise definitions and exact historical
    // snapshots without accepting any profile or body-weight data from the file.
    validateData({ ...base, exercises: item.exercises, sessions: item.sessions });
    const ids = new Set<string>();
    for (const template of item.templates) {
      // Validate plans separately so overlapping requested schedules can be
      // previewed as conflicts instead of rejecting otherwise usable history.
      const checked = validateData({ ...base, exercises: item.exercises, templates: [template] }).templates[0];
      if (ids.has(checked.id)) fail("template IDs must be unique.");
      ids.add(checked.id);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "training data is invalid.";
    if (message.startsWith("Invalid workout import:")) throw error;
    fail(message.replace(/^Invalid backup: /, ""));
  }
  return value as WorkoutImport;
}

export function parseWorkoutImport(text: string): WorkoutImport {
  if (typeof text !== "string" || text.length > MAX_WORKOUT_IMPORT_BYTES || utf8Bytes(text) > MAX_WORKOUT_IMPORT_BYTES) {
    fail("choose a JSON file smaller than 10 MiB.");
  }
  let value: unknown;
  try { value = JSON.parse(text); }
  catch { return fail("choose a valid workout-import JSON file."); }
  return validateWorkoutImport(value);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonical(item)]));
  }
  return value;
}
function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}
function sameExerciseMeaning(left: ExerciseDefinition, right: ExerciseDefinition): boolean {
  return left.name.trim().toLowerCase() === right.name.trim().toLowerCase() &&
    left.equipment === right.equipment && left.group === right.group;
}
function unscheduled(template: WorkoutTemplate): WorkoutTemplate {
  return {
    ...template, weekdays: [],
    recurrence: template.recurrence.kind === "legacy"
      ? { ...template.recurrence, weekdaysA: [], weekdaysB: [] }
      : template.recurrence,
  };
}
function planContent(template: WorkoutTemplate) {
  return {
    id: template.id, title: template.title.trim(), exercises: template.exercises,
    weekdays: [...template.weekdays].sort(), archived: template.archived,
    recurrence: template.recurrence.kind === "legacy"
      ? { ...template.recurrence, weekdaysA: [...template.recurrence.weekdaysA].sort(), weekdaysB: [...template.recurrence.weekdaysB].sort() }
      : template.recurrence,
  };
}

function prepareWorkoutImport(current: AppData, value: WorkoutImport, localToday: string) {
  const source = validateWorkoutImport(value);
  parseDate(localToday);
  const effectiveDate = source.scheduleStartDate && source.scheduleStartDate > localToday
    ? source.scheduleStartDate : localToday;
  const preview: WorkoutImportPreview = {
    sourceId: source.sourceId, importId: source.importId,
    scheduleStartDate: source.scheduleStartDate ?? null, effectiveDate,
    exercisesAdded: 0, plansAdded: 0, workoutsAdded: 0, duplicatesSkipped: 0,
    plansUnscheduled: 0, conflicts: [], requiresUnscheduledConsent: false,
  };
  let next = current;
  const exercises = new Map(current.exercises.map(exercise => [exercise.id, exercise]));
  const blockedExercises = new Set<string>();
  for (const exercise of source.exercises) {
    const existing = exercises.get(exercise.id);
    if (existing) {
      if (sameExerciseMeaning(existing, exercise)) preview.duplicatesSkipped += 1;
      else {
        blockedExercises.add(exercise.id);
        preview.conflicts.push({
          kind: "exercise-id", id: exercise.id,
          message: "Exercise “" + exercise.name + "” conflicts with an existing exercise ID. Its affected plans and workouts will be skipped.",
        });
      }
      // Current increments and definitions always win.
      continue;
    }
    const added = clone(exercise);
    next = { ...next, exercises: [...next.exercises, added] };
    exercises.set(added.id, added);
    preview.exercisesAdded += 1;
  }
  for (const template of source.templates) {
    const existing = next.templates.find(plan => plan.id === template.id);
    if (existing) {
      if (same(planContent(existing), planContent(template)) ||
        same(planContent(existing), planContent(unscheduled(template)))) preview.duplicatesSkipped += 1;
      else preview.conflicts.push({
        kind: "plan-id", id: template.id,
        message: "Plan “" + template.title + "” already has this ID with different content. The existing plan will be kept.",
      });
      continue;
    }
    if (template.exercises.some(target => blockedExercises.has(target.exerciseId))) {
      preview.conflicts.push({
        kind: "exercise-reference", id: template.id,
        message: "Plan “" + template.title + "” will be skipped because an exercise ID has conflicting meaning.",
      });
      continue;
    }
    const added = clone(template);
    if (!added.archived && added.weekdays.length) {
      try {
        next = saveTemplate(next, added, effectiveDate);
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (!/schedule conflict|cannot precede the latest saved revision/.test(message)) throw error;
        next = { ...next, templates: [...next.templates, unscheduled(added)] };
        preview.plansUnscheduled += 1;
        preview.requiresUnscheduledConsent = true;
        preview.conflicts.push({
          kind: "schedule", id: template.id, date: effectiveDate,
          message: "Plan “" + template.title + "” can be imported without scheduled days. " + message,
        });
      }
    } else next = { ...next, templates: [...next.templates, added] };
    preview.plansAdded += 1;
  }
  const sessions = new Map(current.sessions.map(session => [session.id, session]));
  const occupiedDates = new Set(current.sessions.map(session => session.date));
  const addedSessions: WorkoutSession[] = [];
  for (const session of source.sessions) {
    const existing = sessions.get(session.id);
    if (existing) {
      if (same(existing, session)) preview.duplicatesSkipped += 1;
      else preview.conflicts.push({
        kind: "workout-id", id: session.id, date: session.date,
        message: "Workout on " + session.date + " already has this ID with different content. The existing workout will be kept.",
      });
      continue;
    }
    if (occupiedDates.has(session.date)) {
      preview.conflicts.push({
        kind: "occupied-date", id: session.id, date: session.date,
        message: "Workout on " + session.date + " will be skipped because that date already has a recorded workout.",
      });
      continue;
    }
    if (session.exercises.some(item => {
      const definition = exercises.get(item.exercise.id);
      return blockedExercises.has(item.exercise.id) ||
        (definition && !sameExerciseMeaning(definition, item.exercise));
    })) {
      preview.conflicts.push({
        kind: "exercise-reference", id: session.id, date: session.date,
        message: "Workout on " + session.date + " will be skipped because an exercise ID has conflicting meaning.",
      });
      continue;
    }
    const added = clone(session);
    addedSessions.push(added);
    sessions.set(added.id, added);
    occupiedDates.add(added.date);
    preview.workoutsAdded += 1;
  }
  if (addedSessions.length) next = { ...next, sessions: [...next.sessions, ...addedSessions] };
  if (next !== current) validateData(next);
  return { data: next, preview };
}

export function previewWorkoutImport(
  current: AppData,
  source: WorkoutImport,
  effectiveDate = today(),
): WorkoutImportPreview {
  return prepareWorkoutImport(current, source, effectiveDate).preview;
}

export function mergeWorkoutImport(
  current: AppData,
  source: WorkoutImport,
  options: WorkoutImportOptions = {},
): AppData {
  const prepared = prepareWorkoutImport(current, source, options.effectiveDate ?? today());
  if (prepared.preview.requiresUnscheduledConsent && !options.allowUnscheduledPlans) {
    throw new Error("Review the schedule conflicts and confirm importing the affected plans without scheduled days.");
  }
  return prepared.data;
}
