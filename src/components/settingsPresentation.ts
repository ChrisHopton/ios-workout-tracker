import { isAttestationDiagnostic } from "../sync/attestationDiagnostic";
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
  state: Pick<SyncViewState, "status" | "initialComplete" | "error" | "errorKind" | "retryable" | "phase" | "bound" | "pending">,
): string {
  if (state.error || state.status === "error" || state.status === "paused")
    return state.retryable && (state.errorKind === "network" || state.errorKind === "enrollment") ? "Waiting to upload" : "Uploads paused";
  if (state.phase === "setup" || state.phase === "enrollment") return "Setting up";
  if (state.status === "syncing") return "Uploading";
  if (state.status === "synced" && state.bound && state.initialComplete && state.pending === 0) return "Up to date";
  return "Waiting to upload";
}

export function uploadProblem(state: Pick<SyncViewState, "error" | "errorKind" | "retryable">): string | null {
  if (!state.error) return null;
  switch (state.errorKind) {
    case "network": return "Could not reach the upload service. Keep the app open online to retry.";
    case "enrollment": return "Registration is waiting for authorization from the app owner.";
    case "attestation": return isAttestationDiagnostic(state.error) ? state.error : "App verification could not finish. The app owner may need to check this installation.";
    case "quota": return "An upload service limit was reached. Uploads will retry at the time shown below.";
    case "auth": return "Upload access needs attention from the app owner.";
    case "storage": return state.retryable ? "Upload settings could not be loaded. Retry when available." : "Saved upload settings need attention from the app owner.";
    default: return "Uploads need attention from the app owner.";
  }
}
