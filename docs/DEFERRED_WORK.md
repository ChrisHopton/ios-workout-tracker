# Deferred work after the October 15 cleanup

These briefs define separate follow-up tasks. The cleanup keeps SQLite schema 5, the existing Firestore protocol, atomic journal/outbox commits, historical snapshots, and immutable retry batches. It does not deploy a backend or retire the former Google Sheets resources. Installed-phone acceptance remains on the [device checklist](DEVICE_CHECKLIST.md).

## Large-history portable backups

**Problem and current boundary:** A valid local journal can exceed the 10 MiB portable JSON limit. Internal pre-migration copies now bypass that external-input guard and retain the original schema, but Settings still cannot import a recovery copy above 10 MiB. Portable v2 exports and v1/v2 imports remain bounded at 10 MiB. Removing the migration guard fixes launch lockout; it does not complete portable recovery for larger histories.

**Task:** Design and implement a recoverable portable backup path for larger local histories with an explicit supported size range and measured phone memory use. Inspect `src/domain/backup.ts`, native/web `src/data/backupIO*`, `src/data/journalStorage.ts`, and the Settings restore flow. Decide whether a measured finite larger JSON limit is sufficient for the stated range or whether bounded-memory/chunked export and import need a new format. A finite larger limit is an interim bounded improvement, not support for every journal accepted by local storage.

**Keep:** Original historical records/suggestions, supported v1/v2 imports, full structural validation, exclusion of upload credentials, explicit replacement confirmation, atomic replacement, and unchanged current data after failed or canceled restore. Preserve verified pre-migration copies and frozen uploads. Do not solve capacity by silently truncating history.

**Acceptance:** Round-trip representative histories above 10 MiB through actual iPhone Files/share flows; report peak memory, elapsed time, and maximum supported size. Cover UTF-8 byte boundaries, unsupported/malformed data, insufficient storage, canceled/interrupted operations, failed commits, and relaunch recovery. Keep native/web limits and user messages consistent. Update recovery instructions and retain an explicit limitation for any remaining unsupported sizes.

## Dependency security maintenance

**Problem and current boundary:** On October 15, compatibility checks expect `expo@57.0.30` and `expo-router@57.0.28`; the repository pins 57.0.29 and 57.0.27. Expo Doctor passes 20 of 21 checks with the mismatch visible. This cleanup leaves those versions unchanged. The [earlier audit](VERIFICATION.md#earlier-dependency-audit) is historical and does not establish the current dependency tree's security status.

**Task:** Refresh the dependency audit and dependency paths, distinguish mobile runtime exposure from owner/build/test tooling, and apply the smallest SDK-compatible fixes. Read the repository's Expo instructions and matching SDK documentation first. Use `npx expo install` for Expo-managed changes and review lockfile changes. Verify advisory reachability instead of treating the aggregate count as a runtime risk assessment.

**Keep:** SDK compatibility, native-module requirements, Firebase owner tooling separation, and current app behavior. Do not suppress compatibility warnings or use `npm audit fix --force` as a shortcut to incompatible downgrades. Avoid unrelated framework migrations and new dependencies.

**Acceptance:** Record a fresh dated audit with remaining advisories, affected dependency paths, scope, and remediation/defer rationale. Run typecheck, lint, full tests, Firestore emulator tests, Expo dependency compatibility/Doctor, and the iOS production export. Perform relevant installed-phone checks if native dependency behavior changes. Explain any residual warnings; do not label a partially passing check clean.

## Native and bundle savings

**Problem and current boundary:** The [export measurements](PERFORMANCE.md) count JavaScript/Hermes and assets, not signed IPA download size or installed Documents & Data. The current build retains one 389,724-byte Ionicons font (about 390 KB); SQLite full-text-search support is disabled, but native size savings have not been measured. The recommendation implementation still scans and sorts comparable history; the recording benchmark does not measure that work.

**Task:** Establish fresh production-export and installed-iPhone baselines before changing assets or dependencies. Inspect the bundle to find shipped contributors, then choose the smallest evidence-backed reduction. Evaluate the roughly 390 KB font and whether declared animation dependencies such as `react-native-reanimated` and `react-native-worklets` are unused by the app or required by its navigation/runtime dependencies before considering removal. Measure icon/font packaging, unused runtime code, and native feature configuration changes individually. Profile recommendation/analytics computation separately if phone measurements identify it as a remaining latency source.

**Keep:** Offline recording, visible icons, accessibility, SQLite durability, secure credential storage, cryptographic installation IDs, and cloud retry protections. Do not remove safety-critical modules or historical data to obtain a smaller number. Avoid a rendering or persistence rewrite without evidence that a narrow change is insufficient.

**Acceptance:** Report before/after byte counts for the same production target and, when a signed build is available, IPA/installed sizes and device details. Measure launch, recording with retained schedule history, and analytics on the target phone. Repeat focused functional checks plus typecheck, lint, tests, and export; run the full [device checklist](DEVICE_CHECKLIST.md) for native changes. Keep desktop and native conclusions separate.
