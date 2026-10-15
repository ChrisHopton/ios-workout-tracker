import { AppData, Equipment, ExerciseDefinition, MuscleGroup } from "./types";
const entries: [string, MuscleGroup, Equipment][] = [
  ["Barbell squat", "Legs", "barbell"],
  ["Goblet squat", "Legs", "dumbbell"],
  ["Leg press", "Legs", "machine"],
  ["Leg extension", "Legs", "machine"],
  ["Lying leg curl", "Legs", "machine"],
  ["Seated leg curl", "Legs", "machine"],
  ["Romanian deadlift", "Legs", "barbell"],
  ["Dumbbell lunge", "Legs", "dumbbell"],
  ["Calf raise", "Legs", "machine"],
  ["Hip thrust", "Glutes", "barbell"],
  ["Glute bridge", "Glutes", "bodyweight"],
  ["Cable kickback", "Glutes", "cable"],
  ["Bulgarian split squat", "Glutes", "dumbbell"],
  ["Deadlift", "Back", "barbell"],
  ["Lat pulldown", "Back", "cable"],
  ["Seated cable row", "Back", "cable"],
  ["Dumbbell row", "Back", "dumbbell"],
  ["Barbell row", "Back", "barbell"],
  ["Pull-up", "Back", "bodyweight"],
  ["Bench press", "Chest", "barbell"],
  ["Dumbbell bench press", "Chest", "dumbbell"],
  ["Incline dumbbell press", "Chest", "dumbbell"],
  ["Cable chest fly", "Chest", "cable"],
  ["Push-up", "Chest", "bodyweight"],
  ["Overhead press", "Shoulders", "barbell"],
  ["Dumbbell shoulder press", "Shoulders", "dumbbell"],
  ["Lateral raise", "Shoulders", "dumbbell"],
  ["Face pull", "Shoulders", "cable"],
  ["Dumbbell curl", "Arms", "dumbbell"],
  ["Hammer curl", "Arms", "dumbbell"],
  ["Triceps pushdown", "Arms", "cable"],
  ["Barbell curl", "Arms", "barbell"],
  ["Overhead triceps extension", "Arms", "dumbbell"],
  ["Crunch", "Core", "bodyweight"],
  ["Hanging knee raise", "Core", "bodyweight"],
  ["Cable crunch", "Core", "cable"],
  ["Bodyweight squat", "Legs", "bodyweight"],
];
export const EXERCISE_LIBRARY: ExerciseDefinition[] = entries.map(
  ([name, group, equipment]) => ({
    id: "exercise-" + name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    name,
    group,
    equipment,
    incrementLb: 5,
    incrementKg: 2.5,
  }),
);
export function initialData(): AppData {
  return {
    schemaVersion: 2,
    settings: { age: "", gender: "", heightCm: null, unit: "lb" },
    bodyWeights: [],
    exercises: EXERCISE_LIBRARY.map((e) => ({ ...e })),
    templates: [],
    scheduleRevisions: [],
    sessions: [],
  };
}
export function loadLabel(equipment: Equipment): string {
  return equipment === "dumbbell"
    ? "Per dumbbell"
    : equipment === "barbell"
      ? "Total, including bar"
      : equipment === "bodyweight"
        ? "Bodyweight · reps only"
        : equipment === "machine" || equipment === "cable"
          ? "Displayed stack weight"
          : "External weight";
}
