import {
  AppData,
  ProfileSettings,
  WorkoutSession,
  WorkoutTemplate,
} from "../domain/types";
import { makeRowKey, SheetRow, SheetTable, SheetValue } from "./protocol";

export interface RowDifference extends SheetRow {
  deleted: boolean;
}
function row(
  table: SheetTable,
  deviceId: string,
  source: (string | number)[],
  values: SheetValue[],
): SheetRow {
  return { table, key: makeRowKey(table, deviceId, ...source), values };
}
export function makePeopleRow(
  settings: ProfileSettings,
  deviceId: string,
  label: string,
): SheetRow {
  return row("People", deviceId, ["profile"], [
    label,
    settings.age,
    settings.gender,
    settings.heightCm,
    settings.unit,
  ]);
}
function planRows(
  template: WorkoutTemplate,
  index: number,
  deviceId: string,
): SheetRow[] {
  const header: SheetValue[] = [
    "template", template.id, index, template.title, template.archived,
    template.updatedAt, null, null, null, null, null, null, null,
  ];
  const result = [row("Plans", deviceId, [template.id, "template"], header)];
  template.exercises.forEach((target, exerciseIndex) => {
    result.push(row("Plans", deviceId, [template.id, "exercise", exerciseIndex], [
      "exercise", template.id, index, null, null, null, exerciseIndex,
      target.exerciseId, target.sets, target.repMin, target.repMax, null, null,
    ]));
  });
  template.weekdays.forEach((weekday, weekdayIndex) => {
    result.push(row("Plans", deviceId, [template.id, "weekday", weekdayIndex], [
      "weekday", template.id, index, null, null, null, null, null,
      null, null, null, weekdayIndex, weekday,
    ]));
  });
  return result;
}
export function projectMetadata(
  data: AppData,
  deviceId: string,
  label: string,
): SheetRow[] {
  const result = [makePeopleRow(data.settings, deviceId, label)];
  data.exercises.forEach((exercise, index) => {
    result.push(row("Exercises", deviceId, [exercise.id], [
      exercise.id, index, exercise.name, exercise.group, exercise.equipment,
      exercise.incrementLb, exercise.incrementKg,
    ]));
  });
  data.templates.forEach((template, index) => {
    result.push(...planRows(template, index, deviceId));
  });
  data.scheduleRevisions.forEach((revision, revisionIndex) => {
    const base: SheetValue[] = [
      "revision", revision.id, revisionIndex, revision.effectiveDate,
      revision.anchorMonday, null, null, null, null, null, null, null,
      null, null, null, null, null, null, null, null, null,
    ];
    result.push(row("Schedules", deviceId, [revision.id, "revision"], base));
    revision.slots.forEach((slot, slotIndex) => {
      result.push(row("Schedules", deviceId, [revision.id, "slot", slotIndex], [
        "slot", revision.id, revisionIndex, null, null, slotIndex, slot.weekday,
        null, null, null, null, null, null, null, null, null, null,
        null, null, null, null,
      ]));
      slot.workoutIds.forEach((workoutId, workoutIndex) => {
        result.push(row("Schedules", deviceId,
          [revision.id, "slot", slotIndex, "workout", workoutIndex], [
            "assignment", revision.id, revisionIndex, null, null, slotIndex,
            slot.weekday, workoutIndex, workoutId, null, null, null, null,
            null, null, null, null, null, null, null, null,
          ]));
      });
    });
    revision.templates.forEach((template, templateIndex) => {
      result.push(row("Schedules", deviceId, [revision.id, "template", template.id], [
        "template", revision.id, revisionIndex, null, null, null, null, null,
        null, templateIndex, template.id, template.title, template.archived,
        template.updatedAt, null, null, null, null, null, null, null,
      ]));
      template.exercises.forEach((target, exerciseIndex) => {
        result.push(row("Schedules", deviceId,
          [revision.id, "template", template.id, "exercise", exerciseIndex], [
            "exercise", revision.id, revisionIndex, null, null, null, null,
            null, null, templateIndex, template.id, null, null, null,
            exerciseIndex, target.exerciseId, target.sets, target.repMin,
            target.repMax, null, null,
          ]));
      });
      template.weekdays.forEach((weekday, weekdayIndex) => {
        result.push(row("Schedules", deviceId,
          [revision.id, "template", template.id, "weekday", weekdayIndex], [
            "weekday", revision.id, revisionIndex, null, null, null, null,
            null, null, templateIndex, template.id, null, null, null,
            null, null, null, null, null, weekdayIndex, weekday,
          ]));
      });
    });
  });
  return result;
}
export function projectSession(session: WorkoutSession, deviceId: string): SheetRow[] {
  const result = [row("Workouts", deviceId, [session.id], [
    session.id, session.date, session.title, session.templateId, session.unit,
    session.status, session.startedAt, session.updatedAt, session.finishedAt,
    session.exercises.length,
  ])];
  session.exercises.forEach((entry, exerciseIndex) => {
    const base: SheetValue[] = [
      "exercise", session.id, exerciseIndex, entry.exercise.id,
      entry.exercise.name, entry.exercise.group, entry.exercise.equipment,
      entry.exercise.incrementLb, entry.exercise.incrementKg,
      entry.target.exerciseId, entry.target.sets, entry.target.repMin,
      entry.target.repMax, entry.suggestion.reason, entry.sets.length,
      entry.suggestion.weights.length,
    ];
    result.push(row("Sets", deviceId, [session.id, "exercise", exerciseIndex], [
      ...base, null, null, false, false, null, null, null,
    ]));
    const count = Math.max(entry.target.sets, entry.sets.length, entry.suggestion.weights.length);
    for (let setIndex = 0; setIndex < count; setIndex++) {
      const actual = entry.sets[setIndex];
      const suggestionPresent = setIndex < entry.suggestion.weights.length;
      result.push(row("Sets", deviceId, [session.id, "set", exerciseIndex, setIndex], [
        "set", ...base.slice(1), setIndex,
        suggestionPresent ? entry.suggestion.weights[setIndex] : null,
        suggestionPresent, actual !== undefined,
        actual ? actual.weight : null, actual ? actual.reps : null,
        actual ? actual.status : null,
      ]));
    }
  });
  return result;
}
export function projectData(data: AppData, deviceId: string, label: string): SheetRow[] {
  const result = projectMetadata(data, deviceId, label);
  for (const session of data.sessions) result.push(...projectSession(session, deviceId));
  return result;
}
export function changedRows(
  beforeRows: SheetRow[],
  afterRows: SheetRow[],
): RowDifference[] {
  const before = new Map(beforeRows.map((item) => [item.key, item]));
  const after = new Set<string>();
  const result: RowDifference[] = [];
  for (const item of afterRows) {
    after.add(item.key);
    const previous = before.get(item.key);
    if (!previous || JSON.stringify(previous.values) !== JSON.stringify(item.values))
      result.push({ ...item, deleted: false });
  }
  for (const item of beforeRows) {
    if (!after.has(item.key)) result.push({ ...item, deleted: true });
  }
  return result;
}
