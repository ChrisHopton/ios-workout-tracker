import test from "node:test";
import assert from "node:assert/strict";
import { GENDER_OPTIONS, genderLabel, uploadStatusLabel, uploadProblem } from "../src/components/settingsPresentation";
import { DISCONNECTED_SYNC_STATE } from "../src/sync/controller";

test("upload status distinguishes setup, transfer, pending and confirmed completion", () => {
  const base = { ...DISCONNECTED_SYNC_STATE };
  assert.equal(uploadStatusLabel(base), "Setting up");
  const enrolled = { ...base, bound: true, phase: "idle" as const };
  assert.equal(uploadStatusLabel({ ...enrolled, status: "syncing" }), "Uploading");
  assert.equal(uploadStatusLabel({ ...enrolled, status: "pending" }), "Waiting to upload");
  assert.equal(uploadStatusLabel({ ...enrolled, status: "synced", initialComplete: true }), "Up to date");
  assert.equal(uploadStatusLabel({ ...enrolled, status: "synced", initialComplete: true, pending: 1 }), "Waiting to upload");
  assert.equal(uploadStatusLabel({ ...enrolled, status: "synced", initialComplete: false }), "Waiting to upload");
});
test("errors have useful status labels and never expose arbitrary error text", () => {
  const base = { ...DISCONNECTED_SYNC_STATE, status: "error" as const, error: "SECRET TOKEN private payload", initialComplete: true };
  assert.equal(uploadStatusLabel(base), "Uploads paused");
  assert.equal(uploadStatusLabel({ ...base, errorKind: "enrollment", retryable: true }), "Waiting to upload");
  assert.equal(uploadStatusLabel({ ...base, errorKind: "network", retryable: true }), "Waiting to upload");
  for (const kind of ["network", "auth", "quota", "invalid", "storage", "attestation", "enrollment"] as const) {
    const message = uploadProblem({ ...base, errorKind: kind });
    assert.ok(message); assert.doesNotMatch(message, /SECRET|TOKEN|private payload/);
  }
  assert.equal(uploadProblem({ ...base, error: null }), null);
});
test("gender labels support unset profiles and preserve unfamiliar legacy values", () => {
  assert.equal(genderLabel(""), "Unspecified");
  assert.equal(genderLabel("  "), "Unspecified");
  assert.equal(genderLabel("FEMALE"), "Female");
  assert.equal(genderLabel("MALE"), "Male");
  assert.equal(genderLabel(" Prefer not to say "), " Prefer not to say ");
  assert.equal(genderLabel("non-binary"), "non-binary");
  assert.equal(genderLabel("Self-described legacy value"), "Self-described legacy value");
});

test("gender selection only offers female and male, with no unset choice", () => {
  assert.deepEqual(GENDER_OPTIONS, [
    { value: "female", label: "Female" },
    { value: "male", label: "Male" },
  ]);
});
