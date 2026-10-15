import { addDays, dayDifference, formatDate, mondayOf, parseDate } from "./dates";
import { convertWeight, numericReps, numericWeight, suggestWeights } from "./recommendations";
import { scheduleForDate } from "./schedule";
import { AppData, BodyWeightEntry, Equipment, MuscleGroup, MUSCLE_GROUPS, Unit, WeightSuggestion } from "./types";

export interface WeekSummary {
  startDate: string;
  label: string;
  setsByGroup: Record<MuscleGroup, number>;
  totalSets: number;
  completedWorkouts: number;
  volume: number;
}
export interface ExerciseHistoryPoint {
  date: string;
  weight: number | null;
  reps: number;
  sets: number;
}
export interface StrengthPoint {
  date: string;
  estimate: number;
  sourceWeight: number;
  sourceReps: number;
  bodyWeight: number | null;
  measurementDate: string | null;
  measurementStale: boolean;
  relativeStrength: number | null;
}
export interface ExercisePersonalRecords {
  heaviestSet: { date: string; weight: number; reps: number } | null;
  repRecord: { date: string; weight: number | null; reps: number } | null;
}
export interface ExerciseHistory {
  exerciseId: string;
  variantId: string;
  name: string;
  group: MuscleGroup;
  equipment: Equipment;
  points: ExerciseHistoryPoint[];
  strengthPoints: StrengthPoint[];
  volume: number;
  personalRecords: ExercisePersonalRecords;
  heaviestSet: { date: string; weight: number; reps: number } | null;
  repRecord: { date: string; reps: number; weight: number | null } | null;
}
export interface BodyWeightSummary {
  points: { date: string; weight: number }[];
  change: number | null;
  latest: { date: string; weight: number } | null;
}
export interface NextWorkoutSuggestion {
  date: string;
  templateId: string;
  title: string;
  exercises: { id: string; name: string; equipment: Equipment; repMin: number; repMax: number; suggestion: WeightSuggestion }[];
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
  exerciseHistory: ExerciseHistory[];
  bodyWeight: BodyWeightSummary;
  nextWorkout: NextWorkoutSuggestion | null;
}
function emptyGroups(): Record<MuscleGroup, number> {
  return Object.fromEntries(MUSCLE_GROUPS.map((group) => [group, 0])) as Record<MuscleGroup, number>;
}

export function estimatedStrength(weight: number, reps: number): number | null {
  if (!Number.isFinite(weight) || weight <= 0 || !Number.isInteger(reps) || reps < 1 || reps > 10) return null;
  return reps === 1 ? weight : weight * (1 + reps / 30);
}

function measurementForDate(entries: BodyWeightEntry[], date: string): BodyWeightEntry | null {
  let low = 0;
  let high = entries.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (entries[middle].date <= date) low = middle + 1;
    else high = middle;
  }
  return entries[low - 1] ?? null;
}

export function nextWorkoutSuggestion(data: AppData, date: string, unit: Unit): NextWorkoutSuggestion | null {
  parseDate(date);
  // A recorded date is occupied even if its plan changed or it is still in progress.
  const occupiedDates = new Set(data.sessions.map((session) => session.date));
  for (let offset = 0; offset <= 14; offset++) {
    const candidateDate = addDays(date, offset);
    const plan = scheduleForDate(data, candidateDate);
    if (!plan || occupiedDates.has(candidateDate)) continue;
    return {
      date: candidateDate,
      templateId: plan.id,
      title: plan.title,
      exercises: plan.exercises.flatMap((target) => {
        const definition = data.exercises.find((exercise) => exercise.id === target.exerciseId);
        if (!definition) return [];
        return [{ id: definition.id, name: definition.name, equipment: definition.equipment,
          repMin: target.repMin, repMax: target.repMax,
          suggestion: suggestWeights(data, target, definition, candidateDate, unit) }];
      }),
    };
  }
  return null;
}

function personalRecords(data: AppData, endDate: string, unit: Unit): Map<string, ExercisePersonalRecords> {
  const records = new Map<string, ExercisePersonalRecords>();
  for (const session of data.sessions) {
    if (session.status !== "completed" || session.date > endDate) continue;
    for (const item of session.exercises) {
      const variantId = item.exercise.id + ":" + item.exercise.equipment;
      const current = records.get(variantId) ?? { heaviestSet: null, repRecord: null };
      for (const set of item.sets) {
        if (set.classification === "warmup" || set.status !== "completed") continue;
        const reps = numericReps(set.reps);
        const rawWeight = item.exercise.equipment === "bodyweight" ? null : numericWeight(set.weight);
        if (reps === null || (item.exercise.equipment !== "bodyweight" && rawWeight === null)) continue;
        const weight = rawWeight === null ? null : convertWeight(rawWeight, session.unit, unit);
        if (weight !== null && (!current.heaviestSet || weight > current.heaviestSet.weight ||
          (weight === current.heaviestSet.weight && reps > current.heaviestSet.reps))) current.heaviestSet = { date: session.date, weight, reps };
        if (!current.repRecord || reps > current.repRecord.reps ||
          (reps === current.repRecord.reps && (weight ?? 0) > (current.repRecord.weight ?? 0))) current.repRecord = { date: session.date, weight, reps };
      }
      records.set(variantId, current);
    }
  }
  return records;
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
  const completed = data.sessions.filter((session) => session.status === "completed" &&
    session.date >= startDate && session.date <= endDate)
    .sort((a, b) => a.date.localeCompare(b.date) || a.startedAt.localeCompare(b.startedAt));
  const measurements = [...(data.bodyWeights ?? [])].sort((a, b) => a.date.localeCompare(b.date) || a.updatedAt.localeCompare(b.updatedAt));
  const groups = emptyGroups();
  const weeksByStart = new Map(weekly.map((week) => [week.startDate, week]));
  const completedScheduleKeys = new Set<string>();
  const exerciseHistory = new Map<string, ExerciseHistory>();
  const allTimeRecords = personalRecords(data, endDate, unit);
  let volume = 0;
  for (const session of completed) {
    completedScheduleKeys.add(session.date + ":" + session.templateId);
    const week = weeksByStart.get(mondayOf(session.date))!;
    const bodyWeight = measurementForDate(measurements, session.date);
    week.completedWorkouts += 1;
    for (const exercise of session.exercises) {
      const isBodyweight = exercise.exercise.equipment === "bodyweight";
      let setCount = 0;
      let exerciseVolume = 0;
      let best: { weight: number | null; reps: number } | null = null;
      let bestReps: { weight: number | null; reps: number } | null = null;
      let strength: { estimate: number; weight: number; reps: number } | null = null;
      for (const set of exercise.sets) {
        if (set.status !== "completed" || set.classification === "warmup") continue;
        const reps = numericReps(set.reps);
        const recordedWeight = isBodyweight ? null : numericWeight(set.weight);
        if (reps === null || (!isBodyweight && recordedWeight === null)) continue;
        const weight = recordedWeight === null ? null : convertWeight(recordedWeight, session.unit, unit);
        setCount += 1;
        exerciseVolume += (weight ?? 0) * reps;
        if (!best || (weight ?? 0) > (best.weight ?? 0) ||
          ((weight ?? 0) === (best.weight ?? 0) && reps > best.reps)) best = { weight, reps };
        if (!bestReps || reps > bestReps.reps ||
          (reps === bestReps.reps && (weight ?? 0) > (bestReps.weight ?? 0))) bestReps = { weight, reps };
        const estimate = weight === null ? null : estimatedStrength(weight, reps);
        if (estimate !== null && (!strength || estimate > strength.estimate)) strength = { estimate, weight: weight!, reps };
      }
      groups[exercise.exercise.group] += setCount;
      week.setsByGroup[exercise.exercise.group] += setCount;
      week.totalSets += setCount;
      week.volume += exerciseVolume;
      volume += exerciseVolume;
      if (!best || !bestReps) continue;
      const variantId = exercise.exercise.id + ":" + exercise.exercise.equipment;
      const history: ExerciseHistory = exerciseHistory.get(variantId) ?? {
        exerciseId: exercise.exercise.id, variantId, name: exercise.exercise.name,
        group: exercise.exercise.group, equipment: exercise.exercise.equipment,
        points: [], strengthPoints: [], volume: 0, heaviestSet: null, repRecord: null,
        personalRecords: allTimeRecords.get(variantId) ?? { heaviestSet: null, repRecord: null },
      };
      history.name = exercise.exercise.name;
      history.volume += exerciseVolume;
      history.points.push({ date: session.date, weight: best.weight, reps: best.reps, sets: setCount });
      if (strength) history.strengthPoints.push({
        date: session.date, estimate: strength.estimate, sourceWeight: strength.weight, sourceReps: strength.reps,
        bodyWeight: bodyWeight ? convertWeight(bodyWeight.weightKg, "kg", unit) : null,
        measurementDate: bodyWeight?.date ?? null,
        measurementStale: bodyWeight ? dayDifference(session.date, bodyWeight.date) > 28 : false,
        relativeStrength: bodyWeight ? convertWeight(strength.estimate, unit, "kg") / bodyWeight.weightKg : null,
      });
      if (best.weight !== null && (!history.heaviestSet || best.weight > history.heaviestSet.weight ||
        (best.weight === history.heaviestSet.weight && best.reps > history.heaviestSet.reps))) {
        history.heaviestSet = { date: session.date, weight: best.weight, reps: best.reps };
      }
      if (!history.repRecord || bestReps.reps > history.repRecord.reps ||
        (bestReps.reps === history.repRecord.reps && (bestReps.weight ?? 0) > (history.repRecord.weight ?? 0))) {
        history.repRecord = { date: session.date, reps: bestReps.reps, weight: bestReps.weight };
      }
      exerciseHistory.set(variantId, history);
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
  const bodyPoints = measurements.filter((entry) => entry.date >= startDate && entry.date <= endDate)
    .map((entry) => ({ date: entry.date, weight: convertWeight(entry.weightKg, "kg", unit) }));
  const lastMeasurement = measurementForDate(measurements, endDate);
  return {
    startDate, endDate, unit, weeks: weekly,
    groups: MUSCLE_GROUPS.map((group) => ({ group, sets: groups[group] })),
    completedWorkouts: completed.length,
    completedSets: Object.values(groups).reduce((sum, count) => sum + count, 0),
    volume, scheduledWorkouts, completedScheduledWorkouts,
    completionRate: scheduledWorkouts ? (completedScheduledWorkouts / scheduledWorkouts) * 100 : null,
    exerciseHistory: [...exerciseHistory.values()].sort((a, b) => a.name.localeCompare(b.name)),
    bodyWeight: {
      points: bodyPoints,
      change: bodyPoints.length >= 2 ? bodyPoints[bodyPoints.length - 1].weight - bodyPoints[0].weight : null,
      latest: lastMeasurement ? { date: lastMeasurement.date, weight: convertWeight(lastMeasurement.weightKg, "kg", unit) } : null,
    },
    nextWorkout: nextWorkoutSuggestion(data, endDate, unit),
  };
}
