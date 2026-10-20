import test from "node:test";
import assert from "node:assert/strict";
import { genderLabel, uploadStatusLabel } from "../src/components/settingsPresentation";

test("uploads are only up to date after confirmed sync and the initial history upload", () => {
  assert.equal(uploadStatusLabel({ status: "synced", initialComplete: true, error: null }), "Up to date");
  for (const status of ["disconnected", "pending", "syncing", "synced"] as const) {
    assert.equal(uploadStatusLabel({ status, initialComplete: false, error: null }), "Waiting for connection");
  }
  for (const status of ["disconnected", "pending", "syncing"] as const) {
    assert.equal(uploadStatusLabel({ status, initialComplete: true, error: null }), "Waiting for connection");
  }
});

test("upload failures and pauses take precedence over completion", () => {
  for (const status of ["error", "paused"] as const) {
    assert.equal(uploadStatusLabel({ status, initialComplete: true, error: null }), "Upload needs attention");
  }
  for (const status of ["disconnected", "synced"] as const) {
    assert.equal(uploadStatusLabel({ status, initialComplete: true, error: "Upload failed" }), "Upload needs attention");
  }
});

test("gender labels support unset profiles and preserve unfamiliar legacy values", () => {
  assert.equal(genderLabel(""), "Unspecified");
  assert.equal(genderLabel("  "), "Unspecified");
  assert.equal(genderLabel("FEMALE"), "Female");
  assert.equal(genderLabel(" Prefer not to say "), "Prefer not to say");
  assert.equal(genderLabel("Self-described legacy value"), "Self-described legacy value");
});
