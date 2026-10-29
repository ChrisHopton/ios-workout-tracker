import assert from "node:assert/strict";
import test from "node:test";
import { suggestionReasonForDisplay } from "../src/components/suggestionPresentation";

const legacyInstruction = "The configured increment would exceed 10%; choose a smaller increment in Settings.";
const holdExplanation = "Automatic changes are paused to keep weight steps within 10% of your current load.";

test("historical suggestion wording hides the retired Settings instruction without changing the saved snapshot", () => {
  for (const load of ["50 lb", "22.5 kg"]) {
    const saved = Object.freeze({
      algorithmVersion: 1,
      weights: Object.freeze([50, 50]),
      reason: "Hold " + load + ". " + legacyInstruction,
    });
    const before = JSON.stringify(saved);
    assert.equal(suggestionReasonForDisplay(saved.reason), "Hold " + load + ". " + holdExplanation);
    assert.equal(JSON.stringify(saved), before);
  }
});

test("only the exact legacy sentence is normalized; other historical explanations stay verbatim", () => {
  for (const reason of [
    "", "Imported actual results", "Hold 50 lb. " + holdExplanation,
    "Choose a smaller increment in Settings.",
    legacyInstruction.replace("Settings", "settings"),
    legacyInstruction.replace("10%", "5%"),
    legacyInstruction.replace("; ", ". "),
    legacyInstruction.slice(0, -1),
  ]) assert.equal(suggestionReasonForDisplay(reason), reason);
});
