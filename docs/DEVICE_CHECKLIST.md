# iPhone acceptance checklist

Run on physical iPhones using a standalone `preview` build with the required native modules. These boxes remain unchecked until someone performs them. Automated checks and a browser preview cannot verify signing, native SQLite or secure storage, keyboards, or real Firestore uploads. Browser sync is a local mock.

Record device, iOS version, build number, tester, and date here:

- Device / iOS:
- Build:
- Tester / date:

## Install and presentation

- [ ] Install from EAS on a registered phone, enable Developer Mode, and launch.
- [ ] Home, Analytics, and Settings are reachable using bottom tabs.
- [ ] On a standard iPhone and a Pro Max, the top-right create-plan icon is fully visible and tappable, and bottom tabs sit above the home indicator without a duplicate safe-area gap. Check Home, Analytics, Settings, and the plan editor/recording screens.
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
- [ ] Set Analytics filters and scroll. Leave to record a workout, then return: results update while the filters and scroll position remain. Analytics contains no body-weight form or profile editing controls.
- [ ] Background/resume Analytics and cross local midnight with the app open or backgrounded. Verify date-sensitive ranges and scheduled completion refresh for the new day.
- [ ] Change pounds/kilograms and height units; historical weights convert appropriately without changing stored session units or losing fractions.
- [ ] Save optional demographics, close/reopen, and confirm they persist without changing progression rules.

## Automatic private uploads

Follow the staged owner rollout in [Firestore setup](FIREBASE.md). Emulator tests do not establish native attestation. Do not enable automatic enrollment until Firestore App Check enforcement and real-service rejection checks pass.

- [ ] Install the new native build over the existing app on both phones, preserving local history. Verify both UDIDs and production App Attest entitlement in the signed profile.
- [ ] Open each phone online and verify valid App Attest token metrics. Confirm no debug provider or tokens are configured.
- [ ] Enforce Firestore App Check, verify missing/invalid tokens fail in the real service, then enable automatic enrollment using the owner tool.
- [ ] Settings has the gender selector, disclosure and compact read-only upload status; no database forms, code entry, rename, replacement or Disconnect controls.
- [ ] Select each gender option, cancel the sheet, restart, and verify persisted values. Existing custom values remain until changed. Check light/dark mode, larger text and VoiceOver.
- [ ] Verify initial history and completion marker for both phones, then edit a set and verify an incremental upload. Matching labels/source IDs must remain in separate namespaces.
- [ ] Existing password-connected installations retain their namespaces, revision counters and frozen batches.
- [ ] Start offline; record locally, force-close, reopen and reconnect. Setup resumes the persisted identity; blank and zero remain distinct.
- [ ] Interrupt enrollment and uploads. Verify identical retry content and no duplicate installation; newer edits remain queued.
- [ ] Verify denied own/cross-account reads, lists and deletes; app traffic contains only authentication and Firestore commits.
- [ ] Revoke a test installation through owner tooling. Previously issued tokens cannot write; the app does not silently create a replacement account. Local recording remains available.
- [ ] Inject storage read/corruption and token rejection in development. They must not be treated as a fresh installation.
- [ ] Verify per-phone attempted-write limit and retry backoff, including Pacific midnight and foreground resume.
- [ ] On a disposable test installation, uninstall/reinstall and verify a fresh identity; old records remain owner-visible. Never uninstall a phone whose local history must be retained.
- [ ] Record installed binary size and Documents & Data on both phones. This is needed for actual native-size measurements.

## Updates and internal migration safeguards

- [ ] Confirm Settings has no backup, import, export, pre-migration-copy, or recovery buttons.
- [ ] Install a newer preview build over the app with the same identifier; existing history remains after SQLite version 5 migration. In native development verification, confirm the validated private pre-migration copy is created before migration, including for a valid journal above 10 MiB. No user-facing restore workflow is expected.
- [ ] On an OTA-enabled test build with a matching runtime, verify a preview-channel update retains journal data and connection state. A build lacking required native modules must use a new binary.
- [ ] Record installed app and Documents & Data sizes in iPhone Storage before and after adding representative history. Check recording and chart responsiveness on the phone.
- [ ] If using a second phone, verify it has separate data and works offline.

Open issues / screenshots / results:

## Recommendations, recurrence, and body-weight acceptance

- [ ] Home + and Manage plans open the same plan list; create, edit, cancel/discard, archive, and failed-save retry return correctly.
- [ ] A lone Every 2 weeks plan keeps its rest week; opposite-week plans share a day; conflicts show inline without modifying other plans.
- [ ] Existing irregular schedules keep their dates while editing names/exercises; selecting a new frequency changes dates only from today.
- [ ] Record 40 lb × 12 and 80 lb × 10 for an 8–12 target; the next session suggests 75 lb at a 5 lb increment, with an explanation.
- [ ] Warm-up labels persist and exclude those sets from progression/working-set totals. No effort input is required.
- [ ] Check two-workout increases and reductions, unit changes, historical dates, skipped sets, and long gaps.
- [ ] Add/edit/delete dated body weights only in Settings; units preserve canonical kg and Analytics updates its read-only history/ratios. Ratios use a measurement on or before each workout.
- [ ] Read estimated-strength charts, all-time records, volume, empty states, and dated body-weight ratios with large text and both themes.
- [ ] Verify original results/suggestions, pending uploads, and internal migration copies survive upgrade/restart. Settings increment controls start collapsed and open through Adjust weight increments.


## October 22 Settings and comparison acceptance (pending on iPhone)

- [ ] Profile offers only Female/Male; save confirmation stays beside the button until another edit.
- [ ] Weight input and Save fit a Pro Max screen, wrap with larger Dynamic Type, and remain usable above the keyboard.
- [ ] Same-day weight updates retain one entry; changing date and editing/deleting history preserve the right records.
- [ ] Failed saves preserve input and retry; VoiceOver announces saving, saved, and failure without confusing upload state.
- [ ] Compact body comparison and optional competitor median are readable in light/dark mode and larger text; source details expand only when requested.
- [ ] Reference toggle and category override survive tab switches without modifying profile or suggested working weights.
- [ ] Force-close/reopen preserves profile, measurements and workout history; comparisons work in airplane mode.
