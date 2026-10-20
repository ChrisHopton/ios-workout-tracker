# Install Workout on your iPhone from Windows

The `preview` profile creates a standalone private iPhone app with its JavaScript and assets bundled. After installation, recording and analytics work offline with your Windows PC switched off. This is an EAS internal distribution build. [Expo's preview-build guide](https://docs.expo.dev/tutorial/eas/internal-distribution-builds/)

These instructions are prepared for the owner to run. No Apple account has been enrolled, no device has been registered, and no signed iOS build has been installed as part of writing this guide. Optional Firestore setup is separate from Apple signing; app users paste private codes and do not see a Google sign-in screen.

The app uses native `expo-secure-store`, `expo-crypto`, and `expo-updates`. Install a new EAS binary if the phone's current build lacks any of these modules or has a different runtime fingerprint. An over-the-air JavaScript update cannot add a missing native module. [Expo native rebuild guidance](https://docs.expo.dev/develop/development-builds/introduction/#rebuild-when-native-code-changes)

## 1. Accounts and prerequisites

- Your iPhone must run **iOS 16.4 or newer**.
- Use an Expo account and an active Apple Developer Program membership. Apple lists **US $99 per membership year**, with regional pricing. You complete enrollment, payment, Apple sign-in, and two-factor prompts yourself. [Apple enrollment](https://developer.apple.com/programs/enroll/)
- EAS builds run in Expo's cloud. Build availability, quotas, and paid options depend on your account; check before starting a build. [EAS build setup](https://docs.expo.dev/build/setup/)
- Install Node.js 22.18 or a newer supported LTS release and Git for Windows if needed. Keep Apple passwords, codes, certificates, and provisioning files out of source control and chat messages.

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
npx eas-cli@latest init
```

Select your own Expo account/project when prompted. `init` links the folder to your EAS project and records its project ID. Keep that configuration for future builds. Before the first build, review `expo.ios.bundleIdentifier` in `app.json`; use a stable identifier you own, for example `com.yourname.workout`. If Apple reports that the identifier is taken, change it before installing your first build. Keep it unchanged for later updates.

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

Sign in to Apple yourself when prompted, select your developer team, allow EAS to generate/manage signing credentials, and include your registered iPhone in the provisioning profile. Follow the build link to see progress. Registration alone does not make an old build installable on a new phone. [Expo internal distribution](https://docs.expo.dev/build/internal-distribution/)

## 4. Install and enable Developer Mode

On the successful build's EAS page, select **Install** and open its device link in Safari on the registered iPhone. Install Workout, then open its icon. [Expo installation steps](https://docs.expo.dev/tutorial/eas/internal-distribution-builds/)

If prompted, open **Settings > Privacy & Security > Developer Mode**, turn it on, restart the phone, and confirm **Turn On** with your passcode after restart. If the setting is absent, install the build and try opening it first. [Expo's iOS Developer Mode guide](https://docs.expo.dev/guides/ios-developer-mode/)

Stop the PC's development server and test Workout in airplane mode. Create a plan, record values, wait for **Saved**, force-close, and reopen. Finish the [device checklist](DEVICE_CHECKLIST.md).

## Optional private Firestore connection

Follow [Private Firestore uploads](FIREBASE.md). The owner configures Firebase Authentication, deploys the upload-only rules, and issues separate private codes for the two authorized phones. The project is ready on Spark without billing in `us-central1`: device authentication, rules, indexes, and two private codes are provisioned, and synthetic live REST verification passed. Each installed iPhone still needs its first connection and device acceptance checks. Keep real codes and cloud/account identifiers outside source files.

In Workout's **Settings > Database uploads**, choose **Connect Database**, paste that phone's private code, set a recognizable phone label, review the profile and full-history upload explanation, and explicitly consent. There is no account sign-in screen for app users. Credentials are not part of the EAS build, app bundle, or public environment variables.

Connecting binds this installation to its upload generation before uploading records. Settings shows upload status, pending records, last upload, and incomplete-history notices. **Manage connection** reveals rename, replacement-code, and disconnect controls. Recording and analytics work offline; pending changes retry while the app is open. **Saved** confirms local durability, while **Up to date** describes uploads.

Complete the live Firebase and two-phone checks in the [device checklist](DEVICE_CHECKLIST.md). The browser demo does not contact Firebase. Firestore is an upload-only reporting copy for owner analysis. The app never reads or restores cloud history, and a new installation starts with a fresh local journal.

Before upgrading an existing installation to SQLite schema version 5, the native app preserves a validated journal copy in its original schema in private storage. This automatic migration safeguard remains internal; there is no in-app export or recovery control.

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

Give them that newly signed build's installation link. Their journal starts empty and stays separate. If both phones upload to Firestore, the owner must issue a different device code and phone label for each; never copy one phone's code to the other. A replacement installation needs a fresh upload generation and starts locally fresh; previous cloud records remain available only to owner analysis. Internal build links can allow access without an Expo login by default; change this in the project's Expo settings if desired. Newly enrolled/renewed Apple accounts can encounter Apple's 24–72-hour processing delay for a new device; rebuild/re-sign after it clears. [Device registration and access](https://docs.expo.dev/build/internal-distribution/)

## Development preview and troubleshooting

For live code changes, make a `development` build instead and run:

```powershell
npx eas-cli@latest build --platform ios --profile development
npx expo start --dev-client
```

A development build uses a running development server; use `preview` for everyday standalone use. Expo Go is a separate development app and must support this project's SDK 57 and native modules. It does not prove that the standalone app's deployment target or signing works. [Expo development environments](https://docs.expo.dev/get-started/set-up-your-environment/)

If experimenting with Expo Go on an iPhone, sign into the same Expo account in both Expo Go and the local CLI (`npx expo login`). Connect PC and phone to the same Wi-Fi; a tunnel (`npx expo start --tunnel`) can help on restrictive networks. [Expo device connection guide](https://docs.expo.dev/get-started/start-developing/)

If installation fails, check iOS version, selected UDID, Developer Mode, Apple device-processing status, and signing expiry. If the app asks for a development server, install a `preview` build. Keep the existing installation when troubleshooting so its local data remains available.
