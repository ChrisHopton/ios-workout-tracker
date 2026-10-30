# Simpler recording and flexible scheduling

Install this update over the existing Workout app. Your profile, measurements, plans, recorded values and private upload identity stay on the phone. There is no reinstall, new account, cloud download or new reset for a journal that completed the earlier profile cutover. Release and installed-phone results are tracked in the [verification record](VERIFICATION.md#simpler-recording-and-flexible-scheduling--current-verification-record).

## Choose how the routine runs

Open **Home > Plans > Edit routine**.

- **Fixed schedule** keeps the existing Weekly and Every 2 weeks calendar assignments. Opposite-week plans may share a weekday; conflicts remain rejected. Missing a workout does not shift the calendar. Existing journals migrate into this mode.
- **Flexible sequence** uses selected training weekdays and an ordered list of plans. A plan may appear more than once. Choose the starting workout and the start date, then review the preview before saving. Calendar time alone does not consume a workout: finishing or explicitly skipping advances the sequence.

Editing a plan's name, exercises or targets preserves routine progress and earlier workout snapshots. Changing the routine's mode, order, training days or starting configuration creates a new routine from the chosen effective date. Historical revisions and progress remain. Finish or cancel an unfinished routine workout before changing its schedule. Remove or replace a plan in the sequence before archiving it.

## Missed and unfinished workouts

An overdue flexible workout offers **Make up** or **Skip and continue** on Home. Make up records the pending workout; finishing it advances the sequence once. Skip records that occurrence as skipped and continues to the next plan. A skip is not a completed workout and contributes no sets or volume. Merely viewing dates, leaving a workout or canceling a draft does not advance the sequence.

An unfinished workout can resume on its original date. Where offered, **Move to today** keeps its recorded values and routine link while changing its date; today must be free. There is only one workout per date, and future dates are view-only. Once a workout has been finished, its date is protected even if an edit reopens it. Finishing it again does not advance the routine a second time.

**Cancel workout** asks for confirmation before removing an unfinished workout and its sets. It is available only for a workout created by this version that has never been finished. Canceling the confirmation keeps the draft. Workouts from older journal formats are protected from cancellation and movement because those formats did not reliably record whether an edited workout had already been finished. Such older drafts remain editable and can still be finished; migration does not change their recorded status or values.

## Record with fewer controls

When a new workout is created, available suggested weights fill its set fields once. Reps stay blank. Bodyweight exercises and exercises without a usable suggestion start with blank weights. A suggested weight alone never completes a set: loaded exercises need valid weight and reps, while bodyweight needs reps only.

Edit or clear any weight as needed. Resume, reopen and subsequent plan changes never refill an existing workout or overwrite its actual values. **NEXT STEP** gives concise progression guidance. The underlying recommendation calculations, stored step sizes and historical suggestion snapshots remain unchanged.

New sets are working sets. The Warm-up/Working selector and suggestion-accept controls are removed. Existing warm-up labels and values remain preserved, and warm-ups remain excluded from working-set progression and volume calculations.

Edits save automatically. Wait for **Saved** before force-closing. **Finish workout** requires at least one completed set, asks before skipping missing sets, and requires invalid entered values to be corrected or cleared. A local save error keeps the current edits available for retry. Upload status is separate from local saving.

## Upgrading an existing phone

1. Keep Workout installed and wait for current edits to show **Saved**.
2. After the owner publishes a compatible preview update, open the app online to download it, then close and reopen it. Confirm the expected update/runtime in **Settings > Uploads**. A native build is needed only if the runtime or required native modules differ; install it over the same app.
3. Check the existing profile, measurements, plans and recorded workouts before recording new data. Migration works offline. Resume online later for pending uploads.
4. Test the new behavior on each phone using the [device checklist](DEVICE_CHECKLIST.md). An offline second phone keeps its local journal until it activates the update; one phone's successful check does not verify the other.

The local SQLite schema advances to **7**, and journal/portable format to **4**. Version 1–3 journals pass through the shared upgrade path. Existing schedules become fixed, routine progress starts empty, and historical sessions have no routine occurrence link. Every migrated session is protected against cancellation/date movement; this does not mark an unfinished session completed or change its actuals, timestamps, suggestions or warm-ups.

Before migration, SQLite retains the complete original journal in an internal recovery row. Migrated journal data, upload projection changes, the upload revision clock and SQLite version commit atomically. A failed recovery write or migration leaves the original journal in place for retry. Frozen upload batches keep their original bytes; their later acknowledgments cannot discard newer queued changes. Restarting does not repeat a completed migration. Browser preview has an equivalent local recovery copy and mock uploads only.

The account UID, credentials, device ID, generation ID, installation ID, upload quotas and permanent profile-cutover marker remain unchanged. Authentication, database-read or corruption errors do not authorize a replacement identity or empty journal. The app still has no full-journal backup/restore interface, and Firestore remains an upload-only reporting copy.

The earlier [profile release](PROFILE_RESET.md) was an explicitly approved one-time reset. A phone that never activated that release still completes its original cutover when it first runs current code. This exception does not create a new reset for phones already using the profile release. Do not repeat the owner purge, remove lifecycle markers, uninstall, or use reset tooling to apply this update.

## Imports and owner uploads

Prepared workout-import version 1 files remain additive. In fixed mode, the existing schedule-date and conflict rules apply. In flexible mode, newly imported plans stay on demand, with a clear preview and consent; the active routine and its progress stay intact. Imported history never consumes a live occurrence. See [import guidance](WORKOUT_IMPORT.md).

The Firestore rules add `schedule_progress` to the existing kind allowlist. Schedule documents include routine configuration, and workout documents include finish protection and occurrence links. Credentials/enrollment stay version 3 and record envelopes stay version 2; the namespace and identity fences are unchanged. All client reads, lists and physical deletes remain denied. The owner should verify and deploy the compatible rule change before validating progress uploads, without purging data or changing App Check enforcement. No app data download is added.
