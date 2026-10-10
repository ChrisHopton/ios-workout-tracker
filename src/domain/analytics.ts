import { addDays, formatDate, mondayOf, parseDate } from "./dates";
import { convertWeight, numericReps, numericWeight } from "./recommendations";
import { scheduleForDate } from "./schedule";
import { AppData, Equipment, MuscleGroup, MUSCLE_GROUPS, Unit } from "./types";

export interface WeekSummary {
  startDate: string;
  label: string;
  setsByGroup: Record<MuscleGroup, number>;
  totalSets: number;
  completedWorkouts: number;
}
export interface ExerciseHistoryPoint {
  date: string;
  weight: number | null;
  reps: number;
  sets: number;
}
export interface ExerciseHistory {
  exerciseId: string;
  name: string;
  group: MuscleGroup;
  equipment: Equipment;
  points: ExerciseHistoryPoint[];
  heaviestSet: { date: string; weight: number; reps: number } | null;
}
export interface AnalyticsSummary {
  startDate: string;
  endDate: string;
  unit: Unit;
  weeks: WeekSummary[];
  groups: { group: MuscleGroup; sets: number }[];
  completedWorkouts: number;
  completedSets: number;
  scheduledWorkouts: number;
  completedScheduledWorkouts: number;
  completionRate: number | null;
  exerciseHistory: ExerciseHistory[];
}
function emptyGroups(): Record<MuscleGroup, number> {
  return Object.fromEntries(MUSCLE_GROUPS.map((group) => [group, 0])) as Record<
    MuscleGroup,
    number
  >;
}

export function summarize(
  data: AppData,
  weeks: number,
  endDate: string,
  unit: Unit,
): AnalyticsSummary {
  parseDate(endDate);
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > 104)
    throw new Error("Choose an analytics window between 1 and 104 weeks.");
  const startDate = addDays(mondayOf(endDate), -(weeks - 1) * 7);
  const weekly = Array.from({ length: weeks }, (_, index): WeekSummary => {
    const date = addDays(startDate, index * 7);
    return {
      startDate: date,
      label: formatDate(date),
      setsByGroup: emptyGroups(),
      totalSets: 0,
      completedWorkouts: 0,
    };
  });
  const completed = data.sessions
    .filter(
      (session) =>
        session.status === "completed" &&
        session.date >= startDate &&
        session.date <= endDate,
    )
    .sort((a, b) => a.date.localeCompare(b.date));
  const groups = emptyGroups();
  const exerciseHistory = new Map<string, ExerciseHistory>();
  for (const session of completed) {
    const week = weekly.find(
      (item) => item.startDate === mondayOf(session.date),
    )!;
    week.completedWorkouts += 1;
    for (const exercise of session.exercises) {
      const isBodyweight = exercise.exercise.equipment === "bodyweight";
      const sets = exercise.sets.filter(
        (set) =>
          set.status === "completed" &&
          numericReps(set.reps) !== null &&
          (isBodyweight || numericWeight(set.weight) !== null),
      );
      groups[exercise.exercise.group] += sets.length;
      week.setsByGroup[exercise.exercise.group] += sets.length;
      week.totalSets += sets.length;
      if (!sets.length) continue;
      const ranked = sets
        .map((set) => ({
          weight: isBodyweight
            ? null
            : convertWeight(numericWeight(set.weight)!, session.unit, unit),
          reps: numericReps(set.reps)!,
        }))
        .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0) || b.reps - a.reps);
      const best = ranked[0];
      const history = exerciseHistory.get(exercise.exercise.id) ?? {
        exerciseId: exercise.exercise.id,
        name: exercise.exercise.name,
        group: exercise.exercise.group,
        equipment: exercise.exercise.equipment,
        points: [],
        heaviestSet: null,
      };
      // Use the latest snapshot name while retaining actual historical weights and dates.
      history.name = exercise.exercise.name;
      history.points.push({
        date: session.date,
        weight: best.weight,
        reps: best.reps,
        sets: sets.length,
      });
      if (
        best.weight !== null &&
        (!history.heaviestSet ||
          best.weight > history.heaviestSet.weight ||
          (best.weight === history.heaviestSet.weight &&
            best.reps > history.heaviestSet.reps))
      ) {
        history.heaviestSet = {
          date: session.date,
          weight: best.weight,
          reps: best.reps,
        };
      }
      exerciseHistory.set(exercise.exercise.id, history);
    }
  }
  let scheduledWorkouts = 0;
  let completedScheduledWorkouts = 0;
  for (let date = startDate; date <= endDate; date = addDays(date, 1)) {
    const planned = scheduleForDate(data, date);
    if (planned) {
      scheduledWorkouts += 1;
      if (
        completed.some(
          (session) =>
            session.date === date && session.templateId === planned.id,
        )
      )
        completedScheduledWorkouts += 1;
    }
  }
  return {
    startDate,
    endDate,
    unit,
    weeks: weekly,
    groups: MUSCLE_GROUPS.map((group) => ({ group, sets: groups[group] })),
    completedWorkouts: completed.length,
    completedSets: Object.values(groups).reduce((sum, count) => sum + count, 0),
    scheduledWorkouts,
    completedScheduledWorkouts,
    completionRate: scheduledWorkouts
      ? (completedScheduledWorkouts / scheduledWorkouts) * 100
      : null,
    exerciseHistory: [...exerciseHistory.values()].sort((a, b) =>
      a.name.localeCompare(b.name),
    ),
  };
}
