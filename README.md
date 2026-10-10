# Workout

A personal, offline iPhone workout journal built with React Native, TypeScript, Expo SDK 57, Expo Router, and SQLite. The iOS deployment target is 16.4. Each installation has its own data; no login, cloud sync, or AI service is part of the app.

## Start here

For the standalone app that works with the PC switched off, follow [Install on your iPhone](docs/INSTALL_IPHONE.md). The provided `preview` EAS profile bundles the app for private installation on registered devices.

For local development in PowerShell:

```powershell
Set-Location 'C:\Repos\WorkoutApp'
npm ci
npm start
```

Use a supported Node.js LTS release compatible with the pinned SDK. Package versions are recorded in `package-lock.json`; use `npx expo install` when changing native dependencies. The project uses generated native projects rather than checked-in `ios/` or `android/` directories.

## Using the app

- **Home:** Select a day in the week, move between weeks, and record or resume that day's workout. The plus button opens the workout editor. On a rest day, choose a saved workout manually. Future dates are view-only.
- **Plans:** Pick library exercises or create your own, set sets and rep ranges, reorder exercises, and assign weekdays. One plan per weekday repeats weekly. Two plans on a weekday alternate A/B weeks; the schedule preview shows the order. The rotation follows calendar weeks, so missing a workout never shifts the next one. Edits apply today onward and leave historical schedules intact.
- **Recording:** Enter actual weight and reps, then mark sets completed or skipped. Suggestions are separate until accepted. Edits save automatically; wait for **Saved** before force-closing. **Finish Workout** requires every set to be completed or explicitly skipped. Historical logs retain their exercise and target snapshots when templates change.
- **Analytics:** See completed sets by primary muscle group, workout completion, and exercise history over 4, 8, or 12 weeks. Only finished sessions contribute. Each exercise counts toward one primary muscle group. Scheduled completion excludes future days.
- **Settings:** Set optional profile information, pounds/kilograms and height, and exercise increments. Age, gender, and height do not change weight suggestions. Export/restore backups here.

Weight suggestions repeat the latest comparable performance. After two consecutive qualifying sessions hit the upper rep target, the app can add one equipment increment. It suppresses increases larger than 10%, after a training gap of more than 28 days, and when set weights differ. Bodyweight exercises track reps only. Suggestions are transparent progression heuristics, not a validated prediction of strength or readiness. Sessions after a selected historical date never inform that day's suggestions.

## Data and backups

The app stores one journal per installation in local SQLite. No workout history is uploaded by app features. Exported JSON contains your profile and workout history in readable text; choose where you save or share it. A second person's phone starts with independent data.

Use **Settings > Export backup** regularly and before uninstalling, replacing the phone, or updating the app. Restore replaces the entire journal after validation and confirmation; it does not merge two journals. Invalid or unsupported backup files leave existing data intact. Version 1 backups have a 10 MiB limit. Store the backup outside the app's own storage so uninstalling cannot remove your only copy.

## Development and verification

```powershell
npm run typecheck
npm run lint
npm test
npx expo install --check
npx expo-doctor
npx expo export --platform ios
```

`src/domain` holds pure date, scheduling, recommendation, analytics, and backup logic. `src/data` holds persistent state and serialized writes. Expo Router screens live under `src/app`; non-route components remain outside it. The SQLite schema stores a versioned journal and commits complete snapshots atomically. Save errors remain visible and the latest state can be retried.

Automated tests cover domain rules, backup graph validation, and autosave ordering/recovery. A JavaScript bundle or web preview is not verification of an iOS native build. Complete [the device checklist](docs/DEVICE_CHECKLIST.md) on an installed preview build before relying on it at the gym. Apple signing, an EAS cloud build, and physical-device validation require the owner's accounts and iPhone.

See the [verification report](docs/VERIFICATION.md) for completed checks, pending iPhone validation, and dependency audit findings.
