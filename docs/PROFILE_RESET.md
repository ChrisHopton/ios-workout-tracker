# Required device profile release

This release removes recording checkboxes and introduces a required device profile. It is an explicitly approved fresh start: old profiles, measurements, custom exercises, plans and history are removed locally and in cloud reporting. Built-in exercise definitions are restored. There is no SMS verification, password, portable login, or cloud download. A phone number is unverified metadata; each installation remains isolated by Firebase Auth and production App Check.

## Phone behavior

Pause recording until the new profile screen appears. Install updates over the existing app; do not uninstall. First enter your phone number/country code, then first name, last name, date of birth, Male/Female and starting weight in pounds. Save profile commits the profile and today's measurement locally before opening Home. Offline setup works; uploads wait for connectivity and verification. Settings can edit these values; Analytics derives age from DOB.

Enter weight and reps to complete a set automatically. Bodyweight exercises require reps only. Suggested weights are not actual results until accepted. Finish asks before skipping missing sets; invalid values must be corrected or cleared. At least one completed set is required. Local Saved status remains separate from Uploads.

An offline second phone cannot be erased remotely: its old uploads are rejected at cloud cutover, and its local reset occurs when it runs the new update. Verify both phones separately. Later launches, ordinary updates and backup imports must not repeat the one-time reset. Do not roll back to the pre-reset app; use a corrective compatible update if necessary.

## Owner cutover

Use the private owner ADC outside Git. Complete tests and a production export first. Confirm the update's runtime matches installed App Check builds. Keep billing disabled and Firestore App Check ENFORCED throughout.

```powershell
Set-Location 'C:\Repos\WorkoutApp'
$env:GOOGLE_APPLICATION_CREDENTIALS = "$env:USERPROFILE\.workout-sync\firebase-owner-adc.json"
npm run firebase:setup -- disable-automatic --project workout-bb5a2
npx firebase deploy --only firestore:rules,firestore:indexes --project workout-bb5a2
# Preview counts only, after rules have propagated:
npx tsx scripts/firebaseReset.ts --project workout-bb5a2
# Execute the user-approved reporting reset:
npx tsx scripts/firebaseReset.ts --project workout-bb5a2 --apply
```

The cleanup utility checks the exact deployed rule source, a closed enrollment gate, and enforced App Check. It refuses unknown/new-version roots and unexpected child collections, reserves orphan namespaces, and removes reporting documents in root-checked transactions before deleting active roots, preserves disabled authorization tombstones, and leaves Firebase Auth users and service configuration intact. It retires legacy authorization metadata and removes reporting aliases. A retry must never delete a newly enrolled profile. Its output contains only aggregate counts.

Verify the old versions are denied, then publish the tested preview OTA with EAS and reopen registration:

```powershell
npx eas-cli@latest update --channel preview --platform ios --message "Required device profiles and simpler recording"
npm run firebase:setup -- enable-automatic --project workout-bb5a2
```

The app accepts only new enrollment v3 and record envelope v2. SQLite v6 uses a permanent local reset marker and resumable identity reconciliation; credential v3 preserves a proven anonymous UID and latest secure refresh token while rotating generation/installation IDs. The reset clears old queued/frozen uploads atomically but preserves daily attempted-write accounting. Failure to read secure storage or authenticate must not generate another account or wipe the new profile again. App-managed old recovery copies are cleaned after reset; user-exported files are untouched.

## Published release

Preview update `01a185ff-4bd5-7142-a119-fb2024d71e94` was published from commit `71717d3` after the live reporting reset. Runtime matches `fb7bcde4bd5d1e33aeaf92dd7a6756200ad39d06`; enrollment is open with App Check enforced. Open the installed app online for about 30 seconds, close and reopen it to load the update. Complete the profile only after the new onboarding screen appears. Do not uninstall. The first phone has completed required onboarding and reported Up to date; owner inspection verified the new profile, initial measurement, versioned namespace and initial upload completion. Post-reset training uploads and restart behavior remain to be accepted. Second-phone acceptance remains pending. The later additive import update does not repeat this reset.

## Acceptance checklist

- [x] First phone receives the update and shows required onboarding.
- [ ] Previous local history is empty and built-in exercises remain.
- [x] First-phone profile/starting weight save succeeds and initial uploads are verified.
- [ ] Restart does not repeat onboarding/reset.
- [ ] Plan and recorded set upload; missing sets require Finish confirmation.
- [x] Owner confirms required profile completion, enrollment v3, envelope v2 and initial completion without logging personal values.
- [ ] Owner confirms later training revisions.
- [ ] Second phone completes the same checks under a separate identity.
- [ ] No client Firestore reads; App Check remains enforced and missing/invalid tokens are denied.

Old Google Sheets retirement remains a separate deferred action until phone migration acceptance is complete.
