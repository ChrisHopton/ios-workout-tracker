const LEGACY_INCREMENT_INSTRUCTION = "The configured increment would exceed 10%; choose a smaller increment in Settings.";
const INCREMENT_HOLD_EXPLANATION = "Automatic changes are paused to keep weight steps within 10% of your current load.";

export function suggestionReasonForDisplay(reason: string): string {
  return reason.replace(LEGACY_INCREMENT_INSTRUCTION, INCREMENT_HOLD_EXPLANATION);
}
