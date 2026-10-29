# Verification report — October 22, 2026

## Phone attestation investigation — October 28, 2026

The primary phone reports the generic app-verification failure from the October 26 OTA update. Root cause is not established and uploads are not claimed working.

Read-only checks of the October 22 signed archive (build 00474cfc-0dd6-45d3-ada1-f19e7e2b7e3a) confirmed production App Attest in the executable, a profile permitting production, matching application identifiers, RNFBAppCheck framework inclusion, and matching bundled Firebase app/project/key and Apple team. Profile expiry is October 17, 2027. The live public app key allows the App Check API. App Attest, anonymous auth and monitoring-only mode remain configured; the enrollment gate remains closed. Aggregate App Check/service API metrics returned no series for the prior 72 hours; that absence is not a native error diagnosis.

The native adapter now converts failures to fixed diagnostic messages and codes (AT-CONFIG, AT-APP, AT-MODULE, AT-PROVIDER, AT-TOKEN, AT-EMPTY, AT-REJECTED, AT-LIMIT, AT-NETWORK, AT-TIMEOUT). Only exact allowlisted messages can reach Settings; arbitrary native messages, tokens, URLs and request data are discarded. Transport preserves these safe details during enrollment/uploads. No changes to identities, history, schema, native dependencies, retry limits, provider choice or security enforcement.

Validation: 334 application tests passed, zero failed, one emulator-only skip. Six new regressions cover native production-provider configuration, signup gating, timeout/late completion, empty tokens, safe diagnostic presentation and transport preservation. Physical phone result is still required; these mocked native tests do not establish App Attest acceptance.

## Simpler screens and upload diagnostics — October 26, 2026

Home now has one date header, a selectable week strip, one Plans entry, and one workout action. Analytics has two totals, a weekly workout chart, recent exercises and focused detail routes. Settings keeps save feedback and exposes upload diagnostics only when the Uploads row is expanded.

| Check | Result |
| --- | --- |
| Complete application suite | 328 passed, 0 failed, 1 emulator-only skip (329 total) |
| Firestore emulator | 20 passed; enrollment, read denial, cross-account isolation, revision and retry protections retained |
| TypeScript / Expo lint | Passed |
| Production iOS export | Passed; 3,278,364-byte Hermes bundle; 3,692,901 bytes complete export |
| Expo Doctor | 20/21; existing Expo, Router and Sharing patch warnings retained to avoid changing the installed native runtime |
| Runtime compatibility | Current fingerprint fb7bcde4bd5d1e33aeaf92dd7a6756200ad39d06 matches October 22 preview build 00474cfc-0dd6-45d3-ada1-f19e7e2b7e3a |
| Browser | Rest-day chooser, completed workout, recent exercise drill-down, retained 12-week period/search, optional competitor line, compact Uploads disclosure verified |
| Native acceptance | First-phone upload rollout in progress; second phone and native accessibility/keyboard acceptance remain pending |

New regressions cover typed status/retry presentation, setup interruption, single-flight retries, terminal identities, quota deadlines, immutable upload retries, preserved startup retry timing after local edits, Home action selection and recent exercise routing. The owner diagnostic performs GET-only configuration checks and prints sanitized flags; unknown enforcement is never represented as verified.

Temporary browser instrumentation confirmed one summary at baseline, no additional summaries while editing and finishing a recorded workout with Analytics hidden, and exactly one fresh summary when returning. The latest row then showed the edited 140 lb × 8 result. Instrumentation was removed before release. Synthetic browser data stays on the mock transport.

Checked narrow 320-pixel and 375-pixel layouts and 430-pixel Pro Max sizing in the browser. The narrow week strip scrolls instead of shrinking 44-point date controls. Browser checks do not establish physical iOS safe-area, VoiceOver, Dynamic Type, light-mode or native keyboard acceptance.

Live setup: the public Firebase app/project configuration matches and anonymous authentication/App Attest are configured. Automatic enrollment is still closed. At 03:21:35 UTC on October 27 (October 26 local), Firestore App Check monitoring was explicitly set to UNENFORCED because the unconfigured default collects no metrics. Enforcement, valid first-phone attestation, initial-history completion and a subsequent edit must be recorded separately before rollout is called complete. Missing earlier metrics are not proof of an app failure.

SQLite version 5, journal/backup format 2, recommendations, credential identities, revision counters, frozen batches and Firestore document contracts are unchanged.

### Published preview update

Published October 26, 2026 from commit `fe794eb434791742e48f629aff4a3ea7933cdd2e`:

- Channel/branch: `preview`; iOS runtime `fb7bcde4bd5d1e33aeaf92dd7a6756200ad39d06`.
- Update group: `3c25192d-9645-47fc-8985-fb60706a1e08`.
- iOS update: `01a17b68-9347-752f-ad0d-ef6c75be1c3d`.
- [EAS release](https://expo.dev/accounts/chrishopton/projects/workout-personal/updates/3c25192d-9645-47fc-8985-fb60706a1e08).

EAS confirmed publication and matching fingerprint. This does not confirm a phone downloaded/applied the update. The owner reported opening Workout online at about 03:20 UTC October 27. Sanitized Firestore verification metrics through 03:32 UTC contained no series; metrics can lag, so no native failure/success is inferred. Enrollment remains closed, service monitoring is UNENFORCED, and physical first-phone attestation, enforcement rejection tests, initial upload and incremental upload remain pending. No user journal or credentials were reset, and no app was uninstalled.

## Simpler Settings and personalized Analytics — October 22, 2026

This source-only release adds local save feedback, compact body-weight entry, and public aggregate comparisons. The gender selector and comparison choices offer Female and Male only. Older custom profile values are preserved until edited. No deployment, OTA publication, native rebuild or owner-cloud configuration change was performed.

| Check | Result |
| --- | --- |
| Complete application suite | 304 passed, 0 failed, 1 emulator-only skip |
| Firestore emulator | 20 passed separately; client read denial and namespace/revision protections retained |
| Benchmark generator | 11 tests passed; complete regeneration reproduced both tables byte for byte |
| TypeScript / Expo lint | Passed |
| Production iOS export | Passed; 1,386 modules, 3,236,684-byte Hermes bundle |
| Expo compatibility / Doctor | 20/21; patch mismatches: Expo 57.0.29→57.0.31, Router 57.0.27→57.0.29, Sharing 57.0.23→57.0.24 |
| Browser | Saved-state/edit reset, same-day update, persisted profile/measurement after refresh, Male/Female-only selector, population comparison, optional competitor line, profile-independent override and focus gating verified |
| Physical iPhone | Still deferred; no native keyboard, VoiceOver, Dynamic Type or app-resume acceptance claimed |

Regression coverage includes delayed and failed local flushes, repeated taps, profile re-enqueue, new backdated entry retry, and optimistic deletion followed by failed persistence/global retry/new save. Same-day measurements retain their identity, historical edits keep duplicate-date checks, and unit changes preserve canonical kilograms.

Benchmark tests cover inclusive age/exclusive size boundaries, sample/effective-count thresholds, explicit wider bands, unavailable demographics, canonical barbell variants, dated/stale measurements, unit conversion, offline lookup and optional chart scaling. Source preprocessing tests cover weighted means, effective counts, exclusions, deduplication, successful meet selection, sparse suppression, pin validation and source row integrity. No demographic benchmark is used by the workout recommendation algorithm.

The browser used synthetic local-only data. At a 430×932 viewport, the compact card and reference line were readable; at 320×740, the weight Save control wrapped below its input. Both palettes were visually inspected using a temporary theme override which was removed afterward. Saving 185 lb then 186 lb on the same date kept one History entry. A 35-year-old male profile at 5 ft 10 in displayed a 198 lb U.S. reference; the supported bench chart displayed its 287 lb competitor reference separately from the 171 lb user estimate. Changing the Analytics reference category did not alter the profile. The browser mock never uploads these fixtures.

Temporary summary instrumentation confirmed no hidden recomputation during recording and one fresh computation on returning to Analytics; details and bundle measurements are in [PERFORMANCE.md](PERFORMANCE.md). All instrumentation and theme overrides were removed. The smaller viewport/browser checks do not substitute for native safe-area or larger Dynamic Type testing.

The three Expo patch warnings remain in the existing [dependency-maintenance follow-up](DEFERRED_WORK.md); no forced or unrelated upgrades were applied. [Benchmark sources](BENCHMARK_SOURCES.md) document pinned public inputs, their limitations and offline regeneration. App Check enforcement, installed-phone upload acceptance and retirement of the former Sheet remain separate deferred rollout steps.

## Automatic private uploads and Settings — October 19, 2026

This release replaces database setup forms with automatic anonymous Firebase enrollment and a read-only disclosure/status panel. Gender uses a themed accessible selection sheet; legacy custom values stay intact until changed. Native Firebase App Check uses production App Attest only, with explicit headers on Firestore REST commits. Public app configuration is bundled; private device credentials and refresh tokens remain in device-only Keychain storage.

| Check | Result |
| --- | --- |
| Complete application suite | 282 passed, 0 failed, 1 emulator-only skip |
| Firestore emulator | 20 passed separately, including own/cross-account read denial, enrollment gate, immutable binding, revocation and atomic failures |
| TypeScript / Expo lint | Passed |
| Production iOS export | Passed; 1,377 modules, 3,614,242 bytes total; 3,199,705-byte Hermes bundle |
| Expo compatibility / Doctor | 20/21; existing Expo 57.0.29→57.0.30 and Router 57.0.27→57.0.28 patch warnings remain |
| Browser | Selector save/reload and cancel verified; final mock enrollment reaches Up to date; no code/connection controls |
| Native binary, attestation and installed phones | Blocked on owner Apple sign-in; not verified |

Regressions include persisted bootstrap before authentication, offline/interrupted setup, secure-save failures, fresh installation with stale Keychain, strict refusal to replace damaged identities, preserved legacy state/frozen uploads, terminal revoked-auth failures, refresh rotation, App Check failure/timeouts, and the complete browser mock pipeline with zero network requests. Both storage paths retain SQLite version 5 and journal format 2. A small upload_bootstrap table records pending automatic identity; no workout history or prior upload revisions are rewritten.

The owner native iOS Firebase app is registered. Its Apple team and one-hour production App Attest configuration are set; anonymous authentication is enabled, password authentication preserved, and anonymous auto-deletion disabled. Tested rules and index exemptions were deployed with automatic enrollment explicitly disabled. Firestore App Check enforcement remains unchanged until both phones demonstrate valid tokens. No real automatic enrollment, initial history upload, missing/invalid-token enforcement check, or former Google Sheets retirement is claimed.

A noninteractive EAS attempt could not refresh the ad hoc profile because no App Store Connect API key is configured. The interactive attempt found the saved Apple session expired and stopped before password entry. The owner must run the build command in [the installation guide](INSTALL_IPHONE.md), sign in directly to Apple, and include both phones. Native SDK/binary size and device attestation remain pending; an iOS JavaScript export does not establish native compilation. Install over the existing app to preserve its local journal.

A source/output marker scan found no owner private-key/ADC content; the native bundle contains neither the browser mock token nor owner ADC path. The public Firebase API key is intentionally part of the app configuration and is not an authorization secret. Dependency security maintenance remains deferred; npm reports 53 dependency findings (20 moderate, 33 high), not 53 confirmed reachable mobile vulnerabilities. Do not use forced dependency upgrades as part of this rollout.

## October 19 simplified interface

Body-weight entry is available only in Settings; Analytics retains read-only charts and suggestions. Settings no longer contains portable backup, import, export, pre-migration-copy, or restore controls. Their screen handlers and redundant explanatory panels were removed. Weight-increment inputs start collapsed. Connected upload status stays visible, with rename, replacement, and disconnect behind Manage connection.

The application suite passed 217 tests with zero failures and one emulator-only skip. TypeScript, Expo ESLint, and production iOS export passed. No upload protocol, security rules, schema, or native dependencies changed in this interface pass.

The local browser mock verified zero Analytics text inputs, zero backup/recovery controls, a saved 182.5 lb measurement in Settings reflected in Analytics, pounds/kilograms switching, collapsed increment controls, connection consent, hidden/expanded management actions, and cancellation of replacement returning to the prior connection controls. Browser uploads did not contact Firebase. Installed-phone and OTA delivery checks remain owner steps; no OTA update was published.

Existing workout records, upload state, internal migration safeguards, and versioned validation remain. Earlier sections describing Settings backup restoration or measurement drafts in Analytics refer to prior interfaces.

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
