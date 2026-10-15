import { addDays, mondayOf, dayDifference, parseDate, weekdayIndex } from "./dates";
import { AppData, newId, ScheduleRevision, WEEKDAYS, WorkoutTemplate } from "./types";

export function templateOccursOn(template: WorkoutTemplate, date: string): boolean {
  const weekday = weekdayIndex(date);
  if (template.archived || !template.weekdays.includes(weekday)) return false;
  const recurrence = template.recurrence;
  if (recurrence.kind === "weekly") return true;
  const week = Math.floor(dayDifference(mondayOf(date), recurrence.anchorMonday) / 7);
  const phase = ((week % 2) + 2) % 2;
  return recurrence.kind === "biweekly"
    ? phase === 0
    : (phase === 0 ? recurrence.weekdaysA : recurrence.weekdaysB).includes(weekday);
}

export function recurrenceLabel(template: WorkoutTemplate): string {
  if (template.recurrence.kind === "weekly") return "Weekly";
  if (template.recurrence.kind === "biweekly") return "Every 2 weeks";
  return "Existing custom schedule";
}

export function nextOccurrence(data: AppData, templateId: string, fromDate: string): string | null {
  parseDate(fromDate);
  const dates = [fromDate, ...data.scheduleRevisions
    .filter((revision) => revision.effectiveDate > fromDate)
    .map((revision) => revision.effectiveDate)]
    .sort((a, b) => a.localeCompare(b));
  for (const start of dates) {
    for (let offset = 0; offset < 14; offset++) {
      const date = addDays(start, offset);
      if (scheduleForDate(data, date)?.id === templateId) return date;
    }
  }
  return null;
}

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
  if (!slot) return null;
  const weekOffset = Math.floor(
    dayDifference(mondayOf(date), revision.anchorMonday) / 7,
  );
  const index =
    ((weekOffset % 2) + 2) % 2;
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
    recurrence: template.recurrence.kind === "legacy"
      ? { ...template.recurrence, weekdaysA: [...template.recurrence.weekdaysA], weekdaysB: [...template.recurrence.weekdaysB] }
      : { ...template.recurrence },
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
  if (!["weekly", "biweekly", "legacy"].includes(template.recurrence?.kind))
    throw new Error("Choose weekly or every 2 weeks.");
  if (template.recurrence.kind !== "weekly") {
    if (mondayOf(template.recurrence.anchorMonday) !== template.recurrence.anchorMonday)
      throw new Error("Choose a Monday for the repeating week.");
    if (template.recurrence.kind === "legacy") {
      const { weekdaysA, weekdaysB } = template.recurrence;
      for (const days of [weekdaysA, weekdaysB]) {
        if (!Array.isArray(days) || new Set(days).size !== days.length ||
          days.some((day) => !Number.isInteger(day) || !template.weekdays.includes(day)))
          throw new Error("The existing schedule contains invalid weekdays.");
      }
      if (template.weekdays.some((day) => !weekdaysA.includes(day) && !weekdaysB.includes(day)))
        throw new Error("Choose a recurrence before changing this plan's training days.");
    }
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
  const anchorMonday = previous?.anchorMonday ?? mondayOf(effectiveDate);
  const active = templates.filter((template) => !template.archived);
  const slots = Array.from({ length: 7 }, (_, weekday) => {
    return {
      weekday,
      workoutIds: [0, 1].map((week) => {
        const date = addDays(anchorMonday, week * 7 + weekday);
        const assigned = active.filter((template) => templateOccursOn(template, date));
        if (assigned.length > 1) {
          const nextConflict = Array.from({ length: 14 }, (_, offset) => addDays(effectiveDate, offset))
            .find((candidate) => weekdayIndex(candidate) === weekday && assigned.every((template) => templateOccursOn(template, candidate)));
          throw new Error(`${WEEKDAYS[weekday]} (${nextConflict}) has a schedule conflict between ${assigned.map((template) => `“${template.title}”`).join(" and ")}. Choose another day or starting week.`);
        }
        return assigned[0]?.id ?? null;
      }),
    };
  });
  return {
    id: newId("schedule"),
    effectiveDate,
    anchorMonday,
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
  if (!slot.workoutIds[0] || !slot.workoutIds[1] || slot.workoutIds[0] === slot.workoutIds[1])
    throw new Error("Assign two workouts to this day before swapping A and B.");
  const affected = new Set(slot.workoutIds);
  const templates = data.templates.map((template): WorkoutTemplate => {
    if (!affected.has(template.id)) return template;
    const weekdaysA = template.weekdays.filter((day) => templateOccursOn(template, addDays(revision.anchorMonday, day)));
    const weekdaysB = template.weekdays.filter((day) => templateOccursOn(template, addDays(revision.anchorMonday, 7 + day)));
    const inA = weekdaysA.includes(weekday);
    const inB = weekdaysB.includes(weekday);
    return {
      ...copyTemplate(template),
      updatedAt: new Date().toISOString(),
      recurrence: {
        kind: "legacy",
        anchorMonday: revision.anchorMonday,
        weekdaysA: [...weekdaysA.filter((day) => day !== weekday), ...(inB ? [weekday] : [])].sort((a, b) => a - b),
        weekdaysB: [...weekdaysB.filter((day) => day !== weekday), ...(inA ? [weekday] : [])].sort((a, b) => a - b),
      },
    };
  });
  return replaceRevision({ ...data, templates }, nextRevision(data, templates, effectiveDate));
}
