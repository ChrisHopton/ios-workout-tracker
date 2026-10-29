# Historical offline benchmark sources and regeneration

Retired October 29, 2026: comparison screens, bundled tables and their generation tools were removed from the current app. This document preserves the earlier methodology and attribution only. Regeneration commands below require the earlier source revision; they are not current setup steps.

The app bundles aggregate reference tables, not participant records. Bodyweight uses a U.S. population survey; strength uses competitive powerlifters. The strength references must never be presented as general-population averages. These comparisons describe a reference group, not a healthy target or an exercise prescription.

## Pinned inputs

The exact download URLs, byte sizes, SHA-256 hashes, expected data-row counts, and OpenPowerlifting revision are in [benchmark_sources.json](https://github.com/ChrisHopton/ios-workout-tracker/blob/da2b008/scripts/benchmark_sources.json). Inputs were retrieved on 2026-10-22.

| Input | Release / snapshot | Data rows | Compressed/source bytes |
| --- | --- | ---: | ---: |
| CDC `BMX_L.xpt` | August 2021–August 2023 | 8,860 | 1,563,200 |
| CDC `DEMO_L.xpt` | August 2021–August 2023 | 11,933 | 2,582,160 |
| OpenPowerlifting ZIP | Archive dated 2026-10-17; revision `c778256276ecda9fc5f4d1345be11a16ac8c9dc3` | 4,050,248 | 170,462,236 |

The OpenPowerlifting download index reports 4,050,249 rows and an update date of 2026-10-16. The verified archive has 4,050,248 data rows plus one CSV header. Its CSV member is `openpowerlifting-2026-10-17/openpowerlifting-2026-10-17-c7782562.csv` (828,026,785 uncompressed bytes). The generator streams this member directly without extracting it.

Authoritative documentation:

- [CDC body measures: BMX_L](https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/2021/DataFiles/BMX_L.htm)
- [CDC demographics and sample weights: DEMO_L](https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/2021/DataFiles/DEMO_L.htm)
- [NHANES sample design](https://wwwn.cdc.gov/nchs/nhanes/tutorials/SampleDesign.aspx)
- [OpenPowerlifting bulk downloads](https://openpowerlifting.gitlab.io/opl-csv/bulk-csv.html)
- [OpenPowerlifting field definitions](https://openpowerlifting.gitlab.io/opl-csv/bulk-csv-docs.html)

The public OpenPowerlifting download URL is mutable. A future download is accepted only if it still matches the pinned hash. Otherwise regeneration fails clearly; restore the original cached snapshot or deliberately review and update the manifest and methodology. The generator never silently replaces the pin with newer data.

## Regeneration

Use Python 3.11 or newer. The development environment used for the committed artifacts was Python 3.12.14 and pandas 3.0.1. pandas reads the CDC SAS XPORT files and is not an application/runtime dependency.

```sh
python -m pip install -r scripts/benchmark_requirements.txt
python -B scripts/benchmark_generate.py --cache-dir /path/outside/repository/benchmark-cache --download
python -B scripts/benchmark_generate.py --cache-dir /path/outside/repository/benchmark-cache --check
python -B -m unittest discover -s tests -p "test_benchmark_generator.py" -v
```

Run these commands from the repository root. Windows paths can be supplied in quotes. On Windows the preparation cache is outside the repository at `$env:TEMP\workoutapp-benchmark-sources`. Without `--cache-dir`, the generator uses `workoutapp-benchmark-sources` in the operating system's temporary directory. A cache inside the repository is rejected.

Every run verifies the source byte sizes and hashes before parsing, validates required columns and row counts, and enforces a one-to-one CDC participant-key join. Inputs are not modified. Names and participant IDs are used only in memory during preprocessing; the output has neither. Only the two small JSON aggregate files are shipped. Retain the verified external cache if future regeneration of this exact snapshot is needed.

`--check` repeats the calculation and compares the generated UTF-8 bytes with both committed JSON files without changing them. Outputs have stable field and cohort ordering, no generation timestamp, and a one-megabyte-per-file size guard. Source refreshes are a deliberate developer operation, not a recurring service.

## Bodyweight method

1. Join `BMX_L` to `DEMO_L` on unique, nonmissing `SEQN`. Every body-measure row must have one demographic match.
2. Include respondents aged 20 or older with positive finite measured weight (`BMXWT`), measured height (`BMXHT`), and examination sample weight (`WTMEC2YR`). Partial body-measure exams are allowed when these required fields are valid.
3. Use the released male/female `RIAGENDR` groups. Exclude reported pregnancy (`RIDEXPRG=1`). Do not treat unreported pregnancy status as confirmed nonpregnancy; the reference excludes reported pregnancy only. CDC also withholds body measures for certain pregnant participants whose pregnancy status is not publicly released.
4. Match age bands 20–39, 40–59, 60–79, or 80+. NHANES top-codes age at 80, so no finer elderly age categories are inferred.
5. Match height bands of 10 cm; a 20 cm band is an explicit fallback. Bounds are anchored at zero and half-open: `lower <= height < upper`.
6. Calculate the survey-weighted arithmetic mean `sum(weightKg * surveyWeight) / sum(surveyWeight)`. This is labeled **U.S. average (mean)** or **U.S. average**, never median.
7. Publish only when the raw cohort count is at least 100 and `sum(surveyWeight)^2 / sum(surveyWeight^2) >= 50`. Otherwise `meanKg` is null. The effective count is computed before rounding; the JSON retains it to six decimals and the mean to two decimals.

The population is U.S. civilian noninstitutionalized adults in this survey period with the required measurements, subject to the above exclusions. Do not label the result a recommended or healthy weight. No BMI-based trimming, body-composition inference, or fitted age/height model is used.

The effective count measures weight concentration only. These thresholds are conservative product safeguards, not a CDC reliability certification; they do not incorporate clustering or stratification. No confidence interval or population percentile is calculated. Any future uncertainty calculation must account for `SDMVSTRA` and `SDMVPSU` using survey methods.

## Strength method

1. Include meets from 2021-01-01 through 2025-12-31 with `Event=SBD`, `Equipment=Raw`, and `Tested=Yes`.
2. Include M/F competition categories, a positive numeric placing or guest placing `G`, positive bodyweight, positive total, and positive `Best3SquatKg`, `Best3BenchKg`, and `Best3DeadliftKg`. Exclude DQ/DD/NS and unsuccessful or incomplete results.
3. Require reported age. Match 18–29, 30–39, 40–49, 50–59, 60–69, 70–79, or 80+. An approximate age such as 29.5 can mean 29 or 30; exclude it when the two possible ages cross a band boundary. No age is inferred from a division name.
4. Keep one **latest eligible meet per lifter across the entire period**, rather than one record per appearance or a lifetime-best lift. Preserve OpenPowerlifting's full `Name`, including disambiguation suffixes. Same-date ties use the lexicographically greatest SHA-256 of the complete row serialized with sorted keys, UTF-8, and compact JSON separators; this choice is deterministic and does not prefer stronger lifts.
5. Match actual recorded meet bodyweight in 10 kg bands, with a 20 kg explicit fallback. Bounds are anchored at zero and half-open.
6. Calculate each lift's ordinary median over the same selected lifters. Publish all three medians only with at least 100 distinct lifters; otherwise all three values are null. Medians are rounded to two decimals.

The reference is **successful competitive raw powerlifters in drug-tested categories**. It is not the general population or a representative sample of recreational gym users. `Tested=Yes` indicates category eligibility, not proof that the individual was tested. Competition equipment, technique standards, weigh-ins, and selection differ from ordinary gym training. Requiring completed successful meets is another explicit selection criterion.

Use only these barbell exercise IDs: `exercise-barbell-squat`, `exercise-bench-press`, and `exercise-deadlift`. The app's estimated 1RM is an approximate comparison with measured competition results. Do not apply these medians to working-weight, repetitions, machine or dumbbell variants, front squats, Romanian deadlifts, or trap-bar deadlifts.

## JSON contract and compact UI

Both documents contain `schemaVersion: 1`, `source`, and `cohorts`. The source contains title, URL, period, and a revision for OpenPowerlifting.

Each cohort contains `group` (`female` or `male`), inclusive `ageMin`/`ageMax` (null means unbounded), exclusive upper size bound `upper`, inclusive `lower`, and unweighted `count`. The size unit is centimeters in body-weight.json and kilograms in strength.json. `upper - lower` distinguishes the 10-unit and 20-unit tables.

Bodyweight rows add `effectiveCount` and nullable `meanKg`. Strength rows add nullable `squatKg`, `benchKg`, and `deadliftKg`. Observed sparse groups remain in the output with null values. An absent group is also unavailable. Never convert unavailable values to zero.

Select the 10-unit row first, then a published 20-unit row for the same reference group and age band. Never silently drop an age, category, or height/bodyweight constraint. If neither is publishable, show “Not enough matching data.” Reference group selection should remain visible and editable; do not infer a male/female source group for other identities or claim that the source categories describe all physiology.

The accepted UI uses a compact **You / U.S. average** bodyweight card and an optional **Competitor median** line on the estimated-strength chart. Keep the selected current cohort constant across the displayed chart and expose actual cohort bounds, sample count, source period, and method in details. Existing personal-history ratio charts are unchanged.

## Attribution and reuse

**OpenPowerlifting:** This app uses data from the [OpenPowerlifting project](https://www.openpowerlifting.org). The [CSV data license](https://github.com/sstangl/openpowerlifting/blob/main/LICENSE-DATA) dedicates the data and related database rights to the public domain to the extent possible under law. Attribution is requested but not required. OpenPowerlifting's software has a separate AGPL license; this generator uses its data and independently written aggregation code.

**CDC:** Calculations by this app from CDC/NCHS NHANES public-use data, August 2021–August 2023. Source data and documentation are available free from the [CDC NHANES website](https://wwwn.cdc.gov/nchs/nhanes/). Use of these data and links does not imply endorsement of this app by CDC, NCHS, HHS, or the U.S. Government. No agency logo is used. Follow the [NHANES citation guidance](https://wwwn.cdc.gov/nchs/NHANES/NhanesCitation.aspx) and [CDC material reuse policy](https://www.cdc.gov/other/agencymaterials.html).

These attribution and non-endorsement statements also belong in the app's benchmark reference details.

## Validation and observed coverage

Generator unit tests cover weighted means, the effective-count guard, sparse suppression, exclusions, approximate-age boundaries, half-open bands, distinct-lifter selection, deterministic same-date tie handling, source checksum rejection, external-cache enforcement, and aggregate-only serialization.

The pinned sources yielded **5,929 eligible body-measure respondents** and **360,839 eligible powerlifting meet rows**, reduced to **146,370 distinct lifters**.

| Aggregate | Observed 10-unit cohorts | Published 10-unit cohorts | Observed 20-unit cohorts | Published 20-unit cohorts | UTF-8 bytes |
| --- | ---: | ---: | ---: | ---: | ---: |
| Bodyweight | 45 | 17 | 27 | 14 | 14,113 |
| Strength | 191 | 85 | 105 | 52 | 61,788 |

The combined aggregate payload is **75,901 bytes**. The two band widths reuse observations and their counts must not be added as distinct people. Coverage is deliberately incomplete: sparse groups and unobserved combinations have no comparison value.

Output SHA-256 values:

- `body-weight.json`: `de825408f71242748154ca04dd59f905875aae64f7d68684a59f084bedd91b87`
- `strength.json`: `b2955e39e5aea7e73fd5093558a3c08f8ee4bbd3f896518736bf855665e95e13`

All 11 generator unit tests pass. A second full regeneration with `--check` verified both output files byte for byte from the hash-pinned inputs. The source archive's header-inclusive published row count was independently checked against the actual CSV before generation.
