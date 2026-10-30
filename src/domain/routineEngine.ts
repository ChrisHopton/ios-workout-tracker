import { addDays, dayDifference, mondayOf, parseDate, today, weekdayIndex } from "./dates";
import { AppData, RoutineOccurrence, RoutineProgress, RoutineSchedule, ScheduleRevision, WorkoutTemplate } from "./types";

type Flexible = Extract<RoutineSchedule, { mode: "flexible" }>;
export function scheduleRevisionAt(data: AppData, date: string): ScheduleRevision | null {
  parseDate(date);
  return data.scheduleRevisions.reduce<ScheduleRevision | null>((latest, item) =>
    item.effectiveDate <= date && (!latest || item.effectiveDate > latest.effectiveDate) ? item : latest, null);
}
export function routineAt(data: AppData, date: string): RoutineSchedule {
  return scheduleRevisionAt(data, date)?.routine ?? { mode: "fixed" };
}
export function fixedTemplateForDate(revision: ScheduleRevision | null, date: string): WorkoutTemplate | null {
  if (!revision) return null;
  const slot = revision.slots.find((item) => item.weekday === weekdayIndex(date));
  const phase = ((Math.floor(dayDifference(mondayOf(date), revision.anchorMonday) / 7) % 2) + 2) % 2;
  return revision.templates.find((item) => item.id === slot?.workoutIds[phase]) ?? null;
}
export function nextTrainingDate(weekdays: number[], fromDate: string): string {
  if (!weekdays.length) throw new Error("Choose at least one training day.");
  for (let offset = 0; offset < 7; offset++) {
    const date = addDays(fromDate, offset);
    if (weekdays.includes(weekdayIndex(date))) return date;
  }
  throw new Error("Choose valid training days.");
}
/** Only the first occurrence waits for a linked completion carried over from an older routine. */
export function routineDueDate(
  config: Pick<Flexible, "id" | "startDate" | "weekdays">,
  previous: Pick<RoutineProgress, "outcome" | "resolvedDate"> | null,
  progress: readonly Pick<RoutineProgress, "routineId" | "outcome" | "resolvedDate">[],
  routineStarts: ReadonlyMap<string, string>,
): string {
  let from = previous ? previous.outcome === "completed" ? addDays(previous.resolvedDate, 1) : previous.resolvedDate : config.startDate;
  if (!previous) {
    const firstResolution = progress.reduce<string | null>((first, item) => item.routineId === config.id
      && (!first || item.resolvedDate < first) ? item.resolvedDate : first, null);
    for (const item of progress) {
      const olderStart = routineStarts.get(item.routineId);
      if (item.outcome === "completed" && olderStart && olderStart < config.startDate
        && item.resolvedDate >= config.startDate && (!firstResolution || item.resolvedDate <= firstResolution)) {
        const available = addDays(item.resolvedDate, 1);
        if (available > from) from = available;
      }
    }
  }
  return nextTrainingDate(config.weekdays, from < config.startDate ? config.startDate : from);
}
/** A linked make-up keeps its actual date, including across a scheduled mode change. */
export function completedRoutineTemplateForDate(data: AppData, date: string): WorkoutTemplate | null {
  const completed = data.routineProgress.find((item) => item.resolvedDate === date && item.outcome === "completed");
  if (!completed) return null;
  const revision = data.scheduleRevisions.reduce<ScheduleRevision | null>((latest, item) =>
    item.routine.mode === "flexible" && item.routine.id === completed.routineId && item.effectiveDate <= date
      && (!latest || item.effectiveDate > latest.effectiveDate) ? item : latest, null);
  return revision?.templates.find((item) => item.id === completed.templateId) ?? null;
}
function lastResolution(data: AppData, routineId: string, cutoff: string): RoutineProgress | null {
  return data.routineProgress.reduce<RoutineProgress | null>((last, item) => item.routineId === routineId
    && item.resolvedDate <= cutoff && (!last || item.ordinal > last.ordinal) ? item : last, null);
}
function occurrence(data: AppData, config: Flexible, cutoff: string): RoutineOccurrence {
  const last = lastResolution(data, config.id, cutoff);
  const ordinal = last ? last.ordinal + 1 : 0;
  const routineStarts = new Map(data.scheduleRevisions.flatMap((revision) => revision.routine.mode === "flexible"
    ? [[revision.routine.id, revision.routine.startDate] as const] : []));
  return { routineId: config.id, ordinal, templateId: config.sequence[(config.startIndex + ordinal) % config.sequence.length],
    dueDate: routineDueDate(config, last, data.routineProgress.filter((item) => item.resolvedDate <= cutoff), routineStarts) };
}
export function nextFlexibleOccurrence(data: AppData, currentDate = today()): {
  occurrence: RoutineOccurrence; template: WorkoutTemplate; overdue: boolean;
} | null {
  const revision = scheduleRevisionAt(data, currentDate);
  const config = revision?.routine;
  if (!revision || config?.mode !== "flexible") return null;
  const next = occurrence(data, config, currentDate);
  const template = revision.templates.find((item) => item.id === next.templateId);
  if (!template) throw new Error("The next workout is unavailable. Review your routine.");
  return { occurrence: next, template, overdue: next.dueDate < currentDate };
}
export function occurrenceForRecording(data: AppData, templateId: string, recordingDate: string, currentDate = today()): RoutineOccurrence | null {
  if (recordingDate !== currentDate) return null;
  const next = nextFlexibleOccurrence(data, currentDate);
  return next?.template.id === templateId ? { ...next.occurrence } : null;
}
export function flexibleTemplateForDate(data: AppData, revision: ScheduleRevision, date: string, currentDate = today()): WorkoutTemplate | null {
  const config = revision.routine;
  if (config.mode !== "flexible" || date < config.startDate || !config.weekdays.includes(weekdayIndex(date))) return null;
  const next = occurrence(data, config, date < currentDate ? date : currentDate);
  if (date <= currentDate) return date < next.dueDate ? null : revision.templates.find((item) => item.id === next.templateId) ?? null;
  let first = nextTrainingDate(config.weekdays, next.dueDate > currentDate ? next.dueDate : currentDate);
  const occupied = data.sessions.find((session) => session.date === first);
  if (occupied && !(occupied.routineOccurrence?.routineId === next.routineId && occupied.routineOccurrence.ordinal === next.ordinal))
    first = nextTrainingDate(config.weekdays, addDays(first, 1));
  if (date < first) return null;
  let steps = 0;
  for (let candidate = first; candidate < date; candidate = nextTrainingDate(config.weekdays, addDays(candidate, 1))) steps++;
  const id = config.sequence[(config.startIndex + next.ordinal + steps) % config.sequence.length];
  return revision.templates.find((item) => item.id === id) ?? null;
}
export function routineChangeBlocked(data: AppData): boolean {
  return data.sessions.some((session) => session.status === "in_progress" && (session.routineOccurrence !== null
    || fixedTemplateForDate(scheduleRevisionAt(data, session.date), session.date)?.id === session.templateId));
}
