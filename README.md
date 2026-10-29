# Workout

A personal iPhone workout journal built with React Native, TypeScript, Expo SDK 57, Expo Router, and SQLite. Recording and analytics work offline. The iOS deployment target is 16.4. Each installation has its own journal, with automatic uploads to the owner's private Cloud Firestore database for reporting. A required device profile collects your name, date of birth, phone number, gender, and starting weight. The phone number is unverified profile information; secure automatic device authentication requires no code or password.

## Start here

For the standalone app that works with the PC switched off, follow [Install on your iPhone](docs/INSTALL_IPHONE.md). The `preview` EAS profile bundles the app for private installation on registered devices. Build a new native binary if the installed app lacks the required native modules or compatible OTA runtime; the installation guide distinguishes those paths. For owner rollout and automatic uploads, follow [Private Firestore uploads](docs/FIREBASE.md).

The Firebase setup targets Spark without billing. The app requests production App Attest verification, and the supplied rules deny all app reads, lists and physical deletes. The profile release intentionally starts existing phones fresh once, rotates their upload generation, and rejects older upload formats; see [profile reset rollout](docs/PROFILE_RESET.md). New installations use separate anonymous identities and model-based labels. Follow the owner rollout guide to verify real-phone attestation and Firestore enforcement before enabling automatic enrollment. Firestore is a reporting copy, not an app recovery service.

For local development in PowerShell:

```powershell
Set-Location 'C:\Repos\WorkoutApp'
npm ci
npm start
```

Use Node.js 24.12.0 or newer compatible 24.x LTS release. Package versions are recorded in `package-lock.json`; use `npx expo install` when changing native dependencies. The project uses generated native projects rather than checked-in `ios/` or `android/` directories.

## Using the app

- **Home:** Pick a date in the seven-day strip. One workout card shows that day's plan or recorded session, with **Start workout**, **Resume workout**, or **View workout** as appropriate. On a rest day, **Choose workout** opens a sheet of saved plans. Future dates are view-only. Use **Plans** in the header to create and edit workouts.
- **Plans:** Pick library exercises or create your own, set sets and rep ranges, reorder exercises, and assign weekdays. Each plan explicitly chooses **Weekly** or **Every 2 weeks**, with the active week shown as dates. Plans can share a weekday only on opposite fortnightly weeks. A lone fortnightly plan retains its rest week. The rotation follows calendar weeks, so missing a workout never shifts the next one. Edits apply today onward, or on the displayed pending schedule date when an import starts later. Historical schedules are preserved.
- **Recording:** Enter actual weight and reps; valid entries automatically count as completed. Bodyweight sets need reps only. Optional Warm-up/Working labels exclude warm-ups from progression and working-set analytics. Suggestions remain separate until accepted. Edits save automatically; wait for **Saved** before force-closing. **Finish workout** asks before skipping sets with missing data. Invalid entered values must be corrected or cleared, and at least one set must be completed. Historical logs retain exercise and target snapshots when plans change.
- **Analytics:** The eight-week default shows Workouts, Plan completion, one weekly chart, and up to five recent exercises with their latest recorded weight/reps. Switch to 4 or 12 weeks, or open **See all** to search and filter exercises. Tap an exercise for Weight, Reps, or Estimated max, one personal best, and expandable workout history and relative strength. **Training details** contains muscle groups and volume; **Comparisons** contains the body-weight population reference. Info controls explain calculations and sources. The optional competitor median is off by default and available only for canonical barbell squat, bench press and deadlift. Period, filters and overview scroll are retained on return. Analytics is read-only; enter body weight in Settings. See [reference sources and limitations](docs/BENCHMARK_SOURCES.md).
- **Settings:** Edit your required profile, dated body-weight measurements, pounds/kilograms and optional height. Age is calculated from date of birth. Open **Adjust weight increments** when needed. Age, gender, and height do not change weight suggestions. **Gender** offers Female or Male. Profile and measurement buttons show Saving… then ✓ Saved only after local persistence, with errors/retry beside the form. Today's quick weight entry updates the same measurement; date changes and history remain collapsed. The collapsed **Import plans and workouts** control accepts a prepared additive import file. Full-journal backup, export, and recovery controls remain hidden.
- **Uploads:** The collapsed row in Settings shows Setting up, Waiting to upload, Uploading, Up to date, or Uploads paused. Expand it for pending changes, last upload, initial-history progress, a plain-language problem and Retry when available. App/build, channel, runtime and update identifiers are included there for owner troubleshooting. Upload status is separate from local **Saved** status.

Weight suggestions use one working weight across an exercise. With mixed previous weights, completed weights/reps are adjusted toward the upper rep target and rounded down to the equipment increment. For an 8–12 target and 5 lb increments, 40 lb × 12 followed by 80 lb × 10 suggests 75 lb across working sets. An established common load stays steady while building reps. Two complete matching workouts at the upper target allow one increment more; two matching workouts missing the minimum allow one less. Skips, unfinished sets, large increments, and training gaps block progression as explained on screen. No effort rating is required. Bodyweight exercises track reps only. Suggestions are transparent heuristics; historical and in-progress sessions retain their original snapshots. Only sessions before the selected workout date inform its suggestion.

## Local data and cloud reporting

SQLite holds the journal on each phone. Automatic Firestore uploads include profile fields, dated body-weight measurements, exercises, plans, schedule revisions and template snapshots, workouts, and recorded sets. The owner can inspect them in Firebase Console. Each installation receives a unique account, namespace, and model-based label. The new profile release retires password-based upload paths. Tokens remain in device-only secure storage, separate from journal records and the app bundle.

The app is upload-only. The supplied Firestore rules deny client record reads and lists; the app does not download, merge, or restore cloud history. Uploads retry while the app is open. Pending changes and an immutable retry batch survive restart, and repeated edits coalesce into the latest pending document. Deletions upload an empty-payload tombstone with a revision. Owner revocation disables access at the server without deleting existing records. Revoked accounts cannot re-enroll. See [setup and owner management](docs/FIREBASE.md).

The local upload budget counts attempts and pauses uploads at its daily limit. Settings shows a compact status; the durable queue retains changes until retries can succeed. Recording and analytics remain local. A paused or failed cloud upload does not mean a local save failed.

A new or reinstalled app starts with an empty local journal. Connecting it does not download earlier history; prior Firestore generations remain available to the owner for external analysis. There is no in-app cloud restore or full-journal JSON backup workflow. A prepared training-only file can add plans and history locally; see [workout import](docs/WORKOUT_IMPORT.md). Install updates over the existing app to retain its local journal; uninstalling removes local app storage.

The SQLite schema is version **6** and journal/portable format is **3**. The explicit profile-release reset clears previous local history and app-managed recovery copies once, before uploads start. Existing valid anonymous authentication is retained, with new upload-generation and installation identifiers. Later restarts and ordinary updates do not repeat this reset. Older portable formats can still be parsed/upgraded without inventing missing profile fields; incomplete profiles require onboarding. No backup or recovery controls are added to the interface.

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
