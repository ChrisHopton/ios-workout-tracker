import { scheduleForDate } from "../domain/schedule";
import { nextFlexibleOccurrence, skipNextWorkout, upcomingWorkout } from "../domain/routine";
import { canCancelWorkout, inspectSessionRecording } from "../domain/sessions";
import { AppData } from "../domain/types";

export function homeDayPresentation(data: AppData, date: string, currentDate: string) {
  const recorded = data.sessions.find((item) => item.date === date);
  const next = date === currentDate ? nextFlexibleOccurrence(data, currentDate) : null;
  const held = date === currentDate ? data.sessions.find((item) => item.status === "in_progress"
    && !item.hasFinished && item.routineOccurrence !== null && item.date <= currentDate) : undefined;
  const session = recorded ?? held;
  const template = scheduleForDate(data, date, currentDate);
  const missed = !session && template && next?.overdue ? next : null;
  const isFuture = date > currentDate;
  const setCount = session
    ? session.exercises.reduce((count, item) => count + item.sets.length, 0)
    : template?.exercises.reduce((count, item) => count + item.sets, 0) ?? 0;
  const completedSets = session ? inspectSessionRecording(session).completedSets : 0;
  const afterSkip = missed ? nextFlexibleOccurrence(skipNextWorkout(data, currentDate, currentDate), currentDate) : null;
  return {
    session, template, isFuture, missed,
    continueWith: afterSkip?.template ?? null,
    isCarryover: !!session && session.date !== date,
    canCancel: !!session && canCancelWorkout(session),
    unfinished: data.sessions.filter((item) => item.status === "in_progress" && item.date <= currentDate && item.id !== session?.id)
      .sort((a, b) => b.date.localeCompare(a.date)),
    upcoming: !template || session?.status === "completed" ? upcomingWorkout(data, date, currentDate) : null,
    title: session?.title ?? template?.title ?? "Rest day",
    exerciseCount: session?.exercises.length ?? template?.exercises.length ?? 0,
    setCount, completedSets,
    actionLabel: isFuture ? null
      : session?.status === "completed" ? "View workout"
      : session ? "Resume workout"
      : missed ? `Make up ${missed.template.title}`
      : template ? "Start workout" : "Choose workout",
  };
}
