import test from "node:test";
import assert from "node:assert/strict";
import { convertWeight } from "../src/domain/recommendations";
import { initialData } from "../src/domain/library";
import { ageFromDateOfBirth, completeProfile, editProfile, isProfileComplete, normalizePhone, profileDraft, validateProfileDraft, type ProfileDraft } from "../src/domain/profile";
import { parseBackup, serializeBackup, upgradeData, validateData, validateStoredData, type LegacyV2AppData } from "../src/domain/backup";
import { SaveAction } from "../src/components/saveAction";
import { SaveQueue } from "../src/data/saveQueue";
import { snapshot } from "../src/data/snapshot";
import { type AppData } from "../src/domain/types";

const asOf = "2026-10-28";
const timestamp = "2026-10-28T15:30:00.000Z";
const draft: ProfileDraft = {
  phoneCountryCode: "+1", phoneNumber: "(312) 555-0123",
  firstName: "  Alex ", lastName: "Rivera  ", dateOfBirth: "1990-10-29", gender: "Female",
};

test("new devices have no fabricated personal details or completion", () => {
  const data = initialData();
  assert.equal(data.schemaVersion, 4);
  assert.equal(data.settings.phoneCountryCode, "+1");
  for (const field of ["firstName", "lastName", "dateOfBirth", "phoneNumber", "gender"] as const)
    assert.equal(data.settings[field], "");
  assert.equal(data.settings.profileCompletedAt, null);
  assert.equal("age" in data.settings, false);
  assert.equal(isProfileComplete(data, asOf), false);
});

test("phone normalization supports national and international input with an editable country code", () => {
  assert.deepEqual(normalizePhone(" +1 ", "(312) 555-0123"), { phoneCountryCode: "+1", phoneNumber: "+13125550123" });
  assert.equal(normalizePhone("+44", "20 7946 0123").phoneNumber, "+442079460123");
  assert.equal(normalizePhone("+44", "+44 20 7946 0123").phoneNumber, "+442079460123");
  for (const [code, number] of [["1", "3125550123"], ["+0", "3125550123"], ["+1234", "3125550123"], ["+1", ""],
    ["+1", "123"], ["+1", "+442079460123"], ["+1", "555-CALL"], ["+1", "123456789012345"]])
    assert.throws(() => normalizePhone(code, number));
});

test("date of birth age uses calendar birthdays and March 1 for leap-day birthdays", () => {
  assert.equal(ageFromDateOfBirth("1990-10-29", "2026-10-28"), 35);
  assert.equal(ageFromDateOfBirth("1990-10-29", "2026-10-29"), 36);
  assert.equal(ageFromDateOfBirth("2000-02-29", "2025-02-28"), 24);
  assert.equal(ageFromDateOfBirth("2000-02-29", "2025-03-01"), 25);
  assert.equal(ageFromDateOfBirth("2000-02-29", "2024-02-29"), 24);
  assert.equal(ageFromDateOfBirth(asOf, asOf), 0);
  assert.equal(ageFromDateOfBirth("1896-10-28", asOf), 130);
  for (const birth of ["", "2026-10-29", "2026-02-29", "2000-02-30", "10/29/1990", "1895-10-28"])
    assert.equal(ageFromDateOfBirth(birth, asOf), null);
  assert.equal(ageFromDateOfBirth("2000-02-29", "invalid"), null);
});

test("required profile validation trims names and rejects missing, invalid and unsupported values", () => {
  assert.equal(validateProfileDraft(draft, asOf).firstName, "Alex");
  for (const patch of [{ firstName: " " }, { lastName: "" }, { firstName: "A".repeat(101) },
    { lastName: "line\nbreak" }, { dateOfBirth: "" }, { dateOfBirth: "2026-10-29" }, { gender: "" },
    { gender: "other" }, { phoneNumber: "" }]) {
    const invalid = { ...draft, ...patch } as ProfileDraft;
    assert.throws(() => validateProfileDraft(invalid, asOf));
  }
});

test("onboarding completion atomically writes normalized profile and today's kg weight", () => {
  const data = initialData();
  const before = structuredClone(data);
  const next = completeProfile(data, draft, "72.34567", asOf, timestamp);
  assert.deepEqual(data, before);
  assert.equal(next.settings.phoneNumber, "+13125550123");
  assert.equal(next.settings.firstName, "Alex");
  assert.equal(next.settings.lastName, "Rivera");
  assert.equal(next.settings.profileCompletedAt, timestamp);
  assert.equal(next.settings.unit, "lb");
  assert.equal(next.bodyWeights.length, 1);
  assert.equal(next.bodyWeights[0].date, asOf);
  assert.equal(next.bodyWeights[0].weightKg, convertWeight(72.34567, "lb", "kg"));
  const metric = completeProfile({ ...data, settings: { ...data.settings, unit: "kg" } }, draft, "72.34567", asOf, timestamp);
  assert.equal(metric.bodyWeights[0].weightKg, 72.34567);
  assert.equal(isProfileComplete(next, asOf), true);
  assert.equal(next.templates, data.templates);
  assert.equal(next.sessions, data.sessions);
  assert.deepEqual(parseBackup(serializeBackup(next)), next);
  const changed = completeProfile(next, draft, "73", asOf, timestamp);
  assert.equal(changed.bodyWeights.length, 1);
  assert.equal(changed.bodyWeights[0].id, next.bodyWeights[0].id);
  for (const weight of ["", "0", "-1", "1103", "NaN"])
    assert.throws(() => completeProfile(data, draft, weight, asOf, timestamp), /body weight/);
  assert.equal(data.settings.profileCompletedAt, null);
  assert.equal(data.bodyWeights.length, 0);
});

test("profile editing preserves measurement history and completion does not depend on later weight deletion", () => {
  const completed = completeProfile(initialData(), draft, "70", asOf, timestamp);
  const edited = editProfile(completed, { ...draft, phoneCountryCode: "+44", phoneNumber: "20 7946 0123", dateOfBirth: "1980-06-15", gender: "Male" }, 178.435, asOf);
  assert.equal(edited.bodyWeights, completed.bodyWeights);
  assert.equal(edited.settings.profileCompletedAt, timestamp);
  assert.equal(edited.settings.heightCm, 178.435);
  assert.equal(edited.settings.phoneNumber, "+442079460123");
  const withoutMeasurements = { ...edited, bodyWeights: [] };
  assert.equal(isProfileComplete(withoutMeasurements, asOf), true);
  assert.deepEqual(profileDraft(edited.settings), {
    phoneCountryCode: "+44", phoneNumber: "2079460123", firstName: "Alex", lastName: "Rivera", dateOfBirth: "1980-06-15", gender: "Male",
  });
  assert.throws(() => editProfile(edited, draft, 301, asOf), /height/);
  assert.equal(isProfileComplete({ settings: { ...edited.settings, profileCompletedAt: null } }, asOf), false);
  assert.equal(isProfileComplete({ settings: { ...edited.settings, dateOfBirth: "" } }, asOf), false);
});

test("a v2 import preserves journal and weights, drops age, and requires missing profile information", () => {
  const source = initialData();
  source.bodyWeights = [{ id: "existing-weight", date: "2026-10-27", weightKg: 74.125, updatedAt: timestamp }];
  const { routineProgress: _progress, ...legacySource } = source;
  const legacy: LegacyV2AppData = {
    ...legacySource, schemaVersion: 2, settings: { age: "36", gender: "female", heightCm: 170.25, unit: "kg" },
  };
  const original = JSON.stringify(legacy);
  assert.equal(validateStoredData(legacy), legacy);
  const upgraded = upgradeData(legacy);
  assert.equal(JSON.stringify(legacy), original);
  assert.deepEqual(upgraded.bodyWeights, legacy.bodyWeights);
  assert.deepEqual(upgraded.exercises, legacy.exercises);
  assert.deepEqual(upgraded.sessions, legacy.sessions);
  assert.equal(upgraded.settings.gender, "Female");
  assert.equal(upgraded.settings.heightCm, 170.25);
  assert.equal(upgraded.settings.dateOfBirth, "");
  assert.equal(upgraded.settings.firstName, "");
  assert.equal(upgraded.settings.lastName, "");
  assert.equal(upgraded.settings.phoneNumber, "");
  assert.equal(upgraded.settings.profileCompletedAt, null);
  assert.equal("age" in upgraded.settings, false);
  assert.equal(isProfileComplete(upgraded, asOf), false);
  assert.deepEqual(parseBackup(original), upgraded);
  assert.equal(upgradeData({ ...legacy, settings: { ...legacy.settings, gender: "custom" } }).settings.gender, "");
});

test("current backup validation rejects malformed profile metadata without changing valid set schema", () => {
  const data = completeProfile(initialData(), draft, "70", asOf, timestamp);
  for (const patch of [{ phoneNumber: "3125550123" }, { dateOfBirth: "2026-02-30" }, { gender: "female" },
    { firstName: "" }, { profileCompletedAt: "2026-02-30T15:30:00.000Z" }, { age: "36" }])
    assert.throws(() => validateData({ ...data, settings: { ...data.settings, ...patch } }), /Invalid backup/);
});

test("onboarding stays incomplete through a delayed save and failure, preserving fields for durable retry", async () => {
  let visible = snapshot(initialData());
  let persisted = visible;
  let attempts = 0;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const queue = new SaveQueue<AppData>(async (next) => {
    attempts++;
    if (attempts === 1) { await pending; throw new Error("Disk full"); }
    persisted = next;
  });
  const action = new SaveAction();
  const input = { ...draft };
  const save = () => action.run(async () => {
    const next = snapshot(completeProfile(visible, input, "74", asOf, timestamp));
    await queue.replace(next, visible);
    visible = next;
  }, async () => {});
  const first = save();
  assert.equal(isProfileComplete(visible, asOf), false);
  assert.equal(action.getSnapshot().status, "saving");
  assert.equal(await save(), false);
  release();
  assert.equal(await first, false);
  assert.equal(isProfileComplete(visible, asOf), false);
  assert.equal(persisted.bodyWeights.length, 0);
  assert.deepEqual(input, draft);
  assert.equal(action.getSnapshot().status, "error");
  assert.equal(await save(), true);
  assert.equal(isProfileComplete(visible, asOf), true);
  assert.equal(persisted, visible);
  assert.equal(persisted.bodyWeights.length, 1);
  assert.equal(attempts, 2);
});

test("profile creation and editing work without a network connection", () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = (() => { throw new Error("Network is unavailable"); }) as typeof fetch;
  try {
    const data = completeProfile(initialData(), draft, "70", asOf, timestamp);
    assert.equal(isProfileComplete(editProfile(data, draft, null, asOf), asOf), true);
  } finally { globalThis.fetch = oldFetch; }
});
