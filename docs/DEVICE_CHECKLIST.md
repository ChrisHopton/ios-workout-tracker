# iPhone acceptance checklist

Run on physical iPhones using a fresh standalone `preview` build that includes `expo-secure-store`. These boxes remain unchecked until someone performs them. Automated checks and a browser preview cannot verify signing, native SQLite or secure storage, system file/share pickers, keyboards, or real Google Sheets uploads. Browser sync is a local mock.

Record device, iOS version, build number, tester, and date here:

- Device / iOS:
- Build:
- Tester / date:

## Install and presentation

- [ ] Install from EAS on a registered phone, enable Developer Mode, and launch.
- [ ] Home, Analytics, and Settings are reachable using bottom tabs.
- [ ] Check light and dark appearance, larger accessibility text, screen-reader labels, safe areas, and tap targets.
- [ ] Check every form with the keyboard open, including inputs near the bottom and decimal weights.
- [ ] Stop the PC server, enable airplane mode, and verify the app launches and remains usable.

## Plans and schedules

- [ ] Create three workouts on Monday, Tuesday, and Wednesday. Verify they repeat the next week.
- [ ] Add a second workout on each of those days. Verify A/B alternation over four weeks; swap an order and inspect the preview.
- [ ] A third assignment on the same weekday is rejected with a useful message.
- [ ] Search exercises, create a custom exercise, reorder exercises, and save set counts/rep ranges.
- [ ] Edit/archive a plan and verify yesterday's schedule and recorded targets retain their old values.
- [ ] Record a previous day, choose a manual workout on a rest day, and verify future dates cannot be recorded.

## Recording and durable data

- [ ] Rapidly enter, change, and clear weights/reps; wait for Saved. Navigate away and return; values must match exactly.
- [ ] Force-close and reopen after Saved; unfinished workouts resume with no duplicate session.
- [ ] Accept a suggestion, override it, and confirm actual values remain distinct from the suggestion until accepted.
- [ ] Attempt to finish with pending sets; resolve each by completing or explicitly skipping. Reopen a finished workout and edit it.
- [ ] Dumbbell loads say per dumbbell, barbell loads include the bar, and bodyweight exercises accept reps without a weight.
- [ ] When testing storage failure in a development build, show a visible error and Retry, then recover the latest values once storage works.

## Analytics and settings

- [ ] Finish two matching workouts at the upper rep target. Verify the next suggestion and its reason; check no-history/bodyweight states too.
- [ ] Skipped sets and unfinished workouts do not inflate charts. A historical day does not use later performance for suggestions.
- [ ] Review 4-, 8-, and 12-week charts, muscle group totals, exercise history, and scheduled completion.
- [ ] Change pounds/kilograms and height units; historical weights convert appropriately without changing stored session units or losing fractions.
- [ ] Save optional demographics, close/reopen, and confirm they persist without changing progression rules.

## Optional Google Sheets uploads

Complete the owner deployment and private setup in [Google Sheets setup](GOOGLE_SHEETS.md). Keep real connection codes and account/project identifiers out of this checklist.

- [ ] Confirm the owner spreadsheet is Restricted, the owner-authorized `/exec` endpoint is deployed, the Advanced Sheets service is enabled, and separate hashes are configured for the two phones.
- [ ] Before connection, verify the app works offline and no Google sign-in is required by app users.
- [ ] Open Settings > Google Sheets. Confirm the profile/full-history upload explanation is visible, and connection requires an explicit consent checkbox, phone label, and private code.
- [ ] Connect the first phone. Verify its label and device ID in People, profile fields match, and exercises, plans, schedule revisions, workouts, and sets use that Device ID. Confirm optional age, gender, and height are visible to the owner when supplied and connected.
- [ ] Verify the native client follows the Apps Script Content Service redirect and clears pending rows only after valid JSON acknowledgments. Confirm pending count reaches zero and last upload updates.
- [ ] Distinguish Saved from Up to date: go offline, record several rapid edits, and verify local Saved appears while uploads stay pending. Force-close, reopen, reconnect, and confirm only the latest row values upload without duplicates.
- [ ] Edit a finished set and confirm its existing spreadsheet row updates. Delete a local record and confirm the visible row clears while the hidden revision ledger retains the deletion marker.
- [ ] Rename an exercise or alter a plan and verify previously recorded session snapshots remain intact in the Sheet.
- [ ] Rename the phone label and confirm People updates while historical Device IDs stay stable.
- [ ] Connect the second phone with its different code. Confirm independent local data, distinct device namespaces, and no mixing even if record IDs match.
- [ ] Background and reopen each phone during an upload. Verify pending data remains and retries on the next active session; no immediate background upload is assumed.
- [ ] Test invalid and revoked codes. Confirm visible errors, local recording still works, and no new spreadsheet rows appear. Restore access with a new token for the same device ID and verify retry succeeds.
- [ ] Disconnect and restart. Confirm automatic uploads stop and existing Sheet data remains. Reconnect and verify a failed secure-storage read/write can be recovered in a development build without losing journal data.
- [ ] Drain a large initial history queue, reopen, and inspect native storage size and responsiveness. Verify reclamation does not lose local workouts or requeue acknowledged rows.
- [ ] Replace a test phone by restoring its JSON backup before connecting under the same device ID. Verify history and subsequent edits; the Sheet does not download data into a fresh installation. Stop the old installation from uploading under that ID.
## Backup and update recovery

- [ ] Export through the share sheet to Files outside the app's storage.
- [ ] Make a harmless edit, restore the backup with confirmation, and verify plans, revisions, profile, sessions, fractions, and unfinished drafts.
- [ ] Cancel file selection and replacement confirmation; current data stays unchanged.
- [ ] Try malformed JSON and an unsupported schema version; show an error and preserve current data.
- [ ] Install a newer preview build over the app with the same identifier; verify all existing history remains after the original single-row database migrates to individual session records.
- [ ] Record installed app and Documents & Data sizes in iPhone Storage before and after adding representative history. Check recording and chart responsiveness on the actual phone.
- [ ] If using a second phone, verify it has separate data and works offline.

Open issues / screenshots / results:
