# Workout

A personal iPhone workout journal built with React Native, TypeScript, Expo SDK 57, Expo Router, and SQLite. Recording and analytics work offline. The iOS deployment target is 16.4. Each installation has its own journal, with optional uploads to a private Google Sheet for reporting. App users need no Google login; the spreadsheet owner authorizes the server once.

## Start here

For the standalone app that works with the PC switched off, follow [Install on your iPhone](docs/INSTALL_IPHONE.md). The provided `preview` EAS profile bundles the app for private installation on registered devices. This version adds native secure storage and requires a new EAS binary. For optional cloud uploads, follow [Private Google Sheets sync](docs/GOOGLE_SHEETS.md).

For local development in PowerShell:

```powershell
Set-Location 'C:\Repos\WorkoutApp'
npm ci
npm start
```

Use Node.js 22.18 or a newer supported LTS release compatible with the pinned SDK. Package versions are recorded in `package-lock.json`; use `npx expo install` when changing native dependencies. The project uses generated native projects rather than checked-in `ios/` or `android/` directories.

## Using the app

- **Home:** Select a day in the week, move between weeks, and record or resume that day's workout. The plus button opens the workout editor. On a rest day, choose a saved workout manually. Future dates are view-only.
- **Plans:** Pick library exercises or create your own, set sets and rep ranges, reorder exercises, and assign weekdays. One plan per weekday repeats weekly. Two plans on a weekday alternate A/B weeks; the schedule preview shows the order. The rotation follows calendar weeks, so missing a workout never shifts the next one. Edits apply today onward and leave historical schedules intact.
- **Recording:** Enter actual weight and reps, then mark sets completed or skipped. Suggestions are separate until accepted. Edits save automatically; wait for **Saved** before force-closing. **Finish Workout** requires every set to be completed or explicitly skipped. Historical logs retain their exercise and target snapshots when templates change.
- **Analytics:** See completed sets by primary muscle group, workout completion, and exercise history over 4, 8, or 12 weeks. Only finished sessions contribute. Each exercise counts toward one primary muscle group. Scheduled completion excludes future days.
- **Settings:** Set optional profile information, pounds/kilograms and height, and exercise increments. Age, gender, and height do not change weight suggestions. Export/restore JSON backups here. Connect Google Sheets with a private phone code and consent to upload the profile and full history; pending rows and last upload are shown separately from local Saved status.

Weight suggestions repeat the latest comparable performance. After two consecutive qualifying sessions hit the upper rep target, the app can add one equipment increment. It suppresses increases larger than 10%, after a training gap of more than 28 days, and when set weights differ. Bodyweight exercises track reps only. Suggestions are transparent progression heuristics, not a validated prediction of strength or readiness. Sessions after a selected historical date never inform that day's suggestions.

## Data and backups

The app stores one journal per installation in local SQLite. While Sheets is disconnected, new profile and workout changes remain local unless you export a backup. Connecting Sheets uploads profile fields, exercises, plans, schedule revisions, workouts, and sets to the owner's private spreadsheet. Each phone has a separate device ID and token; the owner can identify it by its editable phone label. Tokens live in native secure storage; only their hashes are configured on the server. A second person's phone retains an independent local journal.

The optional cloud copy supports reporting; the app does not download or restore records from Sheets. Keep JSON backups for recovery. Pending uploads persist locally, coalesce repeated edits to the same row, and retry while the app is open. Disconnecting stops uploads and leaves existing spreadsheet data intact; revoke a token on the server to disable it. See the [setup and rotation guide](docs/GOOGLE_SHEETS.md).

Use **Settings > Export backup** regularly and before uninstalling, replacing the phone, or updating the app. Restore replaces the entire journal after validation and confirmation; it does not merge two journals. Invalid or unsupported backup files leave existing data intact. Version 1 backups have a 10 MiB limit. Store the backup outside the app's own storage so uninstalling cannot remove your only copy.

## Development and verification

```powershell
npm run typecheck
npm run lint
npm test
npx expo install --check
npx expo-doctor
npx expo export --platform ios
npm run measure
```

The implementation is split into small modules:

- `src/domain`: pure dates, scheduling, recommendations, analytics, and backup validation.
- `src/data`: SQLite journal state, atomic changed-record writes, migration, and serialized autosaves.
- `src/sync`: normalized row projection, persistent upload queue and revisions, secure credentials, and upload control.
- `server`: deployable Apps Script authentication plus atomic Sheets row and revision writes.
- `src/app`: Expo Router screens, with non-route components kept outside it.

SQLite stores journal details and individual workout sessions separately. Saves commit only changed records in one atomic transaction. Existing journals migrate automatically, and rapid edits share pending saves without delaying the first write. Save errors remain visible and the latest state can be retried.

Automated tests cover domain rules, backup graph validation, autosave ordering/recovery, row projection, transactional sync queues, connection races, acknowledgment handling, server authentication, atomic retries, and private setup-code generation. Browser sync is a local demo and does not contact Google. A JavaScript bundle or web preview is not verification of an iOS native build. Complete [the device checklist](docs/DEVICE_CHECKLIST.md) on an installed preview build before relying on it at the gym. Apple signing, an EAS cloud build, and physical-device validation require the owner's accounts and iPhone.

See the [verification report](docs/VERIFICATION.md) for completed checks, pending iPhone validation, and dependency audit findings.

See [size and efficiency measurements](docs/PERFORMANCE.md) for reproducible bundle and storage results.
