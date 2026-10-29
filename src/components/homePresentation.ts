import { scheduleForDate } from "../domain/schedule";
import { inspectSessionRecording } from "../domain/sessions";
import { AppData } from "../domain/types";

export function homeDayPresentation(data: AppData, date: string, currentDate: string) {
  const session = data.sessions.find((item) => item.date === date);
  const template = scheduleForDate(data, date);
  const isFuture = date > currentDate;
  const setCount = session
    ? session.exercises.reduce((count, item) => count + item.sets.length, 0)
    : template?.exercises.reduce((count, item) => count + item.sets, 0) ?? 0;
  const completedSets = session ? inspectSessionRecording(session).completedSets : 0;

  return {
    session,
    template,
    isFuture,
    title: session?.title ?? template?.title ?? "Rest day",
    exerciseCount: session?.exercises.length ?? template?.exercises.length ?? 0,
    setCount,
    completedSets,
    actionLabel: isFuture
      ? null
      : session?.status === "completed"
        ? "View workout"
        : session
          ? "Resume workout"
          : template
            ? "Start workout"
            : "Choose workout",
  };
}
