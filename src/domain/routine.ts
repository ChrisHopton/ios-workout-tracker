import { addDays, parseDate, today, weekdayIndex } from "./dates";
import { nextRevision, replaceRevision, scheduleForDate } from "./schedule";
import { fixedTemplateForDate, nextFlexibleOccurrence, routineAt, routineChangeBlocked, scheduleRevisionAt } from "./routineEngine";
import { AppData, newId, RoutineProgress, RoutineSchedule, WorkoutSession } from "./types";
export { nextFlexibleOccurrence, occurrenceForRecording, routineAt, routineChangeBlocked } from "./routineEngine";

export type RoutineDraft = { mode: "fixed" } | {
  mode: "flexible"; weekdays: number[]; sequence: string[]; startIndex: number; replacementConfirmed?: boolean; restart?: boolean;
};
export function seedFlexibleRoutine(data: AppData, effectiveDate: string) {
  const config = routineAt(data, effectiveDate);
  if (config.mode === "flexible") {
    const next = nextFlexibleOccurrence(data, effectiveDate);
    return { weekdays: [...config.weekdays], sequence: [...config.sequence],
      startIndex: (config.startIndex + (next?.occurrence.ordinal ?? 0)) % config.sequence.length };
  }
  const sequence: string[] = [];
  const weekdays = new Set<number>();
  for (let offset = 0; offset < 14; offset++) {
    const date = addDays(effectiveDate, offset);
    const plan = fixedTemplateForDate(scheduleRevisionAt(data, date), date);
    if (plan) { sequence.push(plan.id); weekdays.add(weekdayIndex(date)); }
  }
  return { sequence, weekdays: [...weekdays].sort((a, b) => a - b), startIndex: 0 };
}
export function saveRoutine(data: AppData, draft: RoutineDraft, effectiveDate: string, currentDate = today()): AppData {
  parseDate(effectiveDate);
  if (effectiveDate < currentDate) throw new Error("Routine changes start today or later.");
  const prior = routineAt(data, effectiveDate);
  if (draft.mode !== "fixed" && draft.mode !== "flexible") throw new Error("Choose a routine scheduling mode.");
  let config: RoutineSchedule = { mode: "fixed" };
  if (draft.mode === "flexible") {
    if (!draft.weekdays.length || draft.weekdays.length > 7 || new Set(draft.weekdays).size !== draft.weekdays.length
      || draft.weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) throw new Error("Choose valid training days.");
    if (!draft.sequence.length || draft.sequence.length > 1000 || draft.sequence.some((id) => !data.templates.some((plan) => plan.id === id && !plan.archived)))
      throw new Error("Add active workout plans to your routine.");
    if (!Number.isInteger(draft.startIndex) || draft.startIndex < 0 || draft.startIndex >= draft.sequence.length)
      throw new Error("Choose the workout to start with.");
    const next = nextFlexibleOccurrence(data, effectiveDate);
    if (next && !draft.sequence.includes(next.template.id) && !draft.replacementConfirmed)
      throw new Error("Choose a replacement starting workout before removing your next workout.");
    const weekdays = [...draft.weekdays].sort((a, b) => a - b);
    if (!draft.restart && prior.mode === "flexible" && JSON.stringify(prior.sequence) === JSON.stringify(draft.sequence)
      && JSON.stringify(prior.weekdays) === JSON.stringify(weekdays)
      && draft.startIndex === (prior.startIndex + (next?.occurrence.ordinal ?? 0)) % prior.sequence.length) return data;
    config = { mode: "flexible", id: newId("routine"), sequence: [...draft.sequence], weekdays,
      startIndex: draft.startIndex, startDate: effectiveDate };
  } else if (prior.mode === "fixed") return data;
  if (routineChangeBlocked(data)) throw new Error("Finish or cancel your unfinished routine workout before changing the schedule.");
  // If today's revision already has progress, retain it for occurrence validation and history.
  if (data.scheduleRevisions.some((revision) => revision.effectiveDate === effectiveDate && revision.routine.mode === "flexible"
    && data.routineProgress.some((progress) => progress.routineId === (revision.routine as Extract<RoutineSchedule, {mode: "flexible"}>).id)))
    throw new Error("Today's routine already has recorded progress. Choose a start date after today.");
  return replaceRevision(data, nextRevision(data, data.templates, effectiveDate, config));
}
export function completeRoutineSession(data: AppData, session: WorkoutSession): AppData {
  const link = session.routineOccurrence;
  if (!link) return data;
  const existing = data.routineProgress.find((item) => item.routineId === link.routineId && item.ordinal === link.ordinal);
  if (existing) {
    if (existing.outcome !== "completed" || existing.sessionId !== session.id) throw new Error("This routine workout was already resolved.");
    return data;
  }
  if (session.status !== "completed" || !session.hasFinished) throw new Error("Finish the workout before advancing the routine.");
  const resolutions = data.routineProgress.filter((item) => item.routineId === link.routineId);
  const last = resolutions.reduce<RoutineProgress | null>((previous, item) => !previous || item.ordinal > previous.ordinal ? item : previous, null);
  if (link.ordinal !== (last ? last.ordinal + 1 : 0)) throw new Error("This is not the next workout in your routine.");
  if (last && session.date < last.resolvedDate) throw new Error("This date precedes your last routine workout. Move the recording to today.");
  const progress: RoutineProgress = { ...link, id: `${link.routineId}:${link.ordinal}`, outcome: "completed",
    sessionId: session.id, resolvedDate: session.date, resolvedAt: session.finishedAt! };
  return { ...data, routineProgress: [...data.routineProgress, progress] };
}
export function skipNextWorkout(data: AppData, date: string, currentDate = today()): AppData {
  if (date !== currentDate) throw new Error("Skip the next routine workout from today.");
  const next = nextFlexibleOccurrence(data, date);
  if (!next) throw new Error("There is no flexible routine to advance.");
  const link = next.occurrence;
  if (data.sessions.some((session) => session.status === "in_progress" && !session.hasFinished && session.routineOccurrence !== null))
    throw new Error("Resume or cancel your unfinished routine workout before skipping another one.");
  const progress: RoutineProgress = { ...link, id: `${link.routineId}:${link.ordinal}`, outcome: "skipped", sessionId: null,
    resolvedDate: date, resolvedAt: new Date().toISOString() };
  return { ...data, routineProgress: [...data.routineProgress, progress] };
}
export function upcomingWorkout(data: AppData, afterDate: string, currentDate = today()) {
  parseDate(afterDate);
  const starts = [addDays(afterDate, 1), ...data.scheduleRevisions.filter((revision) => revision.effectiveDate > afterDate).map((revision) => revision.effectiveDate)].sort();
  for (const start of starts) for (let offset = 0; offset < 14; offset++) {
    const date = addDays(start, offset);
    const template = scheduleForDate(data, date, currentDate);
    if (template && !data.sessions.some((session) => session.date === date)) return { template, date };
  }
  return null;
}
