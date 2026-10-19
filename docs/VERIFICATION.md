# Verification report — October 19, 2026

## October 19 iPhone layout correction

The Home create-plan button now uses a centered 28-point icon inside a 44-by-44 touch target instead of a padded 54-point control. Bottom tabs use the navigator's standard bar height and safe-area padding, with standard-sized labels protected from text shrinkage. Home, Analytics, and Settings no longer add the bottom safe-area inset a second time; editor and recording screens retain their own bottom protection.

TypeScript, Expo ESLint, the final tab-layout lint check, and production iOS export passed. Browser checks at 393-by-852, 430-by-932, and 440-by-956 verified the create button stays within the viewport and opens Workout Plans, all three bottom tabs remain anchored to the viewport bottom, and the plan editor opens and cancels normally. The final preview confirmed complete tab labels after disabling label shrinkage.

Browser viewport checks do not emulate native iOS headers, Dynamic Island, or home-indicator insets. Verify the reported clipping and spacing on the installed Pro Max using the updated device checklist. This pass did not publish an OTA update or perform physical-phone acceptance.

## October 15 cleanup verification

This pass changes local validation, recording behavior, migration handling, and upload-state error handling. SQLite remains version 5. No backend deployment, live phone enrollment, or former Google Sheets retirement is included in this pass. Earlier cloud and export results are preserved below with their dates; they are not fresh verification of this cleanup.

| Check | October 15 result |
| --- | --- |
| TypeScript typecheck | Passed |
| Expo ESLint | Passed |
| Full automated test suite | 217 passed, 0 failed, 1 emulator-only skip |
| Firestore emulator suite | 12 of 12 passed separately |
| Production iOS JavaScript/Hermes export | Passed; 1,336 modules, 3,528,176-byte export, 3,113,639-byte Hermes bundle |
| Browser checks | Analytics focus, recomputation, and retained screen state passed |
| Expo dependency compatibility / Doctor | Known patch-version warning; Doctor passed 20 of 21 checks |
| Recording benchmark | Completed on Node.js 22.18 with in-memory SQLite; see [measurements](PERFORMANCE.md#recording-cleanup--october-15-2026) |
| Signed iOS build / installed-phone acceptance | Not performed |

The compatibility checks report installed `expo@57.0.29` versus expected `57.0.30`, and installed `expo-router@57.0.27` versus expected `57.0.28`. Those version updates are explicitly deferred to [dependency maintenance](DEFERRED_WORK.md#dependency-security-maintenance). Warnings remain visible; the check is not reported as fully passing.

The browser focus check used temporary summary-call instrumentation, removed afterward. Opening Analytics and choosing the four-week range produced two summary calls. While Analytics was hidden, recording 85 lb and 11 reps, completing the set, and finishing the workout left the count at two. Returning to Analytics produced one fresh summary: volume changed from 1,280 to 1,415, the personal-record result from 80 lb × 10 to 85 lb × 11, and the suggestion from 75 lb to 80 lb. The four-week and Arms filters, the 181.5 measurement draft, and the 1,484.5 px scroll position were retained. This establishes browser behavior, not native navigation, app-resume, or midnight behavior; those phone checks remain pending.

Upload-state regression coverage includes an injected database read failure followed by retrying the same snapshot, unchanged current/staged identities and frozen batches after enrollment read failures, retryable disconnect/rename/batch/acknowledgment operations, and continued local recording with malformed identities followed by replacement-generation enrollment. Strict state reads still report malformed identities.

Additional regressions cover failed connection replacement preserving prior credentials, retry deadlines/backoff, quota pauses, and frozen uploads; failure to restore credentials securely stops uploads. Large-journal migration tests cover both `app_state` and `journal_meta` above 10 MiB, including recovery-copy write failures and commit failures. Next-planned-workout tests skip dates occupied by matching or different plans, cover finished and unfinished sessions, and include the date exactly 14 days ahead.

The cleanup reuses validated frozen schedule revisions and unchanged serialized metadata during recording. Full import validation, uniqueness checks, immutable snapshots, transaction rollback, and exact in-flight retries remain. Internal migration copies no longer use the portable 10 MiB guard. **Portable v2 exports and v1/v2 Settings imports still have a 10 MiB limit, and an internal recovery copy above 10 MiB cannot currently be restored through Settings.** Larger portable recovery is a [separate follow-up](DEFERRED_WORK.md#large-history-portable-backups).

## Historical Firestore implementation verification — October 14, 2026

At this checkpoint the upload backend had changed from Google Sheets to Cloud Firestore. The complete local test run passed 193 tests with no failures; its one skipped test was the emulator suite, which passed separately with all 12 tests and no skips. Strict typecheck and Expo ESLint passed. Expo dependency compatibility checks reported all dependencies current, Expo Doctor passed 21 of 21 checks, and the production iOS JavaScript/Hermes export succeeded.

Tests cover document projection and full snapshot preservation, blank versus zero values, encoded size limits, strict private-code validation, staged installation enrollment, persisted frozen retries, exact acknowledgments, local-save rollback, Pacific-day upload budgets, owner provisioning, and private owner credentials. The Firestore emulator verified immutable installation bindings, denied reads and lists, namespace isolation, revisions, deletion tombstones, registry revocation, malformed records, and atomic batch behavior. A first emulator startup timed out; a retry passed with temporary JVM limits of two active processors and a 512 MiB maximum heap. The emulator shut down cleanly, and no repository configuration changes were needed.

The SQLite schema is version 5. Native migrations preserve a validated JSON journal in its original schema and a version-specific file before migration; Settings exposes **Export pre-migration backup** when it is available. Journal data and upload changes share a transaction. A cloud connection or upload failure must leave local recording and JSON recovery available.

Browser uploads use a local transport demo and do not contact Firebase. The October 14 browser check created a fortnightly plan through the shared manager, verified its dated rest week, reopened the shared editor, and discarded an unsaved title without changing the saved plan. Settings saved an optional 180 lb measurement. Recording 40 lb × 12 and 80 lb × 10 then finishing the workout produced 75 lb per working set in the next-workout analytics card, along with completed-set totals, volume, personal records, and a dated relative-strength result. These checks do not verify native secure storage, iPhone networking, or physical-device behavior.

The October 14 regression coverage added all approved mixed-weight examples, two-workout progression/reductions, warm-up exclusions, body-weight histories/ratios, explicit recurrence/conflicts, lossless legacy schedule conversion, strict v1 import/v2 export, raw pre-migration recovery, transaction rollback and preserved frozen uploads. The emulator includes an explicit body_weight upload/denied-own-read/cross-phone-write scenario.

## Historical Firebase project and live setup — October 14, 2026

At that checkpoint the owner project was on the Spark plan without billing, with a default Firestore database in `us-central1`. Email/password Authentication, production rules, and indexing exemptions were deployed. The body_weight allowlist passed emulator tests and was deployed with the same read denials. Two private phone connection codes were provisioned outside the repository and remain unbound to an installation. Final owner checks confirmed two enabled phone accounts, one human project administrator and disabled billing. No actual phone passwords/codes or owner ADC secrets were found in 115 source/export files. Real project/account identifiers, private codes, passwords, owner tokens, and private file paths are excluded from this report.

Manual Node HTTPS checks against the deployed service passed 54 assertions: 38 upload/security checks and 16 identity-lifecycle checks. Two synthetic phone identities each uploaded eight records using the same labels and local record IDs. Checks covered authentication and atomic commits, exact retries, blank/zero values, units and snapshots, owner inspection, token refresh, reused codes, revocation of an existing token, credential rotation within the same generation, and replacement with a fresh generation. Own, other-phone, unauthenticated, and unrelated record reads/lists and registry access were denied, as were cross-namespace writes, physical deletes, stale or conflicting revisions, and mixed invalid atomic batches. Both synthetic identities were disabled afterward.

These earlier Firestore checks executed the app's REST transport in Node, alongside adversarial requests and owner-only Admin SDK inspection. They preceded the new body_weight kind; its authorization/read-denial behavior was verified in the emulator before deploying the updated rules. They did not run on an installed iPhone. No real personal history or native phone app has synced yet. The former Google Sheets deployment remains pending retirement until actual phone migration is verified.

The deployed rules deny client record reads/lists and physical deletes. The app uploads versioned records and empty-payload deletion tombstones into separate device/generation namespaces. The owner inspects records through Firebase Console. Follow [Private Firestore uploads](FIREBASE.md) for owner access, connection, revocation, rotation, and replacement-phone setup.

## Requires the owner's accounts and iPhone

No Apple sign-in, device registration, EAS cloud iOS build, or signed IPA has been completed. Follow [Install on your iPhone](INSTALL_IPHONE.md), then complete the unchecked [device checklist](DEVICE_CHECKLIST.md). The native `expo-crypto` and `expo-secure-store` dependencies require a new binary; a JavaScript-only update cannot add missing native modules.

Physical-device checks remain pending for SQLite version 5 migration and its private backup/export button, Keychain credential/token persistence, secure installation IDs, iPhone keyboards/safe areas/accessibility, Files import/share, airplane-mode recording, force-close recovery, interrupted enrollment and uploads, quota pauses, two-phone separation, revocation, and fresh-generation replacement. A JavaScript/Hermes export verifies bundling, not native compilation or a signed app.

## Historical Sheets baseline

Before the Firestore replacement, the complete Sheets implementation passed 120 automated tests, strict typecheck, and Expo ESLint. Expo Doctor passed 21 of 21 checks and dependency compatibility checks passed after adding secure storage. Its production iOS JavaScript/Hermes export and 1000-workout SQLite fixture were measured; [performance history](PERFORMANCE.md) retains those results with their original backend labels.

Earlier manual HTTPS checks validated the former Apps Script handshake, credential separation, redirect behavior, and a synthetic deletion marker. They did not verify an installed phone and do not establish current Firebase Authentication or Firestore behavior. No native app or personal workout history was uploaded by those checks.

## Earlier dependency audit

The audit captured before the former sync implementation reported 29 findings: 18 high and 11 moderate, including cascades from four upstream advisories. No critical findings were reported. These are historical results, not a refreshed audit of the Firestore dependency tree.

- [decode-uri-component](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr): historical dependency path through Expo Router/query-string. That dependency path does not establish runtime reachability; the cleanup review found installed Router 57 URL handling using `URLSearchParams`. Reassess the exact advisory path and compatible remediation in the dependency-maintenance task.
- [braces](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm): Metro build tooling; no compatible patched release was available during that audit.
- [node-forge](https://github.com/advisories/GHSA-86w9-cpqp-85rv): Expo CLI/signing tooling; no compatible patched release was available during that audit.
- [uuid](https://github.com/advisories/GHSA-w5hq-g745-h8pq): Xcode tooling used v4 without arguments, outside the vulnerable caller pattern described by that advisory.

Recheck the final dependency tree and compatible upstream patches before distribution using the [dependency maintenance brief](DEFERRED_WORK.md#dependency-security-maintenance). This cleanup did not refresh or resolve that audit. Do not use `npm audit fix --force` to introduce incompatible framework downgrades. Firebase owner/setup tooling is a development workflow; administrator credentials are excluded from the mobile app.
