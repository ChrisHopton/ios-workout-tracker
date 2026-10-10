# iPhone acceptance checklist

Run on a physical iPhone using the standalone `preview` build. These boxes intentionally remain unchecked until someone performs them. Automated checks and a browser preview cannot verify native keyboard behavior, system share/file pickers, signing, or iOS persistence.

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

## Backup and update recovery

- [ ] Export through the share sheet to Files outside the app's storage.
- [ ] Make a harmless edit, restore the backup with confirmation, and verify plans, revisions, profile, sessions, fractions, and unfinished drafts.
- [ ] Cancel file selection and replacement confirmation; current data stays unchanged.
- [ ] Try malformed JSON and an unsupported schema version; show an error and preserve current data.
- [ ] Install a newer preview build over the app with the same identifier; verify all existing history remains.
- [ ] If using a second phone, verify it has separate data and works offline.

Open issues / screenshots / results:
