# Add plans and recorded workouts from a private file

Use **Settings > Import plans and workouts** to select a prepared Workout import JSON file from iPhone Files. The app does not parse Excel files directly. The workbook is converted and checked locally first; the private result must stay outside the repository and OTA assets.

1. Open Workout online to download the compatible preview update, then close and reopen it after local edits are saved. Do not uninstall.
2. Transfer the prepared JSON privately to Files on the intended iPhone, for example through your own iCloud Drive.
3. In Settings, expand **Import plans and workouts**, choose the file, and inspect the added plan/workout/exercise counts and schedule notice.
4. Existing IDs and occupied workout dates are preserved. In fixed mode, if a new plan conflicts with an existing schedule, explicitly choose to leave it unscheduled or choose a different file. In flexible mode, imported new plans stay on demand; the preview explains this and requires consent before adding them. Nothing is saved by selecting or previewing a file.
5. Tap **Import plans and workouts** and wait for the added-count confirmation. A failed save leaves existing records in place and offers Retry with the selected file.
6. Review Plans and the historical workout dates. Stay online until Uploads reports Up to date; the owner can then verify the reporting copy. Offline import is also supported; uploads wait for connection.

Importing the same file again adds no duplicate records. Existing edited plans/history are kept on conflicts. Profile information, dated body weights, anonymous account, enrollment, revision state and immutable upload retries are not taken from the file. Journal additions and their upload queue changes commit through the existing transaction. No reset, backend read, or security-rule change is involved.

In fixed mode, the schedule starts on the later of the file's start date and the actual import date. The file's alternating-week anchors stay fixed even if importing late. If a future schedule is already pending, the plan editor shows when changes take effect and edits that pending schedule; earlier dates remain unchanged. Plan archiving follows the same displayed date.

In flexible mode, import preserves the active routine, schedule revisions and completion/skip progress. New plans are added on demand without changing the sequence; add them explicitly in the routine editor when desired. Imported history never links to or advances a live routine occurrence.

## File format and extraction

The strict `workout-import` version 1 envelope contains `sourceId`, `importId`, optional `scheduleStartDate`, exercise definitions, templates and sessions. It is separate from the complete portable backup format (version 4) and accepts no profile, body-weight, or credential fields. The file limit is 10 MiB; the current SQLite schema is version 7. Validate the complete file with `parseWorkoutImport` and preview its additive merge before delivery. Version 1 imports without the new session fields are accepted: unknown prior completion is conservatively protected with `hasFinished: true`, recorded status/values stay unchanged, and the routine link is null. These legacy records cannot be canceled or moved. Explicit valid finish state in a modern file is retained. Explicit non-null routine occurrence links are rejected; imported history cannot claim or rewrite live routine progress.

Use stable exercise, plan and session IDs, explicit equipment/load conventions, original workout units, and exact actual-weight/repetition strings. Keep skipped prescribed sets distinct from completed sets and suggestions. If the source records only calendar dates, retain those dates and use the conversion time for import metadata timestamps; do not invent a workout time. Suggestion snapshots with no source evidence should contain null weights and an explanatory reason. Resolve ambiguous equipment or load conventions with the owner before conversion.

Do not bundle source workbooks, extracted personal history, private connection information or provenance records. Conversion checks should reconcile dates, plan targets and every recorded set against the source. Use synthetic fixtures in source-controlled tests. This workflow does not download or recover Firestore data, and importing on a different phone adds the file to that phone's separate profile.
