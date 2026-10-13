# Verification report — October 13, 2026

## Passed locally on Windows

- TypeScript strict typecheck and Expo ESLint passed for the delivered sync implementation.
- The final complete automated run passed 120 tests, including the added SQLite connection/queue-reclamation and controller failure-recovery cases. Coverage includes calendar and scheduling rules, historical snapshots, suggestions, units, analytics, backup validation, serialized writes and rollback, changed-record storage, normalized sync projection, queue coalescing and acknowledgments, connection races, secure-storage failure recovery, bounded batches, server authentication, and atomic retry behavior.
- Expo Doctor passed 21 of 21 checks and dependency compatibility checks passed after adding `expo-secure-store`.
- The final production iOS JavaScript/Hermes export succeeded after all runtime and queue-reclamation changes. This verifies bundling, not a signed IPA or native compilation.
- Browser preview at 390 × 844 checked plan editing, autosave, recording/resume, finished workout analytics, height drafts, and backup export. Browser test data is separate from native seed data.
- Browser sync checked initial connection consent, phone-label controls, status and pending-row updates, and completion with zero pending rows. This preview uses a local transport mock and does not contact Google Sheets.
- The production export and real SQLite 1000-workout fixture were measured using `npm run measure`; see [the performance report](PERFORMANCE.md). Desktop timings and mock behavior are not iPhone benchmarks or cloud integration results.

## Google setup and live endpoint checks

The owner's Apps Script project contains the server source and manifest, verified byte for byte against the repository. Owner authorization and `initializeWorkbook` completed with the spreadsheet-only OAuth scope. The Workout spreadsheet's sharing indicator is **Private to only me**. Its six visible managed tabs are protected, and `_Sync` is hidden. The unnecessary email-scoped owner lookup found during setup was removed without adding OAuth scopes.

The user approved deployment and two connection codes at the action step. The web app is deployed to execute as the owner with **Anyone** access. Two separate 256-bit device tokens and their private connection codes were generated outside the repository; only token hashes are configured on the server. This document contains no account email, project or spreadsheet ID, real endpoint, code, or private-file path.

Manual Node.js HTTPS checks, made without a Google session, confirmed successful JSON handshakes for both device credentials. Both returned HTTP 200 after following the Content Service redirect to `script.googleusercontent.com`. Combining one device ID with the other token was rejected with `ok: false` and a nonretryable error. A single synthetic connectivity-check deletion marker was written atomically to the hidden `_Sync` ledger; no visible workout records were added.

These are live server checks using manual Node fetch requests. They do not verify the production mobile transport, iPhone networking, or any physical phone. No native app or real personal workout history has been uploaded. Follow [Private Google Sheets sync](GOOGLE_SHEETS.md) for future setup and rotation, then complete the native checks below.

## Requires the owner's accounts and iPhone

No Apple sign-in, device registration, cloud iOS build, or signed IPA has been completed. Follow [Install on your iPhone](INSTALL_IPHONE.md), then complete the [device checklist](DEVICE_CHECKLIST.md). The new secure-storage dependency requires a new native EAS binary; a JavaScript-only update cannot add it to an older build.

Native SQLite and secure storage, credential persistence across restart, iPhone keyboard and safe-area behavior, accessibility sizes, light/dark appearance, Files import/share sheet, airplane-mode use, and force-close recovery require physical-device validation. Although server credentials and redirects passed the manual HTTP checks above, actual iPhone requests, native SQLite and Keychain behavior, screens, force-close recovery, two-phone separation, offline retry, real record edits/deletions, token revocation, and phone replacement remain unverified on installed phones.

## Earlier dependency audit

The dependency audit captured before sync reported 29 findings: 18 high and 11 moderate, including cascades from four upstream advisories. No critical findings were reported. These are historical audit results, not 29 independent issues or a refreshed audit of the final dependency tree.

- [decode-uri-component](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr): runtime URL decoding through Expo Router/query-string. The available fixed decoder was ESM-only and incompatible with the CommonJS function expected by the SDK 57 chain through a simple override.
- [braces](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm): Metro build tooling; no compatible patched release was available during that audit.
- [node-forge](https://github.com/advisories/GHSA-86w9-cpqp-85rv): Expo CLI/signing tooling; no compatible patched release was available during that audit.
- [uuid](https://github.com/advisories/GHSA-w5hq-g745-h8pq): Xcode project tooling used v4 without arguments, outside the vulnerable caller pattern described by that advisory. A major override was not introduced without native validation.

Recheck the final dependency tree and compatible upstream patches before distribution. Do not use `npm audit fix --force` to accept framework downgrades that break the SDK-compatible stack. Optional Sheets uploads now use the separate owner-authorized Apps Script server; EAS cloud build/signing remains a developer workflow.
