import type { SyncViewState } from "../sync/controller";

export const GENDER_OPTIONS = [
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
] as const;

// Legacy profile strings remain intact until the user chooses a new value.
export function genderLabel(value: string): string {
  if (!value.trim()) return "Unspecified";
  return GENDER_OPTIONS.find((option) => option.value === value.trim().toLowerCase())
    ?.label ?? value;
}

export function uploadStatusLabel(
  state: Pick<SyncViewState, "status" | "initialComplete" | "error">,
): string {
  if (state.error || state.status === "error" || state.status === "paused") {
    return "Upload needs attention";
  }
  return state.status === "synced" && state.initialComplete
    ? "Up to date"
    : "Waiting for connection";
}
