# Private Firestore uploads

Workout saves the journal locally in SQLite and automatically uploads a reporting copy from the private iPhone app. Users complete a required device profile but do not sign in, paste connection codes, or configure a database. The phone number is unverified metadata, never an authorization key. Each new installation obtains an anonymous Firebase Authentication account and a private upload namespace, with an automatic model-plus-short-ID label. The owner administers Firebase on the PC. The app never reads, lists, downloads, or restores cloud history; a new installation starts with an empty local journal.

Uploaded data includes the phone label, first/last name, phone number, date of birth, gender, optional height, dated body-weight measurements, preferred units, exercises, plans, schedule revisions, flexible-routine completion/skip progress, workout snapshots, and sets. Firebase project configuration and API keys identify the project and may ship with the app. Passwords, refresh tokens, owner OAuth tokens, and Admin SDK credentials must never ship in source, app configuration, or `EXPO_PUBLIC_*` variables. Device credentials stay in native SecureStore.

The current scheduling/recording upgrade preserves local/reporting data and all private upload identities. Credentials remain version 3, enrollment bindings version 3, and record envelopes version 2 in the same UID-scoped collection layout. The rules add only the `schedule_progress` record kind; deploy and verify that allowlist change before checking routine-progress uploads. No owner purge, new enrollment, identity rotation or client reads are required. The earlier [profile reset rollout](PROFILE_RESET.md) retired legacy password paths in a separate one-time cutover; do not repeat it for this upgrade or roll back to pre-cutover code.

## Owner authentication

Use the existing Spark project and default Cloud Firestore Standard edition database in Native mode. Keep billing unattached. Register the native iOS Firebase app with the bundle ID used by the signed app; the public `GoogleService-Info.plist` belongs to that app. Existing Auth identities may remain for owner records; legacy Firestore paths are denied. Do not enable phone authentication or SMS billing for profile numbers.

The owner scripts use `firebase-admin` with Application Default Credentials (ADC) and an explicit project ID. Admin access bypasses client security rules and is confined to owner tooling. Sign in to the pinned Firebase CLI and create the private ADC copy:

```powershell
npx firebase login
npx tsx scripts/firebaseOwnerAuth.ts --project YOUR_FIREBASE_PROJECT_ID
$env:GOOGLE_APPLICATION_CREDENTIALS = "$env:USERPROFILE\.workout-sync\firebase-owner-adc.json"
```

Complete any Google sign-in and consent yourself. The helper reuses the current owner login when available. It wraps the installed Firebase CLI's credential generator, validates its `authorized_user` fields, and copies them into a private folder without cloud calls or exported administrator keys. It prints only the private file path. The CLI also retains its own local ADC cache.

The ADC contains an owner refresh token. Keep it outside Git, shared folders, screenshots, and app bundles. Windows folder ACLs must restrict access to the owner. Existing files are refused unless `--force` deliberately replaces one. This adapter intentionally targets Firebase CLI **15.33.0** internals; keep its version check and owner-login tests when upgrading. The owner needs permissions to manage this project's Authentication users/configuration, Firestore documents, Firebase iOS app settings, App Check configuration, and Service Usage read/enable access for the App Check API.

An existing approved ADC workflow can also be used. See [local owner ADC](https://firebase.google.com/docs/admin/setup#test_with_gcloud_end_user_credentials) and [service-account impersonation ADC](https://cloud.google.com/docs/authentication/set-up-adc-local-dev-environment#sa-impersonation).

## Inspect upload configuration without changes

Use the existing private owner ADC and the read-only diagnostic:

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS = "$env:USERPROFILE\.workout-sync\firebase-owner-adc.json"
npm run firebase:setup -- diagnose --project YOUR_FIREBASE_PROJECT_ID
```

`diagnose` compares the bundled plist, app bundle identifier, and public Firebase configuration, then reads the consumer App Check API state through Service Usage and the selected project's iOS app, Apple team presence, App Attest configuration, Authentication provider flags, Firestore App Check enforcement, and enrollment gate. Its JSON output contains only configuration comparisons, flags, status codes, and token lifetime. It does not return API keys, tokens, credentials, installation identities, or personal records, and does not change settings. Unlike `list`, it never reads profile records.

`appCheckApi.state` must be `ENABLED`; provider configuration can exist while the consumer API is disabled. Inaccessible, malformed, or mismatched API state is `unknown`. An absent gate reports `enabled: false`; inaccessible or malformed values report `null`. Missing, unfamiliar, or mismatched App Check enforcement reports `unknown`, never verified enforcement. Other `null` fields mean the value could not be established. These diagnostics do not relax the guarded `enable-automatic` command: only exact verified `ENFORCED` permits it to open enrollment. `nativeAttestation: "not-checked"` is deliberate: server configuration cannot prove that either installed phone obtained a valid production token. Complete the physical-phone checks below before enforcement or activation.

## Configure automatic uploads without opening enrollment

After registering the native iOS app, run:

```powershell
npm run firebase:setup -- configure-automatic --project YOUR_FIREBASE_PROJECT_ID --app-id YOUR_FIREBASE_IOS_APP_ID --team-id YOUR_APPLE_TEAM_ID
```

This owner command verifies the selected app belongs to the selected project, enables and verifies `firebaseappcheck.googleapis.com` through Service Usage, sets its Apple Team ID, configures App Attest tokens with a one-hour lifetime, enables anonymous sign-in, and disables automatic deletion of anonymous accounts. Narrow update masks preserve Email/Password configuration. It uses the official Firebase Management, App Check, and Identity Toolkit REST APIs with owner ADC. It does not change service enforcement or the enrollment gate. API enablement is asynchronous: if verification still reports pending/disabled, wait briefly and rerun. If a partial configuration fails, inspect the owner console and rerun the command; no secret responses are logged.

The signed iPhone build includes native Firebase App Check with the production App Attest entitlement. The app obtains App Check tokens through the native module and attaches them explicitly to its REST requests. No debug provider or debug token belongs in the private release build. Configure and test native attestation before enforcing it. See [App Attest setup](https://firebase.google.com/docs/app-check/ios/app-attest-provider) and [App Check service configuration](https://firebase.google.com/docs/reference/appcheck/rest/v1/projects.services).

## Test and deploy the rules

```powershell
npm run test:rules
npx tsx --test tests/firebaseSetup.test.ts tests/firebaseAutomatic.test.ts
npm run typecheck
npm run lint
npx firebase deploy --only firestore:rules,firestore:indexes --project YOUR_FIREBASE_PROJECT_ID
```

The emulator requires a supported JDK and uses only `demo-workout-sync` at `127.0.0.1`. Regular `npm test` skips actual rule evaluation when `FIRESTORE_EMULATOR_HOST` is absent; run `test:rules` explicitly. No real account or database is needed for these tests. Review the deployment project and deploy only the supplied rules/indexes. Never substitute a public or authenticated-user-wide allow rule.

The new rules reject legacy upload paths and old envelope versions, and deny automatic enrollment unless the owner-only document `uploadControl/automaticEnrollment` contains `enabled: true`. An absent document or false value closes the gate. App users cannot read or edit it. Deploying rules does not open the gate.

## Initial App Check setup (new projects only)

For the existing enforced project, keep enforcement enabled and preserve the enrollment gate and existing identities. Follow the current [upgrade guidance](SIMPLER_RECORDING.md#upgrading-an-existing-phone); do not switch back to monitoring or repeat the earlier profile purge.

Before checking phone metrics, enable monitoring-only mode (UNENFORCED) for Cloud Firestore App Check. An unconfigured service defaults to OFF and collects no verification metrics. Keep automatic enrollment closed during monitoring; only valid production phone evidence, confirmed enforcement and negative-token checks justify opening it. See [enforcement modes](https://firebase.google.com/docs/reference/appcheck/rest/v1/EnforcementMode).

1. Keep automatic enrollment closed. The default absent gate is closed; explicitly close it with `disable-automatic` when updating an already configured project.
2. Configure the native iOS app, App Attest, and anonymous Authentication. Build and install the new signed binary over existing installations to preserve their local journals.
3. Verify real App Attest tokens on the installed phones and confirm the installed app uses the current upload-envelope versions. Automated tests and browser preview do not prove native attestation or Keychain persistence.
4. Enable **Cloud Firestore App Check enforcement** in Firebase Console only after the installed clients are verified. Wait for enforcement to propagate; Firebase documents a delay of up to 15 minutes. Confirm requests without a valid App Check token are rejected. Older binaries without App Check tokens will stop uploading after enforcement.
5. Open automatic enrollment with the guarded owner command:

```powershell
npm run firebase:setup -- enable-automatic --project YOUR_FIREBASE_PROJECT_ID
```

`enable-automatic` first closes the gate, resolves the project's numeric identifier through Firebase Management, and reads the official Firestore App Check service configuration. Only an exact `ENFORCED` response for the correct project/service permits reopening the gate. HTTP failures, inaccessible configuration, unknown modes, and unenforced service states leave enrollment closed. This command does not enable App Check itself. Service configuration and the Firestore gate cannot be atomically changed together: finish propagation/native checks before opening, and close enrollment before weakening enforcement later. See [App Check enforcement](https://firebase.google.com/docs/app-check/enable-enforcement).

Pause new enrollment without stopping existing uploads:

```powershell
npm run firebase:setup -- disable-automatic --project YOUR_FIREBASE_PROJECT_ID
```

Once open, every genuine private app installation can enroll. There is no first-two-device race or global two-slot restriction for automatic accounts. Labels identify records for the owner; labels are not access credentials.

## Automatic enrollment and upload invariants

A new installation saves its UUID identity and pending enrollment locally, obtains and securely saves anonymous credentials, then commits its immutable root. It activates the initial history upload only after that commit is confirmed. A lost response repeats exactly the saved enrollment. Client reads are unnecessary.

The root at `automaticUploads/{uid}` contains exactly `schemaVersion: 3`, `enabled`, `deviceId`, `generationId`, and `installationId`. Creation requires the same authenticated UID, anonymous sign-in, an open enrollment gate, `enabled: true`, and valid UUIDs. A client can subsequently write only an identical enabled root. The gate controls new creation only: exact enrollment retries and uploads for an existing enabled root continue when it is closed.

Records live under `automaticUploads/{uid}/records/{key}`. Each request must belong to that UID and match all three identities in its enabled root. Two installations choosing identical UUIDs still have separate UID-scoped paths. Reporting must use the full namespace, not UUIDs alone, to distinguish installations.

The automatic layout uses the schema-version-2 record envelope; legacy layouts are denied. Its fields are `schemaVersion`, `deviceId`, `generationId`, `installationId`, `key`, `kind`, `revision`, `deleted`, and `payload`. Revisions must be positive safe integers. A newer revision can replace a record; an exact duplicate is retryable. Changed content at the same revision and older revisions are denied. Deletion uses a retained tombstone with `deleted: true` and an empty payload, preventing stale resurrection. Root/record physical deletion, all client reads/lists, owner metadata writes, and unknown paths are denied.

The app commits at most ten documents or 256 KiB. Automatic record rules need one root lookup, keeping ten-write commits within the conservative twenty-call bound; legacy writes are denied. The `records` collection-group payload exemption covers both layouts and their nested maps/arrays. See [rule access-call limits](https://firebase.google.com/docs/firestore/security/rules-conditions#access_call_limits) and [map index exemptions](https://firebase.google.com/docs/firestore/query-data/index-overview#automatic_index_exemptions).

## Owner listing, labels, and revocation

List automatic and legacy registrations, enabled status, namespace IDs, current phone labels, and optional owner aliases:

```powershell
npm run firebase:setup -- list --project YOUR_FIREBASE_PROJECT_ID
npm run firebase:setup -- alias --project YOUR_FIREBASE_PROJECT_ID --kind automatic --uid ACCOUNT_UID --alias "Mathe's phone"
npm run firebase:setup -- alias --project YOUR_FIREBASE_PROJECT_ID --kind legacy --uid LEGACY_ACCOUNT_UID --alias "Other phone"
```

Aliases are stored separately at `uploadOwnerMetadata/{kind}:{uid}`. They never mutate an installation binding or uploaded profile and are unreadable to app clients. The listing deliberately excludes passwords and refresh tokens; keep account metadata in owner records rather than public issues.

Revoke an automatic account:

```powershell
npm run firebase:setup -- revoke-automatic --project YOUR_FIREBASE_PROJECT_ID --uid ACCOUNT_UID
```

Revocation first sets the automatic root's `enabled` field to false, immediately denying existing ID tokens, then disables Auth and revokes refresh tokens. The root and records remain. A client cannot re-enable, delete, or recreate that disabled root. If Auth cleanup fails, retry the same command. **Never delete a disabled root as a revocation mechanism**, because an absent root could be recreated by an otherwise valid account.

Revocation applies to an account/namespace, not permanently to the physical phone. A genuinely fresh installation creates a new anonymous UID and namespace, including when iOS Keychain retains credentials from a prior installation. Fully automatic enrollment accepts that new installation. App Check does not provide a permanent hardware ban. Existing/corrupt/query-failing SQLite state or credential-read failures pause uploads and preserve local data for repair; remote Auth/rules rejection never causes automatic UID rotation.

## Retired legacy account maintenance

Legacy password accounts retain the original paths:

- `uploadAuthorizations/{uid}`: owner-managed `enabled`, `deviceId`, and `generationId`.
- `devices/{deviceId}/generations/{generationId}`: immutable schema-version-1 installation binding.
- `devices/{deviceId}/generations/{generationId}/records/{key}`: existing record envelopes.

The original owner commands remain in the tooling for historical account maintenance. Current rules deny these upload paths; these commands do not enable a supported rollback or current-phone connection:

```powershell
npm run firebase:setup -- create --project YOUR_FIREBASE_PROJECT_ID --api-key YOUR_PUBLIC_WEB_API_KEY --output "$env:USERPROFILE\.workout-sync\firebase-devices.json"
npm run firebase:setup -- revoke --project YOUR_FIREBASE_PROJECT_ID --uid LEGACY_ACCOUNT_UID
npm run firebase:setup -- rotate --project YOUR_FIREBASE_PROJECT_ID --api-key YOUR_PUBLIC_WEB_API_KEY --uid LEGACY_ACCOUNT_UID --output "$env:USERPROFILE\.workout-sync\firebase-rotation.json"
npm run firebase:setup -- replace --project YOUR_FIREBASE_PROJECT_ID --api-key YOUR_PUBLIC_WEB_API_KEY --uid LEGACY_ACCOUNT_UID --output "$env:USERPROFILE\.workout-sync\firebase-replacement.json"
```

Legacy `create` defaults to two accounts (`--devices 1` creates one) and retains the two-enabled-legacy-account transactional limit. This limit does not count or constrain automatic accounts. Generated fake-email accounts use random 256-bit passwords; connection codes are base64url-encoded secrets, not encryption, and are written only to a private file outside the repository. They are not the new app's onboarding path.

Legacy rotation atomically disables the old UID and enables a new UID for the same device/generation, retaining its immutable installation binding. Replacement retains device ID but creates a new generation, preserving the old reporting history. A stale UID cannot activate another account for an already active legacy slot. Owner code generation alone does not update credentials on an installed phone: preserve its working credentials and journal until a deliberate compatible maintenance workflow is available. Do not revoke legacy accounts merely to enable automatic enrollment.

## Offline behavior and quotas

Local **Saved** and cloud upload status are separate. Foreground uploads drain the persistent queue; offline edits wait until an active online session. Frozen batches retain exactly their retry content, and acknowledgments clear only confirmed revisions. The `completion` record with `{ "initialUploadComplete": true }` is written only after initial history drains. Closing the app defers remaining work until it reopens; immediate background delivery is not assumed.

The app retains an allowance of **8,000 attempted writes per installation per Pacific calendar day**, including enrollment and retries. Quota exhaustion or the local limit pauses uploads while preserving pending changes. This is a cooperative client budget, not a server abuse limit. More than two automatic installations can exhaust the project's shared allowance; Spark keeps billing unattached. Check [current Firestore quotas](https://firebase.google.com/docs/firestore/quotas). Security-rule lookups can consume read quota even though no records are returned to the app.

On physical phones, verify native enrollment, initial completion, separate namespaces, offline edits across restart, interrupted retries, deletion tombstones, quota pause/resume, revocation, and fresh-install behavior. Browser sync remains a local mock. No personal history should be treated as uploaded until owner-side verification succeeds; cloud records remain reporting copies rather than restore sources. Use the [device checklist](DEVICE_CHECKLIST.md).

## Reporting and troubleshooting

Record kinds are profile, body_weight, exercise, plan, schedule, schedule_template, schedule_progress, workout, workout_exercise, and completion. Body-weight records retain stable IDs, local date, canonical weightKg, and update timestamp. Plan/schedule and workout snapshots preserve their original historical context. Schedule payloads include routine configuration; workout payloads include `hasFinished` and an optional routine occurrence link. A `schedule_progress` document records a completed or skipped occurrence using the stable `routineId:ordinal` source ID. Skips advance the sequence but are not completed workouts. Owner reporting should distinguish legacy retained records from current automatic namespaces, select the relevant installations/generations, and ignore deletion markers for ordinary history views.

For automatic enrollment denials, check App Check enforcement/attestation, the owner gate, anonymous provider configuration, the account UID, and its immutable root. An invalid saved local identity must not be repaired by weakening rules or overwriting a binding. Legacy writes are intentionally denied; do not weaken rules to resume them. For owner tooling errors, verify owner ADC, explicit project, required permissions, and the pinned CLI adapter. Never add request-body or token logging. Keep local history and frozen batches intact while investigating.

## Former Google Sheets migration

Install replacement binaries over existing apps to retain local history. Earlier migrations removed Sheets state/credentials and upgraded SQLite history while preserving internal migration copies and frozen uploads. The app does not download records from Sheets or Firestore.

Retire the former **Workout Sheets Sync** Apps Script resources only after installed-phone migration and owner verification succeed: disable both prior device authorizations, archive the active web-app deployment, and verify the old endpoint rejects both old codes. Then move the private **Workout** spreadsheet to recoverable Google Drive Trash. Do not permanently delete it or empty Trash. Until verification succeeds, leave those resources in place and mark retirement pending.

### Phone verification diagnostic codes

If Settings → Uploads shows an AT- code, report that code with the displayed update/runtime IDs. It identifies a fixed failure category, not a token or installation secret. AT-CONFIG/APP/MODULE/PROVIDER concern native configuration; AT-TOKEN/EMPTY concern token acquisition; AT-REJECTED indicates a recognized HTTP 403 marker; AT-LIMIT indicates HTTP 429; AT-NETWORK and AT-TIMEOUT concern connectivity or the 20-second deadline. These categories guide investigation and are not proof of the underlying cause. Never uninstall to troubleshoot; preserve the local journal and identity.

A verified October 28 failure returned HTTP 403 / `SERVICE_DISABLED` for the public App Attest challenge while App Attest configuration already existed. Enabling the consumer API corrected that challenge to HTTP 200. Run `diagnose` before investigating signing again; neither a configured provider nor an allowed API key proves the API is enabled. See [Service Usage enablement](https://docs.cloud.google.com/service-usage/docs/reference/rest/v1/services/enable).
