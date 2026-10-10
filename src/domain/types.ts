export const MUSCLE_GROUPS = [
  "Legs",
  "Glutes",
  "Back",
  "Chest",
  "Shoulders",
  "Arms",
  "Core",
] as const;
export type MuscleGroup = (typeof MUSCLE_GROUPS)[number];
export const EQUIPMENT = [
  "barbell",
  "dumbbell",
  "machine",
  "cable",
  "bodyweight",
  "other",
] as const;
export type Equipment = (typeof EQUIPMENT)[number];
export type Unit = "lb" | "kg";
export interface ProfileSettings {
  age: string;
  gender: string;
  heightCm: number | null;
  unit: Unit;
}
export interface ExerciseDefinition {
  id: string;
  name: string;
  group: MuscleGroup;
  equipment: Equipment;
  incrementLb: number;
  incrementKg: number;
}
export interface WorkoutExercise {
  exerciseId: string;
  sets: number;
  repMin: number;
  repMax: number;
}
export interface WorkoutTemplate {
  id: string;
  title: string;
  exercises: WorkoutExercise[];
  weekdays: number[];
  archived: boolean;
  updatedAt: string;
}
export interface ScheduleSlot {
  weekday: number;
  workoutIds: string[];
}
export interface ScheduleRevision {
  id: string;
  effectiveDate: string;
  anchorMonday: string;
  slots: ScheduleSlot[];
  templates: WorkoutTemplate[];
}
export interface WeightSuggestion {
  weights: (number | null)[];
  reason: string;
}
export interface RecordedSet {
  weight: string;
  reps: string;
  status: "pending" | "completed" | "skipped";
}
export interface SessionExercise {
  exercise: ExerciseDefinition;
  target: WorkoutExercise;
  suggestion: WeightSuggestion;
  sets: RecordedSet[];
}
export interface WorkoutSession {
  id: string;
  date: string;
  title: string;
  templateId: string;
  unit: Unit;
  status: "in_progress" | "completed";
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  exercises: SessionExercise[];
}
export interface AppData {
  schemaVersion: 1;
  settings: ProfileSettings;
  exercises: ExerciseDefinition[];
  templates: WorkoutTemplate[];
  scheduleRevisions: ScheduleRevision[];
  sessions: WorkoutSession[];
}
export type SaveStatus = "saved" | "saving" | "error";
export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export function newId(prefix = "id"): string {
  return (
    prefix +
    "-" +
    Date.now().toString(36) +
    "-" +
    Math.random().toString(36).slice(2, 11)
  );
}
