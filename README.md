# Workout

A personal iPhone workout journal built with React Native, TypeScript, Expo SDK 57, Expo Router, and SQLite. Recording and analytics work offline. The iOS deployment target is 16.4. Each installation has its own journal, with automatic uploads to the owner's private Cloud Firestore database for reporting. There are no connection codes or sign-in screens in the app.

## Start here

For the standalone app that works with the PC switched off, follow [Install on your iPhone](docs/INSTALL_IPHONE.md). The `preview` EAS profile bundles the app for private installation on registered devices. Build a new native binary if the installed app lacks the required native modules or compatible OTA runtime; the installation guide distinguishes those paths. For owner rollout and automatic uploads, follow [Private Firestore uploads](docs/FIREBASE.md).

Firebase remains on Spark without billing. Production App Attest protects Firestore requests; all app reads, lists and physical deletes are denied. Existing connected phones keep their namespace and pending uploads. New installations receive separate anonymous identities and model-based labels. Automatic enrollment remains owner-gated until real-phone attestation is verified and Firestore enforcement is enabled. Firestore is a reporting copy, not an app recovery service.

For local development in PowerShell:

```powershell
Set-Location 'C:\Repos\WorkoutApp'
npm ci
npm start
```

Use Node.js 24.12.0 or newer compatible 24.x LTS release. Package versions are recorded in `package-lock.json`; use `npx expo install` when changing native dependencies. The project uses generated native projects rather than checked-in `ios/` or `android/` directories.

## Using the app

- **Home:** Select a day, move between weeks, and record or resume that day's workout. The plus button opens **Workout Plans**, the shared place to create and edit plans. On a rest day, choose a saved workout manually. Future dates are view-only.
- **Plans:** Pick library exercises or create your own, set sets and rep ranges, reorder exercises, and assign weekdays. Each plan explicitly chooses **Weekly** or **Every 2 weeks**, with the active week shown as dates. Plans can share a weekday only on opposite fortnightly weeks. A lone fortnightly plan retains its rest week. The rotation follows calendar weeks, so missing a workout never shifts the next one. Edits apply today onward and preserve historical schedules.
- **Recording:** Enter actual weight and reps, then mark sets completed or skipped. Optional Warm-up/Working labels exclude warm-ups from progression and working-set analytics. Suggestions remain separate until accepted. Edits save automatically; wait for **Saved** before force-closing. **Finish Workout** requires every set to be completed or explicitly skipped. Historical logs retain exercise and target snapshots when plans change.
- **Analytics:** Review working sets by primary muscle group, workout completion, volume, a compact body-weight comparison, exercise progress and personal records over 4, 8, or 12 weeks. Analytics is read-only; enter body weight in Settings. Offline CDC references match age, height and Male/Female group; optional OpenPowerlifting median lines compare the three supported barbell lifts with similar competitors. Comparison overrides do not change the saved profile. See [reference sources and limitations](docs/BENCHMARK_SOURCES.md). Estimated strength and body-weight ratios are approximate and show the measurement date. The **Next planned workout** card explains the suggested working weight for the first scheduled date without a finished or unfinished session, searching from today through 14 days ahead inclusive. Home still resumes existing workouts. Only finished sessions contribute. Each exercise counts toward one primary muscle group. Scheduled completion excludes future days.
- **Settings:** Set optional profile information, dated body-weight measurements, pounds/kilograms and height. Open **Adjust weight increments** when needed. Age, gender, and height do not change weight suggestions. **Gender** offers Female or Male and preserves existing custom values until changed. Profile and measurement buttons show Saving… then ✓ Saved only after local persistence, with errors/retry beside the form. Today’s quick weight entry updates the same measurement; date changes and history remain collapsed. **Database uploads** shows a read-only status and the automatic-upload disclosure. Upload status remains separate from local **Saved** status. There are no backup, import, export, or recovery buttons.

Weight suggestions use one working weight across an exercise. With mixed previous weights, completed weights/reps are adjusted toward the upper rep target and rounded down to the equipment increment. For an 8–12 target and 5 lb increments, 40 lb × 12 followed by 80 lb × 10 suggests 75 lb across working sets. An established common load stays steady while building reps. Two complete matching workouts at the upper target allow one increment more; two matching workouts missing the minimum allow one less. Skips, unfinished sets, large increments, and training gaps block progression as explained on screen. No effort rating is required. Bodyweight exercises track reps only. Suggestions are transparent heuristics; historical and in-progress sessions retain their original snapshots. Only sessions before the selected workout date inform its suggestion.

## Local data and cloud reporting

SQLite holds the journal on each phone. Automatic Firestore uploads include profile fields, dated body-weight measurements, exercises, plans, schedule revisions and template snapshots, workouts, and recorded sets. The owner can inspect them in Firebase Console. Each installation receives a unique account, namespace, and model-based label. Password-connected installations retain their existing namespace. Tokens remain in device-only secure storage, separate from journal records and the app bundle.

The app is upload-only. The supplied Firestore rules deny client record reads and lists; the app does not download, merge, or restore cloud history. Uploads retry while the app is open. Pending changes and an immutable retry batch survive restart, and repeated edits coalesce into the latest pending document. Deletions upload an empty-payload tombstone with a revision. Owner revocation disables access at the server without deleting existing records. Revoked accounts cannot re-enroll. See [setup and owner management](docs/FIREBASE.md).

The local upload budget counts attempts and pauses uploads at its daily limit. Settings shows a compact status; the durable queue retains changes until retries can succeed. Recording and analytics remain local. A paused or failed cloud upload does not mean a local save failed.

A new or reinstalled app starts with an empty local journal. Connecting it does not download earlier history; prior Firestore generations remain available to the owner for external analysis. There is no in-app cloud restore or JSON backup workflow. Install updates over the existing app to retain its local journal; uninstalling removes local app storage.

The SQLite schema is version **5**. Before migrating an existing native journal, the app still preserves a validated copy in its original schema in private app storage, named for the source and destination database versions. This internal safeguard has no portable 10 MiB size guard and is not exposed as a recovery button; uninstalling also removes it. Versioned validation and migration code remain in place. Earlier release notes describing JSON import/export refer to the prior interface. Compatible old schedules convert automatically; irregular ones keep an **Existing custom schedule** until you explicitly choose a new recurrence.

## Development and verification

```powershell
npm run typecheck
npm run lint
npm test
npm run test:rules
npx expo install --check
npx expo-doctor
npx expo export --platform ios
npm run measure
node --import tsx scripts/measureRecording.ts
```

The implementation is split into small modules:

- `src/domain`: dates, scheduling, recommendations, analytics, and backup validation.
- `src/data`: SQLite journal records, migrations, atomic changes, and serialized autosaves.
- `src/sync`: Firestore document projection, durable outbox and frozen batches, private credentials, authentication, and upload control.
- `firebase`: upload-only rules, index configuration, and rules tests.
- `scripts/firebaseSetup.ts`: the local owner utility for private enrollment and credential management.
- `src/app`: Expo Router screens, with non-route components outside it.

Local journal changes and their upload changes commit in the same SQLite transaction. A database read failure aborts the save so Retry can persist the journal and upload changes together; malformed upload identities still allow local recording but require owner repair; they never silently create another account. Unchanged, validated frozen schedule history is reused during edits, and session-only saves reuse serialized metadata. Internal replacement and migration paths still validate complete data. Automated coverage includes historical snapshots, backup validation, save rollback, staged enrollment, exact retry payloads, stale acknowledgments, encoded batch bounds, and quota pauses. Browser uploads use a local demo and do not contact Firebase.

A browser preview or JavaScript export does not verify an iOS native build. Complete [the device checklist](docs/DEVICE_CHECKLIST.md) on an installed preview build before relying on it at the gym. Apple signing, EAS cloud builds, physical-device tests, and each phone's first Firebase enrollment remain separate owner steps. See [verification status](docs/VERIFICATION.md) and [performance measurements](docs/PERFORMANCE.md). Earlier backup follow-ups and verification entries describe their dated release state, not a current Settings workflow.
