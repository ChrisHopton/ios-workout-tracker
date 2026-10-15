# Size and efficiency — October 14, 2026

The earlier optimization reduced JavaScript and assets by 54.6% and changed frequent saves from full-journal rewrites to changed workout records. The recommendations/plan-management release exports 3,525,545 bytes: 45,687 bytes (1.31%) above the earlier Firestore export and 190,596 bytes (5.72%) above the optimized pre-sync baseline. Current Firestore measurements are recorded separately from the historical pre-sync and Google Sheets results below.

## Production exports

Measured on Windows with the iOS production export command. The initial implementation is commit `ccf4d74`; the optimized pre-sync export includes compatible SDK 57 patch updates.

| Item | Initial implementation | Optimized pre-sync baseline | Historical Sheets export | Earlier Firestore export | Current v2 release |
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

## Current Firestore model and measurements

Firestore uses one workout header and one document per workout exercise, including its ordered recorded sets, target, suggestion, and exercise snapshot. A schedule revision has a header plus separate template snapshots. A phone rename changes its profile document. Changed records enter a coalescing outbox in the same transaction as local journal edits. Once selected, an in-flight batch remains unchanged until its exact acknowledgment; newer edits remain queued separately.

Batches contain at most 10 record documents and stay within 256 KiB after Firestore REST encoding, with metadata headroom reserved. A persisted daily attempt budget pauses uploads while retaining the local journal and queue. SQLite schema version 4 includes enrollment, queue, in-flight, revision, and budget state. The automatic private pre-migration JSON copy also occupies local file storage and should be exported for recovery.

The final fixture contains 1000 workouts with six exercises and three sets each and projects 7,038 record documents for its initial upload. The measurement uses the production storage implementation with Node's real SQLite engine in memory and a simulated acknowledgment drain; it does not send that fixture to the cloud.

| Current Firestore measurement | Result |
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

Analytics index completed dates and weeks, choose each best set in one pass, and cache summaries across muscle-group selections. Suggestions scan history once while retaining only the latest two comparable workouts. Domain tests cover ordering, units, ties, incomplete histories, and retrospective cutoffs.

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
```

Compare future runs with the current Firestore measurements above. See [verification status](VERIFICATION.md) and the [native device checklist](DEVICE_CHECKLIST.md).

## Current version 2 / SQLite 5 release

Storage measured October 14, 2026 at 9:25 p.m. America/Chicago (02:25:52 UTC October 15), Node 22.18, using the same 1000-workout / six-exercise / three-set fixture. Its canonical data includes working-set classifications and retained recommendation versions. The export column uses the final production re-export after the detached legacy-snapshot fix.

| Current measurement | Result |
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
