# Verification report — October 10, 2026

## Passed locally on Windows

- TypeScript strict typecheck and Expo ESLint.
- 40 automated tests: calendar/DST/year boundaries, weekly/A/B schedules, historic revisions, session snapshots, suggestions, units, analytics, backup validation, serialized writes, restore rollback/retry, and failed database-open recovery.
- Expo Doctor: 21 of 21 checks passed. Expo dependency versions are compatible and pinned.
- Production iOS JavaScript/Hermes bundle exported successfully. This is not a signed IPA or native compilation.
- Browser preview at 390 × 844: create library-based workout, change set count, save schedule, record weight/reps, complete a set, reopen/resume with values intact, finish workout, verify analytics totals, preserve height draft through unit changes, and export JSON.
- Browser preview uses separate browser storage. The test plan named “QA · Lower body” is not included in the native app or seed data.

## Requires the owner's accounts and iPhone

Expo CLI is not signed in on this machine. No cloud build, Apple sign-in, UDID registration, paid enrollment, or signed IPA has been created. Follow [Install on your iPhone](INSTALL_IPHONE.md), then complete the [device checklist](DEVICE_CHECKLIST.md).

Native SQLite runtime, iPhone keyboard/safe-area behavior, accessibility text sizes, light/dark appearance, Files import/share sheet, airplane-mode use and force-close recovery require physical-device validation. The browser checks do not establish these native behaviors.

## Dependency audit

`npm audit` reports 29 findings (18 high, 11 moderate), including cascades from four upstream dependency advisories. No critical findings were reported. These are not 29 independent issues.

- [decode-uri-component](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr): runtime URL decoding through Expo Router/query-string. A malicious malformed URL can cause excessive work. The fixed decoder is ESM-only and cannot safely replace the CommonJS function expected by the SDK57 chain through a simple override. No compatible Router57 patch was available during verification.
- [braces](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm): Metro build tooling; no patched upstream release available during verification.
- [node-forge](https://github.com/advisories/GHSA-86w9-cpqp-85rv): Expo CLI/signing tooling; no patched upstream release available during verification.
- [uuid](https://github.com/advisories/GHSA-w5hq-g745-h8pq): Xcode project tooling uses only v4 without arguments, outside the vulnerable caller pattern described by this advisory. A major-version override was not introduced without a native build validation environment.

Do not use `npm audit fix --force`: its suggested framework downgrades break the SDK-compatible stack. Recheck compatible upstream patches before creating a distributed build. The app has no backend and does not upload its workout data; cloud build/signing is a separate developer workflow.

