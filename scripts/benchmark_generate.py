"""Build compact, deterministic offline benchmarks from hash-pinned public data.

Raw inputs must remain outside the repository. pandas is imported only to read
the CDC SAS XPORT files; all aggregation and OPL streaming use the standard library.
"""
from __future__ import annotations

import argparse
from collections import defaultdict
import csv
from datetime import date
import hashlib
import io
import json
import math
from pathlib import Path
import statistics
import sys
import tempfile
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = Path(__file__).with_name("benchmark_sources.json")
MIN_COUNT = 100
MIN_EFFECTIVE_COUNT = 50
BODY_AGES = ((20, 39), (40, 59), (60, 79), (80, None))
STRENGTH_AGES = ((18, 29), (30, 39), (40, 49), (50, 59),
                (60, 69), (70, 79), (80, None))
BODY_SOURCE = {
    "title": "CDC NHANES bodyweight reference",
    "url": "https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/2021/DataFiles/BMX_L.htm",
    "period": "August 2021–August 2023",
}
STRENGTH_SOURCE = {
    "title": "OpenPowerlifting competitive-lifter reference",
    "url": "https://openpowerlifting.gitlab.io/opl-csv/bulk-csv.html",
    "period": "2021–2025",
    "revision": "c778256276ecda9fc5f4d1345be11a16ac8c9dc3",
}


def number(value):
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def age_band(age, bands, approximate=False):
    age = number(age)
    if age is None:
        return None
    if approximate:
        if age % 1 not in (0, 0.5):
            return None
        low, high = math.floor(age), math.ceil(age)
    else:
        if not age.is_integer():
            return None
        low = high = int(age)
    for minimum, maximum in bands:
        if low >= minimum and (maximum is None or high <= maximum):
            return minimum, maximum
    return None


def cohort_key(group, age, value, width):
    lower = math.floor(value / width) * width
    return group, age[0], age[1], lower, lower + width


def cohort_sort_key(key):
    group, age_min, _, lower, upper = key
    return group, age_min, upper - lower, lower


def cohort_fields(key, count):
    group, age_min, age_max, lower, upper = key
    return dict(group=group, ageMin=age_min, ageMax=age_max,
                lower=lower, upper=upper, count=count)


def body_cohorts(rows):
    """rows: merged CDC dictionaries; order is canonicalized by SEQN."""
    cohorts = defaultdict(list)
    eligible = 0
    for row in sorted(rows, key=lambda item: item["SEQN"]):
        group = {1: "male", 2: "female"}.get(number(row.get("RIAGENDR")))
        age = age_band(row.get("RIDAGEYR"), BODY_AGES)
        weight = number(row.get("BMXWT"))
        height = number(row.get("BMXHT"))
        survey_weight = number(row.get("WTMEC2YR"))
        if (group is None or age is None or
                any(value is None or value <= 0 for value in
                    (weight, height, survey_weight)) or
                number(row.get("RIDEXPRG")) == 1):
            continue
        eligible += 1
        for width in (10, 20):
            cohorts[cohort_key(group, age, height, width)].append(
                (weight, survey_weight))
    output = []
    for key in sorted(cohorts, key=cohort_sort_key):
        values = cohorts[key]
        total_weight = math.fsum(weight for _, weight in values)
        squares = math.fsum(weight * weight for _, weight in values)
        effective = total_weight * total_weight / squares
        publish = len(values) >= MIN_COUNT and effective >= MIN_EFFECTIVE_COUNT
        mean = (math.fsum(value * weight for value, weight in values) /
                total_weight) if publish else None
        item = cohort_fields(key, len(values))
        item.update(effectiveCount=round(effective, 6),
                    meanKg=round(mean, 2) if mean is not None else None)
        output.append(item)
    return output, eligible


def strength_record(row):
    if (row.get("Event") != "SBD" or row.get("Equipment") != "Raw" or
            row.get("Tested") != "Yes"):
        return None
    group = {"M": "male", "F": "female"}.get(row.get("Sex"))
    name = row.get("Name", "").strip()
    age = age_band(row.get("Age"), STRENGTH_AGES, approximate=True)
    weight = number(row.get("BodyweightKg"))
    lifts = tuple(number(row.get(column)) for column in
                  ("Best3SquatKg", "Best3BenchKg", "Best3DeadliftKg"))
    total = number(row.get("TotalKg"))
    place = row.get("Place", "")
    if not (place == "G" or (place.isascii() and place.isdigit() and int(place) > 0)):
        return None
    try:
        meet_date = date.fromisoformat(row.get("Date", ""))
    except ValueError:
        return None
    if (not date(2021, 1, 1) <= meet_date <= date(2025, 12, 31) or
            not name or group is None or age is None or
            any(value is None or value <= 0 for value in (weight, total, *lifts))):
        return None
    # Name includes OPL's disambiguation suffix. One latest eligible observation
    # per identity across all categories/bands avoids frequent-competitor weighting.
    # The full row gives a stable tie-breaker for same-date meets/division duplicates.
    canonical_row = json.dumps(row, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    tie = hashlib.sha256(canonical_row.encode("utf-8")).hexdigest()
    return name, (meet_date.isoformat(), tie), group, age, weight, lifts


def strength_cohorts(rows, progress=None):
    latest = {}
    input_rows = eligible = 0
    for row in rows:
        input_rows += 1
        if progress is not None and input_rows % 1_000_000 == 0:
            progress(input_rows)
        record = strength_record(row)
        if record is None:
            continue
        eligible += 1
        name, rank, *_ = record
        if name not in latest or rank > latest[name][1]:
            latest[name] = record
    cohorts = defaultdict(list)
    for name in sorted(latest):
        _, _, group, age, weight, lifts = latest[name]
        for width in (10, 20):
            cohorts[cohort_key(group, age, weight, width)].append(lifts)
    output = []
    for key in sorted(cohorts, key=cohort_sort_key):
        values = cohorts[key]
        item = cohort_fields(key, len(values))
        for index, field in enumerate(("squatKg", "benchKg", "deadliftKg")):
            item[field] = (round(statistics.median(v[index] for v in values), 2)
                           if len(values) >= MIN_COUNT else None)
        output.append(item)
    return output, dict(inputRows=input_rows, eligibleMeetRows=eligible,
                        distinctLifters=len(latest))


def verify_file(path, specification):
    if path.stat().st_size != specification["bytes"]:
        raise ValueError(f"Size mismatch for {path.name}; pinned inputs were not changed.")
    with path.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    if digest != specification["sha256"]:
        raise ValueError(f"SHA-256 mismatch for {path.name}; do not silently repin inputs.")


def require_external_cache(cache):
    cache = cache.resolve()
    if cache == ROOT or ROOT in cache.parents:
        raise ValueError("Raw-source cache must be outside the repository.")
    return cache


def ensure_source(cache, specification, download=False):
    path = cache / specification["filename"]
    if not path.exists():
        if not download:
            raise FileNotFoundError(f"{path} is missing. Use --download or restore the pinned cache.")
        cache.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(path.suffix + ".download")
        try:
            request = urllib.request.Request(
                specification["url"], headers={"User-Agent": "WorkoutApp benchmark generator/1"})
            with urllib.request.urlopen(request, timeout=120) as response, temporary.open("wb") as stream:
                while block := response.read(1024 * 1024):
                    stream.write(block)
            verify_file(temporary, specification)
            temporary.replace(path)
        finally:
            temporary.unlink(missing_ok=True)
    verify_file(path, specification)
    return path


def read_nhanes(body_path, demo_path, manifest):
    try:
        import pandas as pd
    except ImportError as error:
        raise RuntimeError("Install scripts/benchmark_requirements.txt for the developer-only XPT reader.") from error
    body = pd.read_sas(body_path, format="xport")
    demo = pd.read_sas(demo_path, format="xport")
    body_columns = ["SEQN", "BMXWT", "BMXHT"]
    demo_columns = ["SEQN", "RIAGENDR", "RIDAGEYR", "RIDEXPRG", "WTMEC2YR"]
    for frame, columns, source in ((body, body_columns, "nhanesBody"),
                                    (demo, demo_columns, "nhanesDemographics")):
        if not set(columns).issubset(frame.columns):
            raise ValueError(f"{source}: required columns missing.")
        if len(frame) != manifest["sources"][source]["expectedRows"]:
            raise ValueError(f"{source}: unexpected row count.")
        if frame.SEQN.isna().any() or not frame.SEQN.is_unique:
            raise ValueError(f"{source}: participant keys must be present and unique.")
    merged = body[body_columns].merge(
        demo[demo_columns], on="SEQN", how="left", validate="one_to_one", indicator=True)
    if not merged["_merge"].eq("both").all():
        raise ValueError("Every body-measure row must have one matching demographic row.")
    return merged.to_dict("records")


def render_document(source, cohorts):
    return json.dumps(dict(schemaVersion=1, source=source, cohorts=cohorts),
                      ensure_ascii=False, allow_nan=False, indent=2) + "\n"


def coverage(cohorts, value_field):
    return {
        str(width): {
            "cohorts": sum(row["upper"] - row["lower"] == width for row in cohorts),
            "published": sum(row["upper"] - row["lower"] == width and
                             row[value_field] is not None for row in cohorts),
        } for width in (10, 20)
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache-dir", type=Path,
                        default=Path(tempfile.gettempdir()) / "workoutapp-benchmark-sources")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "src/data/benchmarks")
    parser.add_argument("--download", action="store_true", help="Download missing hash-pinned inputs.")
    parser.add_argument("--check", action="store_true", help="Verify generated bytes without modifying files.")
    args = parser.parse_args(argv)
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    cache = require_external_cache(args.cache_dir)
    paths = {name: ensure_source(cache, spec, args.download)
             for name, spec in manifest["sources"].items()}
    body_rows = read_nhanes(paths["nhanesBody"], paths["nhanesDemographics"], manifest)
    body, eligible_body = body_cohorts(body_rows)
    spec = manifest["sources"]["openPowerlifting"]
    with zipfile.ZipFile(paths["openPowerlifting"]) as archive:
        if spec["csvMember"] not in archive.namelist():
            raise ValueError("Pinned OpenPowerlifting CSV member is missing.")
        with archive.open(spec["csvMember"]) as stream:
            reader = csv.DictReader(io.TextIOWrapper(stream, encoding="utf-8", newline=""))
            required = {"Name", "Sex", "Event", "Equipment", "Tested", "Age", "BodyweightKg",
                        "Best3SquatKg", "Best3BenchKg", "Best3DeadliftKg", "TotalKg", "Place", "Date"}
            if not required.issubset(reader.fieldnames or []):
                raise ValueError("OpenPowerlifting schema changed.")
            strength, strength_summary = strength_cohorts(
                reader, lambda count: print(f"Read {count:,} competition rows", file=sys.stderr, flush=True))
    if strength_summary["inputRows"] != spec["expectedRows"]:
        raise ValueError(f"OpenPowerlifting row count {strength_summary['inputRows']} != {spec['expectedRows']}.")
    documents = {
        "body-weight.json": render_document(BODY_SOURCE, body),
        "strength.json": render_document({**STRENGTH_SOURCE, "revision": spec["revision"]}, strength),
    }
    sizes = {}
    for name, content in documents.items():
        encoded = content.encode("utf-8")
        if len(encoded) > 1_000_000:
            raise ValueError(f"{name} exceeded the 1 MB aggregate budget.")
        path = args.output_dir / name
        if args.check:
            if not path.exists() or path.read_bytes() != encoded:
                raise ValueError(f"{name} is stale; regenerate from the pinned inputs.")
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(encoded)
        sizes[name] = dict(bytes=len(encoded), sha256=hashlib.sha256(encoded).hexdigest())
    print(json.dumps(dict(
        verified=args.check, eligibleBodyRespondents=eligible_body,
        bodyCoverage=coverage(body, "meanKg"), strength=strength_summary,
        strengthCoverage=coverage(strength, "squatKg"), outputs=sizes), indent=2))


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, RuntimeError) as error:
        print(f"Benchmark generation failed: {error}", file=sys.stderr)
        sys.exit(1)
