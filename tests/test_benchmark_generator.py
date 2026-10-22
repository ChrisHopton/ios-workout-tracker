"""Generator tests use synthetic records, never downloaded participant microdata."""
import importlib.util
from pathlib import Path
import tempfile
import unittest

MODULE = Path(__file__).resolve().parents[1] / "scripts/benchmark_generate.py"
SPEC = importlib.util.spec_from_file_location("benchmark_generate", MODULE)
generator = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(generator)


def body_row(index, **changes):
    row = dict(SEQN=index, RIAGENDR=1, RIDAGEYR=30, BMXWT=80,
               BMXHT=175, WTMEC2YR=1, RIDEXPRG=float("nan"))
    row.update(changes)
    return row


def strength_row(name, **changes):
    row = dict(Name=name, Sex="M", Age="30", BodyweightKg="80",
               Event="SBD", Equipment="Raw", Tested="Yes", Place="1",
               Best3SquatKg="100", Best3BenchKg="80", Best3DeadliftKg="150",
               TotalKg="330", Date="2023-01-01", Federation="TEST")
    row.update(changes)
    return row


class BenchmarkTests(unittest.TestCase):
    def test_approximate_age_cannot_cross_boundary(self):
        self.assertIsNone(generator.age_band(29.5, generator.STRENGTH_AGES, True))
        self.assertEqual(generator.age_band(30.5, generator.STRENGTH_AGES, True), (30, 39))
        self.assertEqual(generator.age_band(80, generator.BODY_AGES), (80, None))
        self.assertIsNone(generator.age_band(19, generator.BODY_AGES))

    def test_half_open_bands(self):
        self.assertEqual(generator.cohort_key("male", (30, 39), 80, 10)[3:], (80, 90))
        self.assertEqual(generator.cohort_key("male", (30, 39), 79.99, 10)[3:], (70, 80))

    def test_body_uses_survey_weights_not_unweighted_mean(self):
        rows = ([body_row(i, BMXWT=60, WTMEC2YR=1) for i in range(50)] +
                [body_row(i + 50, BMXWT=100, WTMEC2YR=3) for i in range(50)])
        cohorts, eligible = generator.body_cohorts(rows)
        self.assertEqual(eligible, 100)
        self.assertEqual(len(cohorts), 2)
        self.assertEqual(cohorts[0]["meanKg"], 90)
        self.assertEqual(cohorts[0]["effectiveCount"], 80)

    def test_body_suppresses_small_and_concentrated_samples(self):
        small, _ = generator.body_cohorts([body_row(i) for i in range(99)])
        concentrated, _ = generator.body_cohorts(
            [body_row(i, WTMEC2YR=1000 if i == 0 else 1) for i in range(100)])
        self.assertTrue(all(row["meanKg"] is None for row in small + concentrated))

    def test_body_exclusions_and_order_independence(self):
        valid = [body_row(i) for i in range(100)]
        invalid = [body_row(101, RIDEXPRG=1), body_row(102, BMXHT=float("nan")),
                   body_row(103, WTMEC2YR=0), body_row(104, RIAGENDR=3)]
        first, eligible = generator.body_cohorts(valid + invalid)
        second, _ = generator.body_cohorts(list(reversed(valid + invalid)))
        self.assertEqual(eligible, 100)
        self.assertEqual(first, second)

    def test_latest_eligible_meet_is_one_observation_per_lifter(self):
        rows = [strength_row("A", Date="2021-01-01", Best3SquatKg="200"),
                strength_row("A", Date="2025-01-01", BodyweightKg="90"),
                strength_row("A", Date="2025-02-01", Place="DQ"),
                strength_row("A #1")]
        cohorts, summary = generator.strength_cohorts(rows)
        self.assertEqual(summary["eligibleMeetRows"], 3)
        self.assertEqual(summary["distinctLifters"], 2)
        self.assertEqual(sum(row["count"] for row in cohorts
                             if row["upper"] - row["lower"] == 10), 2)
        self.assertTrue(any(row["lower"] == 90 for row in cohorts))

    def test_strength_exclusions(self):
        variations = [dict(Equipment="Wraps"), dict(Tested=""), dict(Event="B"),
                      dict(Date="2026-01-01"), dict(Place="DD"), dict(Place="NS"),
                      dict(Best3BenchKg="-80"), dict(Age="29.5"),
                      dict(BodyweightKg="nan"), dict(Sex="Mx"), dict(TotalKg="")]
        for changes in variations:
            with self.subTest(changes=changes):
                self.assertIsNone(generator.strength_record(strength_row("A", **changes)))
        self.assertIsNotNone(generator.strength_record(strength_row("A", Place="G")))

    def test_median_threshold_and_deterministic_ties(self):
        rows = [strength_row(str(i), Best3SquatKg=str(100 + i)) for i in range(100)]
        first, _ = generator.strength_cohorts(rows)
        self.assertEqual(first[0]["squatKg"], 149.5)
        self.assertEqual(first[0]["count"], 100)
        sparse, _ = generator.strength_cohorts(rows[:99])
        self.assertIsNone(sparse[0]["squatKg"])
        tied = rows + [strength_row("0", Best3SquatKg="190")]
        forward, _ = generator.strength_cohorts(tied)
        reverse, _ = generator.strength_cohorts(list(reversed(tied)))
        self.assertEqual(forward, reverse)

    def test_hash_verification_rejects_wrong_bytes(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "source"
            path.write_bytes(b"abc")
            spec = dict(bytes=3, sha256="ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
            generator.verify_file(path, spec)
            path.write_bytes(b"abd")
            with self.assertRaises(ValueError):
                generator.verify_file(path, spec)

    def test_cache_cannot_be_inside_repository(self):
        with self.assertRaises(ValueError):
            generator.require_external_cache(generator.ROOT / "raw-data")

    def test_serialization_is_stable_and_has_no_person_fields(self):
        cohorts, _ = generator.body_cohorts([body_row(i) for i in range(100)])
        document = generator.render_document(generator.BODY_SOURCE, cohorts)
        self.assertNotIn("SEQN", document)
        self.assertNotIn("Name", document)
        self.assertEqual(document, generator.render_document(generator.BODY_SOURCE, cohorts))


if __name__ == "__main__":
    unittest.main()
