import { addDays, formatDate, mondayOf, parseDate } from "./dates";
import { convertWeight, numericReps, numericWeight } from "./recommendations";
import { scheduleForDate } from "./schedule";
import { AppData, Equipment, MuscleGroup, MUSCLE_GROUPS, RecordedSet, Unit, WorkoutSession } from "./types";

export interface WeekSummary {
  startDate: string;
  label: string;
  setsByGroup: Record<MuscleGroup, number>;
  totalSets: number;
  completedWorkouts: number;
  volume: number;
}
export interface LastWorkout {
  id: string;
  title: string;
  date: string;
  workingSets: number;
}
export interface AnalyticsSummary {
  startDate: string;
  endDate: string;
  unit: Unit;
  weeks: WeekSummary[];
  groups: { group: MuscleGroup; sets: number }[];
  completedWorkouts: number;
  completedSets: number;
  volume: number;
  scheduledWorkouts: number;
  completedScheduledWorkouts: number;
  completionRate: number | null;
  lastWorkout: LastWorkout | null;
}
function emptyGroups(): Record<MuscleGroup, number> {
  return Object.fromEntries(MUSCLE_GROUPS.map((group) => [group, 0])) as Record<MuscleGroup, number>;
}

function workingResult(set: RecordedSet, equipment: Equipment): { reps: number; weight: number | null } | null {
  if (set.status !== "completed" || set.classification === "warmup") return null;
  const reps = numericReps(set.reps);
  const weight = equipment === "bodyweight" ? null : numericWeight(set.weight);
  if (reps === null || (equipment !== "bodyweight" && weight === null)) return null;
  return { reps, weight };
}

function lastWorkoutSummary(session: WorkoutSession | null): LastWorkout | null {
  if (!session) return null;
  const workingSets = session.exercises.reduce((total, item) => total + item.sets.reduce(
    (count, set) => count + (workingResult(set, item.exercise.equipment) ? 1 : 0), 0,
  ), 0);
  return { id: session.id, title: session.title, date: session.date, workingSets };
}

export function summarize(data: AppData, weeks: number, endDate: string, unit: Unit): AnalyticsSummary {
  parseDate(endDate);
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > 104)
    throw new Error("Choose an analytics window between 1 and 104 weeks.");
  const startDate = addDays(mondayOf(endDate), -(weeks - 1) * 7);
  const weekly = Array.from({ length: weeks }, (_, index): WeekSummary => {
    const date = addDays(startDate, index * 7);
    return { startDate: date, label: formatDate(date), setsByGroup: emptyGroups(), totalSets: 0, completedWorkouts: 0, volume: 0 };
  });
  const finished = data.sessions.filter((session) => session.status === "completed" && session.date <= endDate);
  // Import and edit timestamps describe bookkeeping, not when the workout happened.
  const latest = finished.reduce<WorkoutSession | null>(
    (previous, session) => !previous || session.date > previous.date ? session : previous, null,
  );
  const completed = finished.filter((session) => session.date >= startDate)
    .sort((a, b) => a.date.localeCompare(b.date) || a.startedAt.localeCompare(b.startedAt));
  const groups = emptyGroups();
  const weeksByStart = new Map(weekly.map((week) => [week.startDate, week]));
  const completedScheduleKeys = new Set<string>();
  let volume = 0;
  for (const session of completed) {
    completedScheduleKeys.add(session.date + ":" + session.templateId);
    const week = weeksByStart.get(mondayOf(session.date))!;
    week.completedWorkouts += 1;
    for (const exercise of session.exercises) {
      let setCount = 0;
      let exerciseVolume = 0;
      for (const set of exercise.sets) {
        const result = workingResult(set, exercise.exercise.equipment);
        if (!result) continue;
        setCount += 1;
        if (result.weight !== null)
          exerciseVolume += convertWeight(result.weight, session.unit, unit) * result.reps;
      }
      groups[exercise.exercise.group] += setCount;
      week.setsByGroup[exercise.exercise.group] += setCount;
      week.totalSets += setCount;
      week.volume += exerciseVolume;
      volume += exerciseVolume;
    }
  }
  let scheduledWorkouts = 0;
  let completedScheduledWorkouts = 0;
  for (let date = startDate; date <= endDate; date = addDays(date, 1)) {
    const planned = scheduleForDate(data, date);
    if (planned) {
      scheduledWorkouts += 1;
      if (completedScheduleKeys.has(date + ":" + planned.id)) completedScheduledWorkouts += 1;
    }
  }
  return {
    startDate, endDate, unit, weeks: weekly,
    groups: MUSCLE_GROUPS.map((group) => ({ group, sets: groups[group] })),
    completedWorkouts: completed.length,
    completedSets: Object.values(groups).reduce((sum, count) => sum + count, 0),
    volume, scheduledWorkouts, completedScheduledWorkouts,
    completionRate: scheduledWorkouts ? (completedScheduledWorkouts / scheduledWorkouts) * 100 : null,
    lastWorkout: lastWorkoutSummary(latest),
  };
}
