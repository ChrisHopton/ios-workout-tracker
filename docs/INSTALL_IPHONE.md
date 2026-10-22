# Install Workout on your iPhone from Windows

The `preview` profile creates a standalone private iPhone app with its JavaScript and assets bundled. After installation, recording and analytics work offline with your Windows PC switched off. This is an EAS internal distribution build. [Expo's preview-build guide](https://docs.expo.dev/tutorial/eas/internal-distribution-builds/)

This release adds native Firebase App Check with production App Attest. **Both phones need a new native installation; OTA cannot add these modules. Install over Workout using the same Apple team and bundle identifier to retain local history. Do not uninstall.**

The app automatically identifies installations using the model and a stable suffix. No phone code, account sign-in, or database controls appear in Settings. Existing connected installations keep their private identity and queued history. The browser uses a local mock only.

## 1. Accounts and prerequisites

- Your iPhone must run **iOS 16.4 or newer**.
- Use an Expo account and an active Apple Developer Program membership. Apple lists **US $99 per membership year**, with regional pricing. You complete enrollment, payment, Apple sign-in, and two-factor prompts yourself. [Apple enrollment](https://developer.apple.com/programs/enroll/)
- EAS builds run in Expo's cloud. Build availability, quotas, and paid options depend on your account; check before starting a build. [EAS build setup](https://docs.expo.dev/build/setup/)
- Install Node.js 24.12.0 or newer compatible 24.x LTS release and Git for Windows if needed. Keep Apple passwords, codes, certificates, and provisioning files out of source control and chat messages.

## 2. Prepare and link the project

Open PowerShell:

```powershell
Set-Location 'C:\Repos\WorkoutApp'
npm ci
npm run typecheck
npm run lint
npm test
npx expo-doctor
npx eas-cli@latest login
npx eas-cli@latest project:info
```

This repository is already linked to the owner's EAS project. Keep that project, Apple team, and `com.chopton.workout.personal` bundle identifier unchanged so installing updates preserves app data.

The October 15 compatibility check reports two deferred SDK patch updates: `expo` 57.0.29 to expected 57.0.30, and `expo-router` 57.0.27 to expected 57.0.28. Expo Doctor passes 20 of 21 checks with that warning visible. Follow the [dependency maintenance brief](DEFERRED_WORK.md#dependency-security-maintenance) before claiming a clean dependency check.

The repository already includes `eas.json`. Preserve the `preview` profile's `distribution: internal` and `developmentClient: false` settings. Do not select a simulator or App Store profile for direct installation. [EAS configuration workflow](https://docs.expo.dev/build/setup/)

## 3. Register the iPhone and build

```powershell
npx eas-cli@latest device:create
```

Choose the website registration method and open its URL/QR code on your iPhone. Follow the registration-profile prompts to register that phone's UDID. Then run:

```powershell
npx eas-cli@latest build --platform ios --profile preview
```

Sign in to Apple yourself when prompted, select your developer team, allow EAS to generate/manage signing credentials, and include **both registered iPhones** in the provisioning profile. Follow the build link to see progress. Registration alone does not make an old build installable on a new phone. [Expo internal distribution](https://docs.expo.dev/build/internal-distribution/)

## 4. Install and enable Developer Mode

On the successful build's EAS page, select **Install** and open its device link in Safari on the registered iPhone. Install Workout, then open its icon. [Expo installation steps](https://docs.expo.dev/tutorial/eas/internal-distribution-builds/)

If prompted, open **Settings > Privacy & Security > Developer Mode**, turn it on, restart the phone, and confirm **Turn On** with your passcode after restart. If the setting is absent, install the build and try opening it first. [Expo's iOS Developer Mode guide](https://docs.expo.dev/guides/ios-developer-mode/)

Stop the PC's development server and test Workout in airplane mode. Create a plan, record values, wait for **Saved**, force-close, and reopen. Finish the [device checklist](DEVICE_CHECKLIST.md).

## Automatic private uploads and staged rollout

The owner follows [Firestore setup](FIREBASE.md). Public Firebase configuration is bundled; anonymous refresh tokens stay in device-only Keychain storage. Settings shows a read-only upload status and explains that data uploads to the owner's private database. Local **Saved** remains independent.

Before enabling automatic enrollment, install the App Check build on both phones and open each online. Verify production App Attest tokens in Firebase App Check metrics. Then enforce App Check for Firestore, verify missing/invalid tokens are rejected by the real service, and run the documented owner command to enable enrollment. Until that sequence finishes, a new installation can record locally while uploads wait. Do not enforce App Check while either phone still needs the old binary for uploads.

After enabling, keep each phone open online until the initial history finishes. Verify separate UID namespaces, the completion marker, and a subsequent incremental edit from both phones in the owner console. All client reads stay denied. Firestore is an owner reporting copy; it never restores app data.

## Verify this release

Home's **+** opens **Workout Plans**. Create and edit there, choose Weekly or Every 2 weeks, and review the dated two-week preview. Existing custom schedules remain unchanged until their recurrence is explicitly changed. Record working and optional warm-up sets, then check the next-workout recommendation in read-only Analytics. Enter optional body-weight measurements only in Settings; expand **Adjust weight increments** when needed. No effort rating is required.

Install over the existing app rather than uninstalling so the version 5 migration can preserve its journal, credentials, and in-flight uploads. The current interface has no JSON backup/import/export or cloud restore workflow. Earlier release notes about those controls describe the prior interface; underlying versioned validation and internal migration safeguards remain.

## Updates, signing expiry, and a second person

Install native updates over the existing app using the same bundle identifier and Apple team. Do not uninstall first; uninstalling removes the local journal. For preview builds configured with EAS Update, use the `preview` channel/environment and fingerprint runtime policy. For compatible JavaScript/assets, the owner can publish to an already installed OTA-enabled preview build with:

```powershell
npx eas-cli@latest update --channel preview --environment preview --platform ios --message "Workout interface update"
```

Only compatible builds receive the update; native dependency or runtime changes require a new preview build. This guide does not publish an update or establish that the installed phone supports OTA. Native builds, credentials, and device validation remain owner steps. [EAS Update](https://docs.expo.dev/eas-update/getting-started/) · [Update environments](https://docs.expo.dev/eas/environment-variables/usage/#using-environment-variables-with-eas-update)

Ad hoc signing is not permanent. Inspect the actual provisioning/certificate expiration dates with:

```powershell
npx eas-cli@latest credentials --platform ios
```

Rebuild or re-sign with valid credentials and install before the signing expiry. Provisioning profiles normally expire after 12 months, but an existing profile/certificate can have less time remaining when a build is created. Keep the membership current. [Expo signing credentials](https://docs.expo.dev/app-signing/app-credentials/)

For the second person, run `device:create` for their iPhone, then create a new preview build including both devices, or re-sign an existing build:

```powershell
npx eas-cli@latest build:resign --platform ios
```

Give them that newly signed build's installation link. Their journal starts empty and stays separate. Each new installation automatically creates its own account and namespace. No codes are shared. Reinstalling starts a fresh local journal and identity; previous cloud records remain available only to owner analysis. Internal build links can allow access without an Expo login by default; change this in the project's Expo settings if desired. Newly enrolled/renewed Apple accounts can encounter Apple's 24–72-hour processing delay for a new device; rebuild/re-sign after it clears. [Device registration and access](https://docs.expo.dev/build/internal-distribution/)

## Development preview and troubleshooting

For live code changes, make a `development` build instead and run:

```powershell
npx eas-cli@latest build --platform ios --profile development
npx expo start --dev-client
```

A development build uses a running development server; use `preview` for everyday standalone use. Expo Go is a separate development app and must support this project's SDK 57 and native modules. It does not prove that the standalone app's deployment target or signing works. [Expo development environments](https://docs.expo.dev/get-started/set-up-your-environment/)

Expo Go cannot load this app's native Firebase modules. Use a development build or the standalone preview build. Production App Attest requires a physical device; do not add debug tokens to production configuration.

If installation fails, check iOS version, selected UDID, Developer Mode, Apple device-processing status, and signing expiry. If the app asks for a development server, install a `preview` build. Keep the existing installation when troubleshooting so its local data remains available.


## October 22 Settings and offline comparisons

This change adds no native dependency. Its JavaScript and bundled reference tables can use an OTA update only on an installed binary with the matching runtime. It does not replace the new App Check native installation or the pending attestation/enforcement rollout described above. No update was published during source delivery.

Install updates over the existing app to preserve local workouts. In Settings, choose Female or Male and save the profile; the button confirms ✓ Saved after local persistence. Record body weight using the compact input; entering another value today updates today’s record. Expand Change date or History only when needed. Analytics uses downloaded-at-build-time aggregate tables offline; phones never request benchmark or workout records from Firestore. The optional competitor line appears under Estimated strength for barbell squat, bench press and deadlift.
