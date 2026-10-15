# iPhone acceptance checklist

Run on physical iPhones using a fresh standalone `preview` build that includes `expo-secure-store` and `expo-crypto`. These boxes remain unchecked until someone performs them. Automated checks and a browser preview cannot verify signing, native SQLite or secure storage, system file/share pickers, keyboards, or real Firestore uploads. Browser sync is a local mock.

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
- [ ] Change a plan to Every 2 weeks, then add a second plan on the same weekday with the opposite starting week. Verify the dated alternation over four weeks.
- [ ] An assignment that conflicts with an occupied weekly/fortnightly date is rejected with a useful message.
- [ ] Search exercises, create a custom exercise, reorder exercises, and save set counts/rep ranges.
- [ ] Edit/archive a plan and verify yesterday's schedule and recorded targets retain their old values.
- [ ] Record a previous day, choose a manual workout on a rest day, and verify future dates cannot be recorded.

## Recording and durable data

- [ ] Rapidly enter, change, and clear weights/reps; wait for Saved. Navigate away and return; values must match exactly.
- [ ] Force-close and reopen after Saved; unfinished workouts resume with no duplicate session.
- [ ] Accept a suggestion, override it, and confirm actual values remain distinct from the suggestion until accepted.
- [ ] Attempt to finish with pending sets; resolve each by completing or explicitly skipping. Reopen a finished workout and edit it.
- [ ] Dumbbell loads say per dumbbell, barbell loads include the bar, and bodyweight exercises accept reps without a weight.
- [ ] When testing storage failure in a development build, show a visible error and Retry, then recover the latest values once storage works. Inject an upload-state database read failure and confirm the journal and outbox both roll back, then both save on retry.
- [ ] With 1,000 workouts and 100/500 retained schedule revisions, measure recording responsiveness on the phone; compare editing and navigation without deleting history. Desktop measurements alone do not complete this check.

## Analytics and settings

- [ ] Finish two matching workouts at the upper rep target. Verify the next suggestion and its reason; check no-history/bodyweight states too.
- [ ] Skipped sets and unfinished workouts do not inflate charts. A historical day does not use later performance for suggestions.
- [ ] Review 4-, 8-, and 12-week charts, muscle group totals, exercise history, and scheduled completion.
- [ ] Set Analytics filters, enter an unfinished body-weight draft, and scroll. Leave to record a workout, then return: results update while the filters, draft, and scroll position remain.
- [ ] Background/resume Analytics and cross local midnight with the app open or backgrounded. Verify date-sensitive ranges and scheduled completion refresh for the new day.
- [ ] Change pounds/kilograms and height units; historical weights convert appropriately without changing stored session units or losing fractions.
- [ ] Save optional demographics, close/reopen, and confirm they persist without changing progression rules.

## Optional Firestore uploads

Complete the owner deployment and private setup in [Firestore setup](FIREBASE.md). The Spark project, device authentication, rules/index deployment, and two private unbound codes are ready. Synthetic live uploads and security tests passed; complete the installed-phone checks below. Keep real codes and account/project identifiers out of this checklist and its screenshots.

- [ ] Confirm the owner has enabled password Authentication, deployed the supplied upload-only rules, and issued two separate private codes. Inspect records through the owner's Firebase Console.
- [ ] Before connecting, verify the app works offline and presents no Google or Firebase account sign-in screen.
- [ ] Open Settings > Database uploads. Confirm the profile/full-history explanation and explicit consent are required with a phone label and private code.
- [ ] Connect the first phone. Verify its installation binding and distinct device/generation namespace in the owner console. Check supplied age, gender, height, units, plans, schedule snapshots, workouts, and sets.
- [ ] Confirm all client record reads and lists are denied. The app must not fetch, merge, or restore cloud history.
- [ ] Interrupt initial upload, restart, and resume. Verify the frozen retry is identical, acknowledgments clear only the confirmed revisions, and Initial history uploaded appears only after all history drains and the completion marker commits.
- [ ] Go offline, make rapid edits, and confirm local Saved while uploads remain pending. Force-close, reopen, reconnect, and verify the newest drafts upload with blank strings distinct from zero.
- [ ] Edit a finished set and inspect its existing workout/exercise documents. Remove a local record and verify a revisioned tombstone with an empty payload replaces its cloud content.
- [ ] Rename an exercise or alter a plan and verify recorded sessions and historical schedule snapshots retain the old definitions and targets.
- [ ] Rename the phone label and verify only its profile changes while historical identity remains stable.
- [ ] Connect the second phone with its different code. Verify independent local journals and cloud namespaces, including records with matching source IDs.
- [ ] Background and reopen during upload. Verify pending data remains and retries in the next active session; no immediate background upload is assumed.
- [ ] Reach a test upload-budget limit. Confirm Uploads paused and the next attempt are visible, retries do not bypass the cap, and local recording continues. Verify resume across Pacific midnight.
- [ ] Test invalid and revoked codes. Confirm errors, working local recording, and no unauthorized cloud writes. Test owner-issued credential rotation without losing the installation binding, revision clock, or frozen batch.
- [ ] Disconnect and restart. Confirm uploads stop and existing cloud data remains. Reconnect after offline edits/deletions and verify their latest state uploads.
- [ ] Test failed secure-storage reads/writes and a restart during enrollment in a development build; recover without losing journal data or accidentally activating another identity.
- [ ] Drain a large initial history queue, reopen, and inspect native storage size/responsiveness. Verify maintenance preserves workouts and does not requeue acknowledged records.
- [ ] Replace a test phone with an owner-issued fresh generation. Restore its JSON backup before connecting; verify the old generation is preserved and an old code cannot bind the new installation. The app must not restore from Firestore.

## Backup and update recovery

- [ ] Export through the share sheet to Files outside the app's storage, including the pre-migration backup when available.
- [ ] Make a harmless edit, restore the backup with confirmation, and verify plans, revisions, profile, sessions, fractions, and unfinished drafts.
- [ ] Cancel file selection and replacement confirmation; current data stays unchanged.
- [ ] Try malformed JSON and an unsupported schema version; show an error and preserve current data.
- [ ] Round-trip a portable backup within 10 MiB and verify a file above 10 MiB is rejected by Settings without altering the journal. This release does not support larger portable restores.
- [ ] Install a newer preview build over the app with the same identifier; verify all existing history remains when the database migrates to SQLite schema version 5. Confirm the automatic private pre-migration JSON copy is created before migration and can be shared with Export pre-migration backup. Include a valid local journal above 10 MiB: its internal copy must not be blocked by the portable guard, but Settings restore of that oversized copy remains unsupported.
- [ ] Record installed app and Documents & Data sizes in iPhone Storage before and after adding representative history. Check recording and chart responsiveness on the actual phone.
- [ ] If using a second phone, verify it has separate data and works offline.

Open issues / screenshots / results:

## Recommendations, recurrence, and body-weight acceptance

- [ ] Home + and Manage plans open the same plan list; create, edit, cancel/discard, archive, and failed-save retry return correctly.
- [ ] A lone Every 2 weeks plan keeps its rest week; opposite-week plans share a day; conflicts show inline without modifying other plans.
- [ ] Existing irregular schedules keep their dates while editing names/exercises; selecting a new frequency changes dates only from today.
- [ ] Record 40 lb × 12 and 80 lb × 10 for an 8–12 target; the next session suggests 75 lb at a 5 lb increment, with an explanation.
- [ ] Warm-up labels persist and exclude those sets from progression/working-set totals. No effort input is required.
- [ ] Check two-workout increases and reductions, unit changes, historical dates, skipped sets, and long gaps.
- [ ] Add/edit/delete dated body weights in Settings and Analytics; units preserve canonical kg; ratios use a measurement on or before each workout.
- [ ] Read estimated-strength charts, all-time records, volume, empty states, and dated body-weight ratios with large text and both themes.
- [ ] Export/import JSON v2 and import v1; verify raw versioned recovery exports, original results/suggestions, and pending cloud uploads survive migration/restart.
