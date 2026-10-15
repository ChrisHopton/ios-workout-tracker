# Size and efficiency — October 15, 2026

The October 15 cleanup reduces repeated validation and serialization during recording while preserving schedule history, immutable saves, and atomic journal/upload changes. The measurements below separate that cleanup from earlier export and storage baselines. The earlier optimization reduced JavaScript and assets by 54.6% and changed frequent saves from full-journal rewrites to changed workout records.

## Recording cleanup — October 15, 2026

Measured before and after the cleanup on Node.js 22.18 with in-memory SQLite. The fixture has 1,000 workouts, six exercises and three sets per workout, seven weekly plans, and the indicated number of retained schedule revisions. Each run changes one recorded weight 30 times; the first five edits warm up the code and the remaining 25 determine each median. Uploads are not connected in this benchmark.

| Retained schedule revisions | Validation before | Validation after | Journal write before | Journal write after |
| ---: | ---: | ---: | ---: | ---: |
| 100 | 65.384 ms | 0.722 ms | 3.538 ms | 0.387 ms |
| 500 | 573.080 ms | 0.935 ms | 24.983 ms | 0.417 ms |

Validation time fell by **98.9% with 100 revisions** and **99.8% with 500 revisions**, exceeding the 80% reduction target for both fixtures. With no schedule revisions, median validation changed from 1.019 ms to 0.901 ms. The improvement at larger histories comes from reusing validation of unchanged frozen schedule revisions and reusing serialized metadata on session-only saves. Changed revisions, duplicate IDs/dates, and complete imported data still receive validation; historical snapshots are retained.

Reproduce the current implementation with:

```powershell
node --import tsx scripts/measureRecording.ts
```

These are desktop JavaScript and in-memory SQLite timings. They exclude UI rendering, recommendation computation, network transport, and the native SQLite driver and physical storage. They do not establish iPhone latency or battery improvements. Complete the [device checklist](DEVICE_CHECKLIST.md) for those outcomes.

The cleanup also makes upload-state database read failures abort the transaction, preserving the journal/outbox for retry, and separates internal migration copies from the portable backup size guard. SQLite remains version 5. Neither change introduces a new database table or weakens immutable upload retries. Portable import/export remains limited to 10 MiB; an internal migration copy above that size cannot be restored through Settings yet. See the [large-history backup brief](DEFERRED_WORK.md#large-history-portable-backups).

## October 15 export and storage measurements

The final production iOS export passed with 1,336 modules. The following measurements completed at 2026-10-15T22:21:16.760Z on Windows using Node.js 22.18 and `npm run measure`.

| Export measure | October 15 cleanup |
| --- | ---: |
| Entire export | 3,528,176 bytes |
| Hermes bytecode | 3,113,639 bytes |
| Icon fonts | 1 |
| Font data | 389,724 bytes |

The export and Hermes bundle are each 2,631 bytes larger than the October 14 v2 baseline. These values count JavaScript/Hermes and assets, not signed IPA or installed size. Evaluating the remaining roughly 390 KB icon font and unused animation dependencies is a [separate follow-up](DEFERRED_WORK.md#native-and-bundle-savings).

The storage fixture contains 1,000 workouts with six exercises and three sets each, without schedule revisions or body-weight entries. It uses in-memory SQLite and simulated upload acknowledgments; it sends no fixture data to the cloud.

| Storage measure | October 15 cleanup |
| --- | ---: |
| Initial upload documents | 7,038 |
| Baseline allocated SQLite pages | 4,173,824 bytes |
| Peak initial upload allocation | 10,387,456 bytes |
| Retained allocation after upload | 4,796,416 bytes |
| Pending documents after 20 edits | 1 |
| Connected edit SQL payload / statements | 95,433 bytes / 80 |
| Connected median edit | 1.769 ms |
| Disconnected edit SQL payload / statements | 73,580 bytes / 20 |
| Disconnected median edit | 1.125 ms |
| Full-journal comparison payload / median | 73,915,740 bytes / 187.176 ms |
| Compact / formatted JSON backup | 3,695,787 / 7,514,995 bytes |

SQL payload is not physical flash-write traffic, and these desktop medians vary with machine load. The schedule-history benchmark above isolates the main recording improvement; this standard fixture does not contain that history. Native storage size, latency, and battery measurements remain pending.

## Historical production exports

These exports precede the October 15 cleanup. They were measured on Windows with the iOS production export command. The initial implementation is commit `ccf4d74`; the optimized pre-sync export includes compatible SDK 57 patch updates. The October 14 recommendations/plan-management release exported 3,525,545 bytes, 45,687 bytes (1.31%) above the earlier Firestore export and 190,596 bytes (5.72%) above the optimized pre-sync baseline. The fresh cleanup export is recorded above; see [verification status](VERIFICATION.md) for the complete checks.

| Item | Initial implementation | Optimized pre-sync baseline | Historical Sheets export | Earlier Firestore export | October 14 v2 baseline |
| --- | ---: | ---: | ---: | ---: | ---: |
| Entire export | 7,351,036 bytes | 3,334,949 bytes | 3,420,953 bytes | 3,479,858 bytes | 3,525,545 bytes |
| Hermes bytecode | 3,248,231 bytes | 2,920,412 bytes | 3,006,416 bytes | 3,065,321 bytes | 3,111,008 bytes |
| Icon fonts | 19 | 1 | 1 | 1 | 1 |
| Font data | 4,076,840 bytes | 389,724 bytes | 389,724 bytes | 389,724 bytes | 389,724 bytes |

The historical Sheets export added 86,004 bytes, 2.58%, over the pre-sync baseline. That measurement completed on October 13 at 17:10:06 UTC. It does not include the later Firestore replacement and native crypto dependency. The earlier Firestore measurement completed on October 14 at 19:05:46 UTC after the final runtime and compatible Expo patch updates.

Ionicons is imported directly to exclude unrelated fonts and glyph maps. SDK 57's built-in iOS deployment target replaces the obsolete build-properties plugin. Unused SQLite full text search is disabled; its native size benefit has not been measured. The current app uses `expo-secure-store` and `expo-crypto`; native dependency changes require a new EAS binary.

Export sizes count JavaScript and assets, not IPA download size or installed size. The Expo/React Native runtime and native modules also contribute. Measure native size and responsiveness on an installed iPhone build.

## Historical storage optimization baseline

The pre-sync fixture contains 1000 workouts with six exercises and three sets each. It uses the production storage implementation with Node's real SQLite engine in memory. Twenty edits change one weight while retaining history. The original full-journal serialize/validate/write sequence was measured against the same fixture.

| Pre-sync measurement | Original full-journal writes | Optimized changed-record writes |
| --- | ---: | ---: |
| JSON passed to SQLite for 20 edits | 61,675,400 bytes | 61,340 bytes |
| Median edit validation and write time | 103.634 ms | 0.553 ms |
| Fixture backup size | 6,530,974 bytes formatted | 3,083,770 bytes compact |

The optimized pre-sync database occupied 4,145,152 bytes of SQLite pages. These historical results exclude upload tables and pending queues.

Saved sessions are immutable and shared across edits. Only changed sessions are validated deeply and serialized. Settings/schedule validation, duplicate detection, complete backup validation, and rollback remain. Rapid edits coalesce pending saves while callers await durability. Local Saved does not confirm cloud upload.

## Historical Google Sheets sync fixture

The earlier 1000-workout Sheets fixture projected 25,038 rows for its first upload. Its queue persisted offline and drained on acknowledgment while retaining revision/key metadata.

| Historical Sheets measurement | Result |
| --- | ---: |
| SQLite pages before connecting | 4,157,440 bytes |
| Peak pages during initial upload queue | 13,987,840 bytes |
| Settled allocated pages after draining and reclamation | 5,992,448 bytes |
| Pending rows after 20 edits of the same weight | 1 |
| SQL payload for those 20 edits | 68,060 bytes |
| SQL run statements for those edits | 80 |
| Median connected edit validation/write time | 0.802 ms |

In that same historical run, disconnected changed-record saves passed 61,340 bytes through 20 SQL run statements for 20 edits, with a median of 0.649 ms; full-journal saves measured 101.333 ms. These values describe the previous backend only.

After the queue drained with at least 1 MiB of free SQLite pages, maintenance used `VACUUM` and a truncated WAL checkpoint. Page counts exclude native binaries, file-system overhead, and transient WAL/journal files. SQL JSON bytes are not physical flash-write measurements. Desktop Node timings are not native-driver or iPhone benchmarks.

## Firestore document model and earlier measurements

Firestore uses one workout header and one document per workout exercise, including its ordered recorded sets, target, suggestion, and exercise snapshot. A schedule revision has a header plus separate template snapshots. A phone rename changes its profile document. Changed records enter a coalescing outbox in the same transaction as local journal edits. Once selected, an in-flight batch remains unchanged until its exact acknowledgment; newer edits remain queued separately.

Batches contain at most 10 record documents and stay within 256 KiB after Firestore REST encoding, with metadata headroom reserved. A persisted daily attempt budget pauses uploads while retaining the local journal and queue. Enrollment, queue, in-flight, revision, and budget state were introduced in SQLite schema version 4 and remain in version 5. The automatic private pre-migration JSON copy also occupies local file storage and should be exported for recovery.

This earlier Firestore fixture contains 1000 workouts with six exercises and three sets each and projects 7,038 record documents for its initial upload. The measurement uses the production storage implementation with Node's real SQLite engine in memory and a simulated acknowledgment drain; it does not send that fixture to the cloud.

| Earlier Firestore measurement | Result |
| --- | ---: |
| SQLite pages before connecting | 4,173,824 bytes |
| Peak pages during initial upload queue | 9,519,104 bytes |
| Settled allocated pages after draining and reclamation | 4,796,416 bytes |
| Pending documents after 20 edits of the same weight | 1 |
| SQL payload for those 20 connected edits | 81,153 bytes |
| SQL run statements for those edits | 80 |
| Median connected edit validation/write time | 1.219 ms |

In the same run, disconnected changed-record saves passed 61,340 bytes through 20 SQL run statements for 20 edits, with a median of 1.253 ms. The original full-journal saves passed 61,675,400 bytes and measured 149.763 ms. The connected outbox coalesced all 20 edits into one pending document. These desktop timings vary with machine load and are not native-driver or iPhone benchmarks. Page counts and SQL payload sizes have the same limitations described for the historical fixture above.

The deployed cloud passed synthetic HTTPS security and lifecycle checks, recorded in [verification status](VERIFICATION.md). Native iPhone size, responsiveness, migration, transport, and quota/recovery behavior remain pending.

Analytics index completed dates and weeks, choose each best set in one pass, and cache summaries across muscle-group selections. The current recommendation implementation scans sessions, collects comparable history, and sorts it by date before evaluating progression. Domain tests cover ordering, units, ties, incomplete histories, and retrospective cutoffs. Recommendation computation is outside the recording benchmark above.

## Reproduce

Use Node.js 22.18 or a newer supported LTS version:

```powershell
npm ci
npm run typecheck
npm run lint
npm test
npm run test:rules
npx expo-doctor
npx expo install --check
npm run export:ios
npm run measure
node --import tsx scripts/measureRecording.ts
```

Compare like-for-like fixtures and record the implementation and runtime used for each run. The October 15 compatibility checks retain known Expo/router patch warnings; dependency updates are deferred, not suppressed. See [verification status](VERIFICATION.md), [follow-up briefs](DEFERRED_WORK.md), and the [native device checklist](DEVICE_CHECKLIST.md).

## October 14 JSON v2 / SQLite 5 baseline

Storage measured October 14, 2026 at 9:25 p.m. America/Chicago (02:25:52 UTC October 15), Node 22.18, using the same 1000-workout / six-exercise / three-set fixture. Its canonical data includes working-set classifications and retained recommendation versions. The export column uses the final production re-export after the detached legacy-snapshot fix.

| October 14 measurement | Result |
| --- | ---: |
| Initial upload documents | 7,038 |
| Baseline allocated SQLite pages | 4,173,824 bytes |
| Peak initial upload allocation | 10,387,456 bytes |
| Retained allocation after upload | 4,796,416 bytes |
| Pending documents after 20 edits | 1 |
| Connected edit SQL payload / statements | 95,433 bytes / 80 |
| Connected median edit | 3.193 ms |
| Disconnected edit SQL payload / statements | 73,580 bytes / 20 |
| Disconnected median edit | 2.412 ms |
| Full-journal comparison payload / median | 73,915,740 bytes / 179.753 ms |
| Compact / formatted JSON backup | 3,695,787 / 7,514,995 bytes |

These are desktop fixture and JavaScript/export measurements, not IPA size or iPhone performance. Body-weight measurements upload as independent documents; their add/delete behavior is verified separately. The fixture has no body-weight entries. Historical tables above retain their original data formats and measurements.
