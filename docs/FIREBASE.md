# Private Firestore uploads

Workout records and saves locally in SQLite. Optional Firebase uploads copy the profile and journal to the owner's Cloud Firestore project for external analysis. The app is upload-only: every client read and list is denied, and it never downloads or restores cloud history. A new installation starts with an empty local journal; there is no in-app cloud or JSON backup restore workflow. Users paste separate private connection codes without signing in to Google. The owner administers the project through Google and local owner credentials.

When connected, the owner can see the phone label, optional age/gender/height, dated body-weight measurements entered in Settings, preferred units, exercises, plans, schedule revisions, workout snapshots, and recorded sets. Each phone has a device ID, upload generation, Firebase Authentication UID, and random 256-bit password. The app keeps its connection in native secure storage. An API key identifies the project; it is not an administrator credential or permission to access records. Never put passwords, connection codes, owner OAuth tokens, or Admin SDK credentials into the app bundle, source control, or `EXPO_PUBLIC_*` variables.

## 1. Prepare the owner's Firebase project

1. Create or select the owner's project in [Firebase Console](https://console.firebase.google.com/). Keep the real project ID in private setup instructions rather than replacing examples in this public guide.
2. Create a **Cloud Firestore Standard edition** database in Native mode, with the default database ID `(default)`. Choose the location deliberately; this app targets the default database. Start with production rules that deny access.
3. In **Authentication → Sign-in method**, enable **Email/Password**. The utility creates synthetic `phone-UUID@workout.invalid` accounts; those addresses do not belong to people and do not receive email. Use the standard password policy compatible with long randomly generated passwords.
4. Register a Firebase **Web app** to obtain the project ID and its public `apiKey`. App users still use native Workout; this registration supplies the REST authentication configuration.
5. Install dependencies with `npm ci`. The Admin SDK, Firebase CLI, and rules-testing SDK are development dependencies and are never imported by mobile runtime code. Check quotas and your selected Firebase plan in the owner console. [Firestore setup](https://firebase.google.com/docs/firestore/quickstart), [password authentication](https://firebase.google.com/docs/auth/web/password-auth).

## 2. Test and deploy the restrictive rules

Run the local tests before deploying. Java is required by the Firestore emulator; use a supported JDK for the installed Firebase CLI.

```powershell
npx firebase emulators:exec --only firestore --project demo-workout-sync "npx tsx --test tests/firestoreRules.test.ts"
npx tsx --test tests/firebaseSetup.test.ts
```

The demo project and `127.0.0.1` emulator configuration cannot target the real cloud database. Regular `npm test` runs the owner utility and static config tests; the emulator suite is skipped unless `FIRESTORE_EMULATOR_HOST` is set. Complete the dedicated emulator command to test actual rule evaluation. [Rules emulator tests](https://firebase.google.com/docs/firestore/security/test-rules-emulator).

Sign in to the Firebase CLI as the owner and deploy only rules and indexes:

```powershell
npx firebase login
npx firebase deploy --only firestore:rules,firestore:indexes --project YOUR_FIREBASE_PROJECT_ID
```

`firebase.json` points to `firebase/firestore.rules` and `firebase/firestore.indexes.json`. `.firebaserc.example` is optional configuration with a placeholder, not an actual project selection. Review the displayed project before confirming deployment. Never replace the rules with an authenticated-user-wide or public allow rule.

If the console cannot finish enabling Email/Password, the pinned CLI supports the equivalent provider configuration already in `firebase.json`:

```powershell
npx firebase deploy --only auth --project YOUR_FIREBASE_PROJECT_ID
```

This enables the standard Email/Password provider. Do not enable paid Identity Platform features or attach a billing account to work around setup errors.

The rules allow only uploads belonging to the UID's owner-managed registry entry and the generation's immutable installation binding. Every client read/list, registry edit, physical delete, and unknown path is denied. Authorized writes need the exact envelope, a positive safe-integer revision, and a matching device/generation/installation identity. A later revision replaces a document; the exact same document can be retried. Changed content at the same revision and older revisions are rejected. Deletion uploads retain the key/revision marker with `deleted: true` and an empty payload; they clear personal content while preventing stale resurrection.

The app commits at most ten documents together. Each write checks the registry and binding, keeping the conservative bound at two rule document lookups per write and twenty per commit. Rule access-call limits apply in addition to each write's limit. The `payload` map is exempt from automatic indexing, including inherited map/array subfields. Add only intentional owner query indexes later. [Access-call limits](https://firebase.google.com/docs/firestore/security/rules-conditions#access_call_limits), [map index exemptions](https://firebase.google.com/docs/firestore/query-data/index-overview#automatic_index_exemptions).

## 3. Authenticate the local owner utility through the Firebase CLI

The setup script uses `firebase-admin` with **Application Default Credentials (ADC)** and an explicit project ID. The Admin SDK runs on the owner's PC and bypasses client security rules. Owner ADC stays in a private local folder and is never included in mobile code or connection codes.

Sign in to the pinned Firebase CLI as the owner, then create the local ADC copy:

```powershell
npx firebase login
npx tsx scripts/firebaseOwnerAuth.ts --project YOUR_FIREBASE_PROJECT_ID
$env:GOOGLE_APPLICATION_CREDENTIALS = "$env:USERPROFILE\.workout-sync\firebase-owner-adc.json"
```

Complete any Google sign-in and consent yourself. If the CLI already has the correct owner login, the helper reuses it without starting another authentication flow. The owner account must be able to manage Authentication users and Firestore documents in the selected project. The optional `--project` adds that public ID as `quota_project_id`; the setup utility also receives its project explicitly.

The helper wraps the installed Firebase CLI's own local credential generator, validates the standard `authorized_user` ADC fields, and copies them into `%USERPROFILE%\.workout-sync\firebase-owner-adc.json`. The CLI also maintains its own local ADC cache. No administrator private key is exported, and the helper makes no cloud calls. It prints only the final private file path. Set `GOOGLE_APPLICATION_CREDENTIALS` to that path in the PowerShell session that runs the account setup command.

Use `--output` to choose a different private file outside every Git working tree. Existing files are refused unless you deliberately add `--force` to refresh one. Files use mode `0600` on platforms that enforce it; on Windows, ensure the parent folder's inherited ACL grants access only to your account. The ADC contains the owner's refresh token, so keep it out of shared folders, Git, screenshots, and app bundles. It remains separate from the private phone connection files generated in the next step.

This owner-only adapter intentionally uses `firebase-tools` **15.33.0** internals: `lib/auth.js` and `lib/defaultCredentials.js`. The helper checks that exact version and fails clearly when the owner is unsigned or the adapter is unavailable. Recheck compatibility and the owner-login tests before upgrading Firebase CLI; do not remove the version guard. A helper error does not trigger an alternate authentication flow automatically.

An organization that already uses another approved ADC workflow can keep it instead. Consult Firebase's [local owner ADC guidance](https://firebase.google.com/docs/admin/setup#test_with_gcloud_end_user_credentials) or Google's [service-account impersonation ADC guidance](https://cloud.google.com/docs/authentication/set-up-adc-local-dev-environment#sa-impersonation). Those optional workflows require their own owner-reviewed OAuth or IAM configuration; the recommended local Firebase CLI helper needs no Cloud CLI installation or Desktop OAuth client setup.

## 4. Provision the two phone accounts and private codes

After rules are deployed and owner ADC is ready, run:

```powershell
npm run firebase:setup -- create --project YOUR_FIREBASE_PROJECT_ID --api-key YOUR_PUBLIC_WEB_API_KEY --output "$env:USERPROFILE\.workout-sync\firebase-devices.json"
```

The default creates two independent phones; `--devices 1` creates one. At most two registry authorizations can be enabled in the project, with only one active account per device ID. Capacity is checked in the same Firestore transaction that publishes accounts, so another `create` cannot add a third active phone. Use `rotate` or `replace` to change an existing slot.

The utility generates each UID, device ID, generation ID, fake email, and random 256-bit password. It reserves a private file outside the repository, writes the connection codes, creates Auth accounts, and atomically publishes the registry entries. Only the private file path is printed; passwords/codes are never logged. Existing files are refused unless you deliberately use `--force`. With no `--output`, a unique file is placed under `%USERPROFILE%\.workout-sync`.

Open the private file locally. Its `devices` array contains each phone's metadata and `WORKOUTFB1.` connection code. Codes contain secrets in base64url JSON; base64 is encoding, not encryption. Protect the folder with your Windows account's permissions, avoid shared/cloud folders, and give each person only their own code privately. Do not paste codes into issues or chat logs. If setup fails, inspect the private file and owner console before retrying; a written code does not establish that its account activation completed. Partial account creation is cleaned up where possible, and errors do not echo secret values.

## 5. Connect and verify on native phones

In **Settings > Database uploads**, paste the private Firebase connection code, enter a recognizable phone label, and explicitly consent to upload the profile and full history. Once connected, open **Manage connection** for upload details and connection controls. A SQLite-persisted installation UUID is enrolled into that device/generation's immutable binding. Repeating the same binding is allowed; another installation UUID cannot take it over. Connection remains pending until this binding is confirmed and local activation finishes.

Foreground uploads drain a persistent queue. Local **Saved** is separate from cloud **Up to date**. Offline changes wait for an active online session. Stable keys and revisions support exact retries after a lost response, while updates during an upload remain queued at their newer revision. The initial upload ends with the literal `completion` marker and `{ "initialUploadComplete": true }`; the marker is sent after initial records have been acknowledged. Every client cloud read is denied, so neither the app nor its phone credentials can inspect the owner's stored records.

Verify on real installed phones: initial connection and zero pending count, profile/record values in the owner console, two separate device namespaces, interrupted uploads, offline edits across force-close, completed-set edits, deletion payload clearing, invalid/revoked codes, and replacement-phone enrollment. Confirm the native request path and Keychain/SQLite persistence. Mock tests and browser preview do not establish those native behaviors. No personal history should be treated as uploaded until these checks pass; a verified upload remains a reporting copy, not an app restore source.

## Revoke, rotate, or replace a phone

Copy the current active account UID from the latest local private metadata or owner console without publishing it. A stale UID from before rotation cannot activate a second account for an already-active device. Revoke immediately through the owner utility:

```powershell
npm run firebase:setup -- revoke --project YOUR_FIREBASE_PROJECT_ID --uid EXISTING_ACCOUNT_UID
```

The registry is disabled first, so an already-issued Firebase ID token cannot continue uploading. Auth is then disabled and refresh tokens revoked. Existing Firestore records remain. Disconnecting inside the app only stops that installation; owner revocation is the server control.

Rotate a leaked password on the same surviving installation:

```powershell
npm run firebase:setup -- rotate --project YOUR_FIREBASE_PROJECT_ID --api-key YOUR_PUBLIC_WEB_API_KEY --uid EXISTING_ACCOUNT_UID --output "$env:USERPROFILE\.workout-sync\firebase-rotation.json"
```

Rotation generates a new UID/password for the same device and generation. One atomic registry transaction disables the old UID and enables the new one, after which old Auth is disabled. The existing installation binding stays unchanged. Give the new code privately to that phone and reconnect. If old Auth cleanup fails, the registry still denies the old UID; repeat `revoke` for cleanup.

For a lost, reinstalled, or replacement phone, use **replace**, which keeps the device ID but generates a new generation and UID:

```powershell
npm run firebase:setup -- replace --project YOUR_FIREBASE_PROJECT_ID --api-key YOUR_PUBLIC_WEB_API_KEY --uid EXISTING_ACCOUNT_UID --output "$env:USERPROFILE\.workout-sync\firebase-replacement.json"
```

The new installation starts with an empty local journal and enrolls only in its new generation. The old generation remains archived for owner analysis and cannot be overwritten by the new phone. A code for the old generation cannot bind a fresh installation UUID. The app has no cloud or JSON restore workflow. Keep the existing installation when its local history is still needed, and stop the old installation from uploading when replacing its device slot.

## Former Google Sheets migration (historical transition)

This section records the earlier Sheets-to-Firestore transition. Install the replacement binary over an existing app to preserve its local journal. The Firestore migration removes old Sheets state and credentials. SQLite version 5 upgrades the journal to JSON v2, preserving an original-schema internal copy and any frozen upload batch. Those migration/validation safeguards remain, but the current interface does not expose export or restore controls. Deploy the current rules, including body_weight, before enabling measurement uploads. The rules retain all existing read denials. No history is downloaded from Sheets or Firestore. Connect each phone with its separate new code and leave it open until the initial history completes; verify the actual journal, an incremental edit, and a deletion through the owner console.

After installed-phone migration and owner verification succeed, retire **Workout Sheets Sync** in Apps Script: disable both prior device authorizations in its Script Properties and archive its active web-app deployment in **Deploy > Manage deployments**. Verify the old endpoint no longer accepts either old code. Then move the private **Workout** spreadsheet to Google Drive **Trash**, using its normal recoverable trash action. Do not permanently delete it or empty Trash. Until these conditions pass, leave the old cloud resources in place and mark retirement pending. The app and repository already use Firestore exclusively.

At the documented setup checkpoint, the two private codes were unbound for first use on the phones. Synthetic test accounts were disabled; their separate verification records contain no personal journal. Keep owner-only verification artifacts and connection files outside Git.

## Quotas and offline behavior

Keep the project on **Spark**, without a billing account. The current free default-database allowance includes 1 GiB storage and 20,000 document writes per day; security-rule lookups can also consume read quota even though they never return records to the app. Check the [current Firestore quotas](https://firebase.google.com/docs/firestore/quotas). Nothing in the setup utility attaches billing or upgrades the plan.

The app persists an allowance of **8,000 attempted writes per phone per Pacific calendar day**, including enrollment and retries. A commit sends at most ten documents or 256 KiB. Firebase quota exhaustion or the local limit pauses uploads while preserving the outbox. Settings shows the next retry; local recording continues. Foreground retries resume after the applicable reset, and closing the app defers remaining work until it reopens. This local allowance is a cooperative budget rather than a server-enforced abuse limit for a stolen credential; revoke exposed credentials immediately.

## Owner data paths and troubleshooting

- `uploadAuthorizations/{uid}`: owner-only registry with `enabled`, `deviceId`, and `generationId`.
- `devices/{deviceId}/generations/{generationId}`: immutable `schemaVersion`, device, generation, and installation binding.
- `.../records/{key}`: the exact envelope `schemaVersion`, `deviceId`, `generationId`, `installationId`, `key`, `kind`, `revision`, `deleted`, and `payload`.

Record kinds are profile, body_weight, exercise, plan, schedule, schedule_template, workout, workout_exercise, and completion. Each body_weight record contains a stable measurement ID, local date, canonical weightKg and update timestamp. Plan/schedule snapshots include explicit recurrence; workout-exercise snapshots retain classification and recommendation version. Payload maps preserve journal fields and ordered child arrays. Use the owner console or trusted administrative reporting code to inspect records; phone credentials have no read permissions. Admin reporting should select current enabled generations and ignore deletion markers when producing user-facing history.

For permission errors, check deployed rules, the account UID's enabled registry entry, namespace identity, and immutable installation binding. A nonce mismatch needs a replacement generation; do not weaken rules or overwrite the existing binding to make it connect. For owner utility authentication errors, check the selected Firebase CLI owner account, pinned adapter version, private ADC path in `GOOGLE_APPLICATION_CREDENTIALS`, explicit project, and IAM permissions. For interrupted initial uploads, retain local data and retry the same saved connection. Request bodies and private setup files contain passwords/tokens; never add body logging.
