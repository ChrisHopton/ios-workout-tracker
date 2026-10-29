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
  phoneCountryCode: string;
  phoneNumber: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: "" | "Male" | "Female";
  profileCompletedAt: string | null;
  heightCm: number | null;
  unit: Unit;
}
export interface BodyWeightEntry {
  id: string;
  date: string;
  weightKg: number;
  updatedAt: string;
}
export type WorkoutRecurrence =
  | { kind: "weekly" }
  | { kind: "biweekly"; anchorMonday: string }
  | {
      kind: "legacy";
      anchorMonday: string;
      weekdaysA: number[];
      weekdaysB: number[];
    };
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
  recurrence: WorkoutRecurrence;
  archived: boolean;
  updatedAt: string;
}
export interface ScheduleSlot {
  weekday: number;
  workoutIds: (string | null)[];
}
export interface ScheduleRevision {
  id: string;
  effectiveDate: string;
  anchorMonday: string;
  slots: ScheduleSlot[];
  templates: WorkoutTemplate[];
}
export interface WeightSuggestion {
  algorithmVersion: 1 | 2;
  weights: (number | null)[];
  reason: string;
}
export interface RecordedSet {
  classification: "working" | "warmup";
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
  schemaVersion: 3;
  settings: ProfileSettings;
  bodyWeights: BodyWeightEntry[];
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
