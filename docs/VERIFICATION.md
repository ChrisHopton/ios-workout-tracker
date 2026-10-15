# Verification report — October 14, 2026

## Firestore implementation verification

The upload backend has changed from Google Sheets to Cloud Firestore. The complete local test run passed 193 tests with no failures; its one skipped test was the emulator suite, which passed separately with all 12 tests and no skips. Strict typecheck and Expo ESLint passed. Expo dependency compatibility checks reported all dependencies current, Expo Doctor passed 21 of 21 checks, and the production iOS JavaScript/Hermes export succeeded.

Tests cover document projection and full snapshot preservation, blank versus zero values, encoded size limits, strict private-code validation, staged installation enrollment, persisted frozen retries, exact acknowledgments, local-save rollback, Pacific-day upload budgets, owner provisioning, and private owner credentials. The Firestore emulator verified immutable installation bindings, denied reads and lists, namespace isolation, revisions, deletion tombstones, registry revocation, malformed records, and atomic batch behavior. A first emulator startup timed out; a retry passed with temporary JVM limits of two active processors and a 512 MiB maximum heap. The emulator shut down cleanly, and no repository configuration changes were needed.

The SQLite schema is version 5. Native migrations preserve a validated JSON journal in its original schema and a version-specific file before migration; Settings exposes **Export pre-migration backup** when it is available. Journal data and upload changes share a transaction. A cloud connection or upload failure must leave local recording and JSON recovery available.

Browser uploads use a local transport demo and do not contact Firebase. The current browser check created a fortnightly plan through the shared manager, verified its dated rest week, reopened the shared editor, and discarded an unsaved title without changing the saved plan. Settings saved an optional 180 lb measurement. Recording 40 lb × 12 and 80 lb × 10 then finishing the workout produced 75 lb per working set in the next-workout analytics card, along with completed-set totals, volume, personal records, and a dated relative-strength result. These checks do not verify native secure storage, iPhone networking, or physical-device behavior.

Current regression coverage adds all approved mixed-weight examples, two-workout progression/reductions, warm-up exclusions, body-weight histories/ratios, explicit recurrence/conflicts, lossless legacy schedule conversion, strict v1 import/v2 export, raw pre-migration recovery, transaction rollback and preserved frozen uploads. The emulator includes an explicit body_weight upload/denied-own-read/cross-phone-write scenario.

## Firebase project and live setup

The owner project is on the Spark plan without billing, with a default Firestore database in `us-central1`. Email/password Authentication, production rules, and indexing exemptions were deployed. The current body_weight allowlist passed emulator tests and was deployed with the same read denials. Two private phone connection codes were provisioned outside the repository and remain unbound to an installation. Final owner checks confirmed two enabled phone accounts, one human project administrator and disabled billing. No actual phone passwords/codes or owner ADC secrets were found in 115 source/export files. Real project/account identifiers, private codes, passwords, owner tokens, and private file paths are excluded from this report.

Manual Node HTTPS checks against the deployed service passed 54 assertions: 38 upload/security checks and 16 identity-lifecycle checks. Two synthetic phone identities each uploaded eight records using the same labels and local record IDs. Checks covered authentication and atomic commits, exact retries, blank/zero values, units and snapshots, owner inspection, token refresh, reused codes, revocation of an existing token, credential rotation within the same generation, and replacement with a fresh generation. Own, other-phone, unauthenticated, and unrelated record reads/lists and registry access were denied, as were cross-namespace writes, physical deletes, stale or conflicting revisions, and mixed invalid atomic batches. Both synthetic identities were disabled afterward.

These earlier Firestore checks executed the app's REST transport in Node, alongside adversarial requests and owner-only Admin SDK inspection. They preceded the new body_weight kind; its current authorization/read-denial behavior was verified in the emulator before deploying the updated rules. They did not run on an installed iPhone. No real personal history or native phone app has synced yet. The former Google Sheets deployment remains pending retirement until actual phone migration is verified.

The deployed rules deny client record reads/lists and physical deletes. The app uploads versioned records and empty-payload deletion tombstones into separate device/generation namespaces. The owner inspects records through Firebase Console. Follow [Private Firestore uploads](FIREBASE.md) for owner access, connection, revocation, rotation, and replacement-phone setup.

## Requires the owner's accounts and iPhone

No Apple sign-in, device registration, EAS cloud iOS build, or signed IPA has been completed. Follow [Install on your iPhone](INSTALL_IPHONE.md), then complete the unchecked [device checklist](DEVICE_CHECKLIST.md). The native `expo-crypto` and `expo-secure-store` dependencies require a new binary; a JavaScript-only update cannot add missing native modules.

Physical-device checks remain pending for SQLite version 5 migration and its private backup/export button, Keychain credential/token persistence, secure installation IDs, iPhone keyboards/safe areas/accessibility, Files import/share, airplane-mode recording, force-close recovery, interrupted enrollment and uploads, quota pauses, two-phone separation, revocation, and fresh-generation replacement. A JavaScript/Hermes export verifies bundling, not native compilation or a signed app.

## Historical Sheets baseline

Before the Firestore replacement, the complete Sheets implementation passed 120 automated tests, strict typecheck, and Expo ESLint. Expo Doctor passed 21 of 21 checks and dependency compatibility checks passed after adding secure storage. Its production iOS JavaScript/Hermes export and 1000-workout SQLite fixture were measured; [performance history](PERFORMANCE.md) retains those results with their original backend labels.

Earlier manual HTTPS checks validated the former Apps Script handshake, credential separation, redirect behavior, and a synthetic deletion marker. They did not verify an installed phone and do not establish current Firebase Authentication or Firestore behavior. No native app or personal workout history was uploaded by those checks.

## Earlier dependency audit

The audit captured before the former sync implementation reported 29 findings: 18 high and 11 moderate, including cascades from four upstream advisories. No critical findings were reported. These are historical results, not a refreshed audit of the Firestore dependency tree.

- [decode-uri-component](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr): runtime URL decoding through Expo Router/query-string; the available fixed decoder was incompatible with the SDK 57 CommonJS chain through a simple override.
- [braces](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm): Metro build tooling; no compatible patched release was available during that audit.
- [node-forge](https://github.com/advisories/GHSA-86w9-cpqp-85rv): Expo CLI/signing tooling; no compatible patched release was available during that audit.
- [uuid](https://github.com/advisories/GHSA-w5hq-g745-h8pq): Xcode tooling used v4 without arguments, outside the vulnerable caller pattern described by that advisory.

Recheck the final dependency tree and compatible upstream patches before distribution. Do not use `npm audit fix --force` to introduce incompatible framework downgrades. Firebase owner/setup tooling is a development workflow; administrator credentials are excluded from the mobile app.
