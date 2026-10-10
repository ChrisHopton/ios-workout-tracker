import { mondayOf, dayDifference, parseDate, weekdayIndex } from "./dates";
import { AppData, newId, ScheduleRevision, WorkoutTemplate } from "./types";

export function revisionForDate(
  data: AppData,
  date: string,
): ScheduleRevision | null {
  parseDate(date);
  return (
    [...data.scheduleRevisions]
      .filter((revision) => revision.effectiveDate <= date)
      .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))[0] ?? null
  );
}

export function scheduleForDate(
  data: AppData,
  date: string,
): WorkoutTemplate | null {
  const revision = revisionForDate(data, date);
  if (!revision) return null;
  const slot = revision.slots.find(
    (candidate) => candidate.weekday === weekdayIndex(date),
  );
  if (!slot?.workoutIds.length) return null;
  const weekOffset = Math.floor(
    dayDifference(mondayOf(date), revision.anchorMonday) / 7,
  );
  const index =
    ((weekOffset % slot.workoutIds.length) + slot.workoutIds.length) %
    slot.workoutIds.length;
  return (
    revision.templates.find(
      (template) => template.id === slot.workoutIds[index],
    ) ?? null
  );
}

function copyTemplate(template: WorkoutTemplate): WorkoutTemplate {
  return {
    ...template,
    weekdays: [...template.weekdays],
    exercises: template.exercises.map((exercise) => ({ ...exercise })),
  };
}

function validateTemplate(data: AppData, template: WorkoutTemplate): void {
  if (!template.title.trim()) throw new Error("Give your workout a name.");
  if (!template.exercises.length) throw new Error("Add at least one exercise.");
  if (
    new Set(template.weekdays).size !== template.weekdays.length ||
    template.weekdays.some(
      (day) => !Number.isInteger(day) || day < 0 || day > 6,
    )
  ) {
    throw new Error("Choose valid weekdays.");
  }
  if (
    new Set(template.exercises.map((exercise) => exercise.exerciseId)).size !==
    template.exercises.length
  ) {
    throw new Error(
      "Use each exercise once per workout; add more sets instead.",
    );
  }
  for (const exercise of template.exercises) {
    if (
      !data.exercises.some(
        (definition) => definition.id === exercise.exerciseId,
      )
    )
      throw new Error("An exercise is no longer available.");
    if (
      !Number.isInteger(exercise.sets) ||
      exercise.sets < 1 ||
      exercise.sets > 30
    )
      throw new Error("Choose between 1 and 30 sets.");
    if (
      !Number.isInteger(exercise.repMin) ||
      !Number.isInteger(exercise.repMax) ||
      exercise.repMin < 1 ||
      exercise.repMax < exercise.repMin ||
      exercise.repMax > 1000
    ) {
      throw new Error(
        "Choose a rep range between 1 and 1,000, with the minimum no greater than the maximum.",
      );
    }
  }
}

function replaceRevision(data: AppData, revision: ScheduleRevision): AppData {
  return {
    ...data,
    scheduleRevisions: [
      ...data.scheduleRevisions.filter(
        (item) => item.effectiveDate !== revision.effectiveDate,
      ),
      revision,
    ].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate)),
  };
}

function nextRevision(
  data: AppData,
  templates: WorkoutTemplate[],
  effectiveDate: string,
): ScheduleRevision {
  parseDate(effectiveDate);
  const latest = [...data.scheduleRevisions].sort((a, b) =>
    b.effectiveDate.localeCompare(a.effectiveDate),
  )[0];
  if (latest && effectiveDate < latest.effectiveDate)
    throw new Error(
      "Schedule changes cannot precede the latest saved revision.",
    );
  const previous = revisionForDate(data, effectiveDate);
  const active = templates.filter((template) => !template.archived);
  const slots = Array.from({ length: 7 }, (_, weekday) => {
    const assigned = active
      .filter((template) => template.weekdays.includes(weekday))
      .map((template) => template.id);
    if (assigned.length > 2)
      throw new Error(
        "Each weekday supports at most two alternating workouts.",
      );
    const existing =
      previous?.slots.find((slot) => slot.weekday === weekday)?.workoutIds ??
      [];
    return {
      weekday,
      workoutIds: [
        ...existing.filter((id) => assigned.includes(id)),
        ...assigned.filter((id) => !existing.includes(id)),
      ],
    };
  });
  return {
    id: newId("schedule"),
    effectiveDate,
    anchorMonday: previous?.anchorMonday ?? mondayOf(effectiveDate),
    slots,
    templates: active.map(copyTemplate),
  };
}

export function saveTemplate(
  data: AppData,
  template: WorkoutTemplate,
  effectiveDate: string,
): AppData {
  validateTemplate(data, template);
  const saved = copyTemplate({
    ...template,
    title: template.title.trim(),
    updatedAt: new Date().toISOString(),
  });
  const templates = data.templates.some((item) => item.id === template.id)
    ? data.templates.map((item) => (item.id === template.id ? saved : item))
    : [...data.templates, saved];
  return replaceRevision(
    { ...data, templates },
    nextRevision(data, templates, effectiveDate),
  );
}

export function archiveTemplate(
  data: AppData,
  id: string,
  effectiveDate: string,
): AppData {
  if (!data.templates.some((template) => template.id === id))
    throw new Error("Workout not found.");
  const templates = data.templates.map((template) =>
    template.id === id
      ? { ...template, archived: true, updatedAt: new Date().toISOString() }
      : template,
  );
  return replaceRevision(
    { ...data, templates },
    nextRevision(data, templates, effectiveDate),
  );
}

export function swapWeekday(
  data: AppData,
  weekday: number,
  effectiveDate: string,
): AppData {
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6)
    throw new Error("Choose a valid weekday.");
  const revision = nextRevision(data, data.templates, effectiveDate);
  const slot = revision.slots.find((item) => item.weekday === weekday)!;
  if (slot.workoutIds.length !== 2)
    throw new Error("Assign two workouts to this day before swapping A and B.");
  slot.workoutIds.reverse();
  return replaceRevision(data, revision);
}
