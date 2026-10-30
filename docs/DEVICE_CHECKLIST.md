# iPhone acceptance checklist

Run on physical iPhones using a standalone `preview` build with the required native modules. These boxes remain unchecked until someone performs them. Automated checks and a browser preview cannot verify signing, native SQLite or secure storage, keyboards, or real Firestore uploads. Browser sync is a local mock.

Record device, iOS version, build number, tester, and date here:

- Device / iOS:
- Build:
- Tester / date:

## Current update - simpler recording and flexible scheduling

See [feature and migration guidance](SIMPLER_RECORDING.md). Existing post-profile journals migrate to SQLite 7 / journal 4 with the same identity; do not repeat the earlier profile reset. Record actual results for each phone separately.

- [ ] Install over an existing journal with profile, measurements, imported history and pending uploads. Verify all recorded values, suggestions and historical warm-ups survive; no onboarding/reset appears on a phone that completed the profile cutover.
- [ ] Activate the update offline, restart after migration, then reconnect. Verify the same upload identity and subsequent incremental uploads without duplicate records or a repeated migration.
- [ ] Verify fixed Weekly/Every 2 weeks dates and historical schedules remain unchanged. Switch to flexible mode, select training days, repeated plans, starting workout and date, and review the preview.
- [ ] Complete a flexible workout, edit it and finish it again: advance exactly once. Make up an overdue occurrence, then exercise Skip and continue; skips must not count as completed workouts or sets.
- [ ] Resume an unfinished routine workout before starting another. Try keeping its date and moving to today; reject an occupied today. Changing routine structure while an unfinished linked workout exists must not strand the draft.
- [ ] New workouts fill available suggested weights once with blank reps; bodyweight/no-history weights stay blank. Clear or override a value, save and resume: no refill or overwrite occurs.
- [ ] New sets have no Warm-up/Working switch or suggestion-accept control. Historical warm-up labels and results remain intact. NEXT STEP fits small/large text layouts and explains the suggestion.
- [ ] Cancel a new unfinished workout, decline and then confirm: declining retains it, confirming removes it without advancing the routine. Completed and reopened completed workouts cannot be canceled or moved.
- [ ] Older migrated drafts remain editable/finishable but cannot be canceled or moved; this protection must not make unfinished workouts count as completed in Analytics.
- [ ] Simulate a save/migration failure in a development build: journal, progress and upload changes remain consistent; original data/recovery copy survive, inputs remain available and Retry succeeds.
- [ ] Import a prepared file while flexible mode is active: preview explains on-demand plans, consent is required, and existing routine revisions/progress remain unchanged. Reimport adds no duplicates.
- [ ] Verify keyboard behavior, light/dark appearance, Dynamic Type, VoiceOver, confirmation sheets and 44-point controls on small and large iPhones.
- [ ] Owner verifies schedule_progress and linked workout updates under the existing UID, with all app reads/lists/deletes still denied. Browser sync is mock-only.

## Earlier update - minimal Analytics

That earlier update preserved SQLite 6 / journal 3 data and the private upload identity. Do not repeat the earlier profile reset. Installed-device checks remain pending until performed.

- [ ] Analytics shows two totals, Last workout completed, and one carousel; no recent-exercise, comparison or detail-screen links remain.
- [ ] The last workout follows its recorded date, not an imported timestamp, and remains visible outside the chosen period. Viewing it does not reopen it; editing still does.
- [ ] Swipe all three charts and use each 44-point pagination control. Check snapping and the next-card edge on a small iPhone and Pro Max, including rotation and larger text.
- [ ] VoiceOver announces chart position and chart summaries; light/dark layouts remain readable with no clipping.
- [ ] Chart, period and vertical scroll survive switching tabs and opening/returning from a workout. Hidden recording edits do not recompute Analytics; reopening/resuming refreshes it.
- [ ] Settings and custom-exercise creation have no increment fields. Automatic suggestions, existing custom steps, and separate actual values remain unchanged.
- [ ] Profile, measurements, imported plans/history and Uploads survive the OTA. Verify a subsequent incremental upload on each phone separately.

## Earlier rollout - required device profiles

Historical cutover checks only; do not repeat them for this update. Use [profile reset rollout](PROFILE_RESET.md) for a phone that has never activated that earlier release. First-phone uploads were verified before this release; profile-release acceptance is separate and must be recorded again. Keep both apps installed and pause recording until the new profile form appears.

- [ ] Updated app resets old local data once and shows required profile onboarding.
- [ ] Profile and starting weight persist before Home opens; failure preserves inputs and Retry works.
- [ ] Restart does not reset the new profile/history again; offline onboarding works.
- [ ] Owner confirms enrollment v3, envelope v2, initial completion and later revisions without logging personal values.
- [ ] Repeat independently on the second phone when its update activates.

## Install and presentation

- [ ] Install from EAS on a registered phone, enable Developer Mode, and launch.
- [ ] Home, Analytics, and Settings are reachable using bottom tabs.
- [ ] On a standard iPhone and a Pro Max, the top-right Plans action is fully visible and tappable, and bottom tabs sit above the home indicator without a duplicate safe-area gap. Check Home, Analytics, Settings, and the plan editor/recording screens.
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
- [ ] Start a new workout with suggested weights seeded once and blank reps. Override/clear values, save and resume; actuals must remain exactly as entered.
- [ ] Verify no completion checkboxes remain; valid actual weight/reps count automatically. Finish with missing sets asks before skipping; cancel retains the draft. Invalid entered values must be corrected or cleared. Reopen a finished workout and edit it.
- [ ] Dumbbell loads say per dumbbell, barbell loads include the bar, and bodyweight exercises accept reps without a weight.
- [ ] When testing storage failure in a development build, show a visible error and Retry, then recover the latest values once storage works. Inject an upload-state database read failure and confirm the journal and outbox both roll back, then both save on retry.
- [ ] With 1,000 workouts and 100/500 retained schedule revisions, measure recording responsiveness on the phone; compare editing and navigation without deleting history. Desktop measurements alone do not complete this check.

## Analytics and settings

- [ ] Finish two matching workouts at the upper rep target. Verify the next suggestion and its reason; check no-history/bodyweight states too.
- [ ] Skipped sets and unfinished workouts do not inflate charts. A historical day does not use later performance for suggestions.
- [ ] Review 4-, 8-, and 12-week charts, muscle-group totals, last-workout selection, and scheduled completion.
- [ ] Set the Analytics period, carousel card and scroll. Leave to record a workout, then return: results update while the period, carousel card and scroll position remain. Analytics contains no body-weight form or profile editing controls.
- [ ] Background/resume Analytics and cross local midnight with the app open or backgrounded. Verify date-sensitive ranges and scheduled completion refresh for the new day.
- [ ] Change pounds/kilograms and height units; historical weights convert appropriately without changing stored session units or losing fractions.
- [ ] Edit name, phone, DOB and gender; save, close/reopen, and confirm persistence. Age follows DOB including birthdays. Demographics do not change progression rules.

## Automatic private uploads

Keep the existing enforced project and enrollment settings in place. The initial staged owner rollout in [Firestore setup](FIREBASE.md) applies only where setup is incomplete; do not repeat it for this update. Emulator tests do not establish native attestation.

- [ ] Install a compatible OTA or signed build over the existing app on both phones. The earlier required-profile release cleared old local history once; this scheduling/recording update does not add a reset. Verify both UDIDs and production App Attest entitlement in the signed profile.
- [ ] Open each phone online and verify valid App Attest token metrics. Confirm no debug provider or tokens are configured.
- [ ] Enforce Firestore App Check, verify missing/invalid tokens fail in the real service, then enable automatic enrollment using the owner tool.
- [ ] Settings has the gender selector, disclosure and compact read-only upload status; no database forms, code entry, rename, replacement or Disconnect controls.
- [ ] Select each gender option, cancel the sheet, restart, and verify persisted values. Only Male/Female are accepted for the required profile. Check light/dark mode, larger text and VoiceOver.
- [ ] Verify initial history and completion marker for both phones, then edit a set and verify an incremental upload. Matching labels/source IDs must remain in separate namespaces.
- [ ] Old password layouts, enrollment v2, and record envelope v1 are denied. Frozen pre-reset uploads cannot reappear after cutover.
- [ ] Start offline; record locally, force-close, reopen and reconnect. Setup resumes the persisted identity; blank and zero remain distinct.
- [ ] Interrupt enrollment and uploads. Verify identical retry content and no duplicate installation; newer edits remain queued.
- [ ] Verify denied own/cross-account reads, lists and deletes; app traffic contains only authentication and Firestore commits.
- [ ] Revoke a test installation through owner tooling. Previously issued tokens cannot write; the app does not silently create a replacement account. Local recording remains available.
- [ ] Inject storage read/corruption and token rejection in development. They must not be treated as a fresh installation.
- [ ] Verify per-phone attempted-write limit and retry backoff, including Pacific midnight and foreground resume.
- [ ] On a disposable test installation, uninstall/reinstall and verify a fresh identity; old records remain owner-visible. Never uninstall a phone whose local history must be retained.
- [ ] Record installed binary size and Documents & Data on both phones. This is needed for actual native-size measurements.

## Updates and internal migration safeguards

- [ ] Confirm Settings offers the additive Import plans and workouts control, with no full backup/export/recovery controls.
- [ ] Install over the app with the same identifier; the current migration moves to SQLite 7 and journal 4, preserving all journal records and an internal pre-migration recovery copy. Failed migration leaves the original journal intact. No user-facing restore workflow is expected.
- [ ] On an OTA-enabled test build with a matching runtime, verify the update preserves the permanent profile-cutover marker, account, device/generation/installation IDs, quotas and frozen retry batch. Restart must not repeat migration or reset. A build lacking required native modules must use a compatible new binary.
- [ ] Record installed app and Documents & Data sizes in iPhone Storage before and after adding representative history. Check recording and chart responsiveness on the phone.
- [ ] If using a second phone, verify it has separate data and works offline.

Open issues / screenshots / results:

## Recommendations, recurrence, and body-weight acceptance

- [ ] Home Plans opens the plan list; create, edit, cancel/discard, archive, and failed-save retry return correctly.
- [ ] A lone Every 2 weeks plan keeps its rest week; opposite-week plans share a day; conflicts show inline without modifying other plans.
- [ ] Existing irregular schedules keep their dates while editing names/exercises; selecting a new frequency changes dates only from today.
- [ ] Record 40 lb × 12 and 80 lb × 10 for an 8–12 target; the next session suggests 75 lb at a 5 lb increment, with an explanation.
- [ ] Historical warm-up labels persist and exclude those sets from progression/working-set totals. New sets are working sets; no classification or effort input is shown.
- [ ] Check two-workout increases and reductions, unit changes, historical dates, skipped sets, and long gaps.
- [ ] Add/edit/delete dated body weights only in Settings; units preserve canonical kg and measurements remain available for private uploads.
- [ ] Read volume, workout counts, muscle-group sets and empty states with large text and both themes.
- [ ] Verify original results/suggestions, pending uploads, and internal migration copies survive upgrade/restart. Existing increment values remain stored and there are no manual increment controls.


## Historical October 22 Settings and comparison checklist

Comparison-only checks below were superseded by the minimal-Analytics release; they are retained as historical records, not current acceptance requirements.

- [ ] Profile offers only Female/Male; save confirmation stays beside the button until another edit.
- [ ] Weight input and Save fit a Pro Max screen, wrap with larger Dynamic Type, and remain usable above the keyboard.
- [ ] Same-day weight updates retain one entry; changing date and editing/deleting history preserve the right records.
- [ ] Failed saves preserve input and retry; VoiceOver announces saving, saved, and failure without confusing upload state.
- [ ] Compact body comparison and optional competitor median are readable in light/dark mode and larger text; source details expand only when requested.
- [ ] Reference toggle and category override survive tab switches without modifying profile or suggested working weights.
- [ ] Force-close/reopen preserves profile, measurements and workout history; comparisons work in airplane mode.
