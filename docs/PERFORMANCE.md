# Size and efficiency — October 13, 2026

The original optimization reduced JavaScript and assets by 54.6% and changed frequent saves from full-journal rewrites to one changed workout record. Optional Sheets sync retains that storage model and adds a persistent row upload queue plus native secure storage. The measurements below separate the pre-sync baseline from the current sync fixture.

## Production export

Measured on Windows with the iOS production export command. The initial implementation is commit `ccf4d74`; the optimized pre-sync export includes compatible SDK 57 patch updates.

| Item | Initial implementation | Optimized pre-sync baseline | Final sync export |
| --- | ---: | ---: | ---: |
| Entire export | 7,351,036 bytes | 3,334,949 bytes | 3,420,953 bytes |
| Hermes bytecode | 3,248,231 bytes | 2,920,412 bytes | 3,006,416 bytes |
| Icon fonts | 19 | 1 | 1 |
| Font data | 4,076,840 bytes | 389,724 bytes | 389,724 bytes |

The final sync export adds 86,004 bytes, 2.58%, over the optimized pre-sync baseline. The final production export and measurement completed on October 13 at 17:10:06 UTC.

Ionicons is imported directly to exclude unrelated fonts and glyph maps. The obsolete build-properties plugin was replaced by SDK 57's built-in iOS deployment target. Unused SQLite full text search is disabled; its native size benefit has not been measured. Sync adds `expo-secure-store` for device credentials. Native dependency changes require a new EAS binary.

Export sizes count JavaScript and assets, not IPA download size or total installed size. The Expo/React Native runtime and native modules add to the installed app. Measure final native size and responsiveness on an installed iPhone build.

## Original storage optimization baseline

The pre-sync fixture contains 1000 workouts with six exercises and three sets each. It uses the production storage implementation with Node's real SQLite engine in memory. Twenty edits change one weight while retaining history. The original full-journal serialize/validate/write sequence was measured against the same fixture.

| Pre-sync measurement | Original full-journal writes | Optimized changed-record writes |
| --- | ---: | ---: |
| JSON passed to SQLite for 20 edits | 61,675,400 bytes | 61,340 bytes |
| Median edit validation and write time | 103.634 ms | 0.553 ms |
| Fixture backup size | 6,530,974 bytes formatted | 3,083,770 bytes compact |

The optimized pre-sync database occupied 4,145,152 bytes of SQLite pages. These historical results remain useful as the baseline; they do not include the sync tables or pending upload queue.

Saved sessions are immutable and shared across edits. Only changed sessions are validated in depth and serialized. Settings and schedule validation, duplicate detection, complete backup validation, and transaction rollback remain. Rapid edits coalesce pending saves, while each caller waits until its state is durable. Local Saved status does not mean a cloud upload has finished.

## Current storage with Sheets sync

The current 1000-workout fixture projects 25,038 rows for its first upload. Initial projection is persisted locally so it survives offline use and restart. Successful acknowledgments drain the queue while retaining row fingerprints and revision state needed to send later edits and deletions.

| Sync fixture measurement | Result |
| --- | ---: |
| SQLite pages before connecting | 4,157,440 bytes |
| Peak pages during initial upload queue | 13,987,840 bytes |
| Settled allocated pages after draining and reclamation | 5,992,448 bytes |
| Pending rows after 20 edits of the same weight | 1 |
| SQL payload for those 20 edits | 68,060 bytes |
| SQL run statements for those edits | 80 |
| Median connected edit validation/write time | 0.802 ms |

In the same final run, the disconnected changed-record path passed 61,340 bytes through 20 SQL run statements for 20 edits, with a median of 0.649 ms; the original full-journal path measured 101.333 ms. These current-run comparisons supplement the earlier pre-sync baseline above.

Repeated edits replace that row's pending projection instead of accumulating 20 uploads. When the queue drains and at least 1 MiB of SQLite pages are free, reclamation uses `VACUUM` followed by a truncated WAL checkpoint. The initial queue's peak allocation therefore does not remain as permanent database size. Reclamation is maintenance after acknowledged rows, not a prerequisite for considering the upload successful.

SQLite page counts exclude native binaries, file-system overhead, and transient WAL/journal files. JSON payload is data passed into SQL, not physical flash writes. Times are desktop Node measurements on Windows, not native-driver or iPhone performance measurements. The native app still needs testing with representative history and intermittent connectivity.

## Calculations and readability

Analytics index completed dates and weeks, choose each best set in one pass, and cache summaries across muscle-group selections. Suggestions scan history once while retaining only the latest two comparable workouts. Domain tests cover ordering, units, ties, incomplete histories, and retrospective cutoffs.

Sync projects normalized rows instead of repeatedly uploading the entire history. Journal changes and their pending row changes commit in the same SQLite transaction. The server writes visible data and permanent revisions together in one atomic Sheets request. Short TypeScript modules keep storage, projection, transport, and controller responsibilities inspectable; no additional runtime framework was introduced.

## Reproduce

Use Node.js 22.18 or a newer supported LTS version:

```powershell
npm ci
npm run typecheck
npm run lint
npm test
npx expo-doctor
npx expo install --check
npm run export:ios
npm run measure
```

The final complete test run passed 120 cases, typecheck and lint passed, and the final iOS export and SQLite measurements completed. See [verification status](VERIFICATION.md) and the [native device checklist](DEVICE_CHECKLIST.md).
