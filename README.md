# Workout

A personal iPhone workout journal built with React Native, TypeScript, Expo SDK 57, Expo Router, and SQLite. Recording and analytics work offline. The iOS deployment target is 16.4. Each installation has its own journal, with optional uploads to the owner's private Cloud Firestore database for reporting. App users paste a private connection code and have no Google sign-in screen.

## Start here

For the standalone app that works with the PC switched off, follow [Install on your iPhone](docs/INSTALL_IPHONE.md). The `preview` EAS profile bundles the app for private installation on registered devices. Build a new native binary if the installed app lacks the required native modules or compatible OTA runtime; the installation guide distinguishes those paths. For optional cloud uploads, follow [Private Firestore uploads](docs/FIREBASE.md).

The Firebase project is on Spark without billing, with its default Firestore database in `us-central1`. Device authentication, restrictive rules and indexes, and two private phone codes are ready. Synthetic live tests verified uploads, denied reads, credential revocation, rotation, and replacement. Installed iPhone acceptance remains pending. Firestore holds a reporting copy for owner analysis; it is not an app recovery service.

For local development in PowerShell:

```powershell
Set-Location 'C:\Repos\WorkoutApp'
npm ci
npm start
```

Use Node.js 22.18 or a newer supported LTS release compatible with the pinned SDK. Package versions are recorded in `package-lock.json`; use `npx expo install` when changing native dependencies. The project uses generated native projects rather than checked-in `ios/` or `android/` directories.

## Using the app

- **Home:** Select a day, move between weeks, and record or resume that day's workout. The plus button opens **Workout Plans**, the shared place to create and edit plans. On a rest day, choose a saved workout manually. Future dates are view-only.
- **Plans:** Pick library exercises or create your own, set sets and rep ranges, reorder exercises, and assign weekdays. Each plan explicitly chooses **Weekly** or **Every 2 weeks**, with the active week shown as dates. Plans can share a weekday only on opposite fortnightly weeks. A lone fortnightly plan retains its rest week. The rotation follows calendar weeks, so missing a workout never shifts the next one. Edits apply today onward and preserve historical schedules.
- **Recording:** Enter actual weight and reps, then mark sets completed or skipped. Optional Warm-up/Working labels exclude warm-ups from progression and working-set analytics. Suggestions remain separate until accepted. Edits save automatically; wait for **Saved** before force-closing. **Finish Workout** requires every set to be completed or explicitly skipped. Historical logs retain exercise and target snapshots when plans change.
- **Analytics:** Review working sets by primary muscle group, workout completion, volume, body-weight history, exercise progress and personal records over 4, 8, or 12 weeks. Analytics is read-only; enter body weight in Settings. Estimated strength and body-weight ratios are approximate and show the measurement date. The **Next planned workout** card explains the suggested working weight for the first scheduled date without a finished or unfinished session, searching from today through 14 days ahead inclusive. Home still resumes existing workouts. Only finished sessions contribute. Each exercise counts toward one primary muscle group. Scheduled completion excludes future days.
- **Settings:** Set optional profile information, dated body-weight measurements, pounds/kilograms and height. Open **Adjust weight increments** when needed. Age, gender, and height do not change weight suggestions. **Database uploads** accepts a private code, phone label, and explicit consent to upload the profile and full history. Once connected, **Manage connection** reveals connection details and controls. Upload status remains separate from local **Saved** status. There are no backup, import, export, or recovery buttons.

Weight suggestions use one working weight across an exercise. With mixed previous weights, completed weights/reps are adjusted toward the upper rep target and rounded down to the equipment increment. For an 8–12 target and 5 lb increments, 40 lb × 12 followed by 80 lb × 10 suggests 75 lb across working sets. An established common load stays steady while building reps. Two complete matching workouts at the upper target allow one increment more; two matching workouts missing the minimum allow one less. Skips, unfinished sets, large increments, and training gaps block progression as explained on screen. No effort rating is required. Bodyweight exercises track reps only. Suggestions are transparent heuristics; historical and in-progress sessions retain their original snapshots. Only sessions before the selected workout date inform its suggestion.

## Local data and cloud reporting

SQLite holds the journal on each phone. Optional Firestore uploads include profile fields, dated body-weight measurements, exercises, plans, schedule revisions and template snapshots, workouts, and recorded sets. The owner can inspect them in Firebase Console. Each of the two authorized phones uses its own device identity and private code. An installation is bound to an upload generation; replacing a phone requires an owner-issued replacement code for a fresh generation. Credentials remain in native secure storage, separate from journal records and the app bundle.

The app is upload-only. The supplied Firestore rules deny client record reads and lists; the app does not download, merge, or restore cloud history. Uploads retry while the app is open. Pending changes and an immutable retry batch survive restart, and repeated edits coalesce into the latest pending document. Deletions upload an empty-payload tombstone with a revision. Disconnecting stops that installation's uploads; existing cloud data remains. Owner revocation disables access at the server. See [setup, rotation, and replacement](docs/FIREBASE.md).

The local upload budget counts attempts and pauses uploads at its daily limit. Settings shows pending records and the next automatic attempt. Recording and analytics remain local. A paused or failed cloud upload does not mean a local save failed.

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

Local journal changes and their upload changes commit in the same SQLite transaction. A database read failure aborts the save so Retry can persist the journal and upload changes together; malformed upload identities still allow local recording and can be replaced. Unchanged, validated frozen schedule history is reused during edits, and session-only saves reuse serialized metadata. Internal replacement and migration paths still validate complete data. Automated coverage includes historical snapshots, backup validation, save rollback, staged enrollment, exact retry payloads, stale acknowledgments, encoded batch bounds, and quota pauses. Browser uploads use a local demo and do not contact Firebase.

A browser preview or JavaScript export does not verify an iOS native build. Complete [the device checklist](docs/DEVICE_CHECKLIST.md) on an installed preview build before relying on it at the gym. Apple signing, EAS cloud builds, physical-device tests, and each phone's first Firebase enrollment remain separate owner steps. See [verification status](docs/VERIFICATION.md) and [performance measurements](docs/PERFORMANCE.md). Earlier backup follow-ups and verification entries describe their dated release state, not a current Settings workflow.
