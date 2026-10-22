import assert from "node:assert/strict";
import test from "node:test";
import bodyTable from "../src/data/benchmarks/body-weight.json";
import strengthTable from "../src/data/benchmarks/strength.json";
import { BodyCohort, StrengthCohort, bodyWeightBenchmark, strengthBenchmark, referenceGroupForGender, benchmarkMeasurement, cohortLabel } from "../src/domain/benchmarks";
import { chartScale } from "../src/components/chartReference";
import { convertWeight } from "../src/domain/recommendations";

const body: BodyCohort = { group: "female", ageMin: 20, ageMax: 39, lower: 160, upper: 170, count: 100, effectiveCount: 50, meanKg: 65 };
const lifters: StrengthCohort = { group: "male", ageMin: 30, ageMax: 39, lower: 80, upper: 90, count: 100, squatKg: 180, benchKg: 120, deadliftKg: 210 };

test("body reference uses inclusive age and half-open height bounds with exact minimum samples", () => {
  for (const [age, height] of [["20", 160], ["39", 169.99]] as const) {
    const result = bodyWeightBenchmark({ age, heightCm: height }, "female", [body]);
    assert.equal(result.available && result.valueKg, 65);
    assert.equal(result.available && result.widerBand, false);
  }
  for (const [age, height] of [["19", 165], ["40", 165], ["30", 170], ["30", 159.99]] as const)
    assert.equal(bodyWeightBenchmark({ age, heightCm: height }, "female", [body]).available, false);
  assert.equal(bodyWeightBenchmark({ age: "30", heightCm: 165 }, "male", [body]).available, false);
});

test("sparse body cohorts widen only height, with explicit labels and no sex or age fallback", () => {
  const wide = { ...body, upper: 180, meanKg: 68 };
  for (const narrow of [{ ...body, count: 99 }, { ...body, effectiveCount: 49.99 }, { ...body, meanKg: null }]) {
    const result = bodyWeightBenchmark({ age: "30", heightCm: 165 }, "female", [narrow, wide]);
    assert.equal(result.available && result.valueKg, 68);
    assert.equal(result.available && result.widerBand, true);
    assert.match(result.available ? cohortLabel(result.cohort, "height") : "", /160–<180 cm/);
    assert.deepEqual(bodyWeightBenchmark({ age: "30", heightCm: 165 }, "female", [narrow]), { available: false, reason: "Not enough matching data." });
  }
  assert.equal(bodyWeightBenchmark({ age: "40", heightCm: 165 }, "female", [wide]).available, false);
});

test("missing and unsupported demographics do not silently select a reference group", () => {
  assert.equal(referenceGroupForGender(" Female "), "female");
  assert.equal(referenceGroupForGender("MALE"), "male");
  for (const value of ["", "non-binary", "prefer not to say", "custom"]) assert.equal(referenceGroupForGender(value), null);
  for (const profile of [{ age: "", heightCm: 165 }, { age: "30", heightCm: null }, { age: "1e2", heightCm: 165 }])
    assert.equal(bodyWeightBenchmark(profile, "female", [body]).available, false);
  assert.equal(bodyWeightBenchmark({ age: "30", heightCm: 165 }, null, [body]).available, false);
  const older = { ...body, ageMin: 80, ageMax: null };
  assert.equal(bodyWeightBenchmark({ age: "85", heightCm: 165 }, "female", [older]).available, true);
});

test("strength matches only canonical barbell exercise IDs and selects the correct lift", () => {
  for (const [id, value] of [["exercise-barbell-squat", 180], ["exercise-bench-press", 120], ["exercise-deadlift", 210]] as const) {
    const result = strengthBenchmark(id, "barbell", "30", "male", 80, [lifters]);
    assert.equal(result.available && result.valueKg, value);
  }
  for (const id of ["exercise-romanian-deadlift", "exercise-dumbbell-bench-press", "custom-bench", "toString"])
    assert.equal(strengthBenchmark(id, "barbell", "30", "male", 80, [lifters]).available, false);
  assert.equal(strengthBenchmark("exercise-bench-press", "machine", "30", "male", 80, [lifters]).available, false);
  assert.equal(strengthBenchmark("exercise-bench-press", "bodyweight", "30", "male", 80, [lifters]).available, false);
});

test("strength boundaries, sparse samples and wider fallback retain matching demographics", () => {
  const lookup = (age: string, weight: number | null, rows: StrengthCohort[]) => strengthBenchmark("exercise-bench-press", "barbell", age, "male", weight, rows);
  assert.equal(lookup("39", 89.99, [lifters]).available, true);
  assert.equal(lookup("40", 85, [lifters]).available, false);
  assert.equal(lookup("30", 90, [lifters]).available, false);
  for (const weight of [null, 0, NaN, Infinity]) assert.equal(lookup("30", weight, [lifters]).available, false);
  const small = { ...lifters, count: 99 };
  const wide = { ...lifters, upper: 100, benchKg: 125 };
  const result = lookup("30", 85, [small, wide]);
  assert.equal(result.available && result.valueKg, 125);
  assert.equal(result.available && result.widerBand, true);
  assert.equal(lookup("30", 85, [small]).available, false);
  assert.equal(lookup("30", 85, [{ ...wide, group: "female" }]).available, false);
});

test("reference measurement is dated, ignores future entries and flags age over 28 days", () => {
  const entry = (date: string, weightKg = 80) => ({ id: date, date, weightKg, updatedAt: date + "T12:00:00Z" });
  const entries = [entry("2026-10-23", 500), entry("2026-09-24"), entry("2026-08-01")];
  assert.equal(benchmarkMeasurement(entries, "2026-10-22")?.weightKg, 80);
  assert.equal(benchmarkMeasurement(entries, "2026-10-22")?.stale, false);
  assert.equal(benchmarkMeasurement(entries, "2026-10-23")?.stale, false);
  assert.equal(benchmarkMeasurement(entries.slice(1), "2026-10-23")?.stale, true);
  assert.equal(benchmarkMeasurement(entries, "2026-07-01"), null);
});

test("optional chart reference changes scale in the displayed units without altering series", () => {
  const values = [80, 100, 110];
  assert.equal(chartScale(values).max, 110);
  const kg = { value: 150, label: "Competitor median" };
  assert.equal(chartScale(values, kg).max, 150);
  const lb = { ...kg, value: convertWeight(kg.value, "kg", "lb") };
  const pounds = values.map((v) => convertWeight(v, "kg", "lb"));
  assert.equal(chartScale(pounds, lb).max, convertWeight(150, "kg", "lb"));
  assert.deepEqual(values, [80, 100, 110]);
  for (const invalid of [NaN, Infinity, -5, 0]) {
    assert.equal(chartScale(values, { value: invalid, label: "invalid" }).reference, undefined);
  }
});

test("bundled tables contain aggregates, unique bands, positive unsuppressed results and no person records", () => {
  for (const table of [bodyTable, strengthTable]) {
    assert.equal(table.schemaVersion, 1);
    assert.ok(table.cohorts.length > 0);
    const keys = table.cohorts.map((row) => [row.group, row.ageMin, row.ageMax, row.lower, row.upper].join(":"));
    assert.equal(new Set(keys).size, keys.length);
    for (const row of table.cohorts) {
      assert.ok(["female", "male"].includes(row.group));
      assert.ok([10, 20].includes(row.upper - row.lower));
      assert.equal(row.lower % (row.upper - row.lower), 0);
      assert.ok(Number.isInteger(row.count) && row.count > 0);
      assert.equal("Name" in row || "SEQN" in row || "email" in row, false);
    }
  }
  for (const row of bodyTable.cohorts) {
    if (row.meanKg !== null) assert.ok(row.count >= 100 && row.effectiveCount >= 50 && row.meanKg > 0);
  }
  for (const row of strengthTable.cohorts) {
    if (row.benchKg !== null) assert.ok(row.count >= 100 && row.benchKg > 0 && row.squatKg! > 0 && row.deadliftKg! > 0);
  }
});

test("comparison lookups work offline and leave profile, measurements and training untouched", () => {
  const profile = { age: "30", gender: "female", heightCm: 165, unit: "kg" as const };
  const before = structuredClone(profile);
  const oldFetch = globalThis.fetch;
  globalThis.fetch = (() => { throw new Error("Network access is forbidden for comparisons"); }) as typeof fetch;
  try {
    assert.ok(bodyWeightBenchmark(profile, "female", [body]).available);
    assert.ok(strengthBenchmark("exercise-bench-press", "barbell", "30", "male", 85, [lifters]).available);
    assert.deepEqual(profile, before);
  } finally { globalThis.fetch = oldFetch; }
});
