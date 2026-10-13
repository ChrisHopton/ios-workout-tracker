# Private Google Sheets sync

The app keeps its working data on the phone. This optional connection uploads each phone's profile, exercises, plans, schedule revisions, workouts, and sets to one private Google spreadsheet. It does not download records or combine the two phones' local histories. Each phone has a separate UUID and secret token. The spreadsheet owner can see uploaded profile fields, including optional age, gender, and height, alongside workout data.

Only the spreadsheet owner signs in to Google during setup. App users paste separate connection codes and do not sign in to Google. Keep the spreadsheet's General access set to **Restricted**. Never publish the spreadsheet, enable anonymous sharing, or put connection codes, token hashes, or the spreadsheet ID in the app bundle or a repository.

## 1. Create the owner's Apps Script project

1. Sign in to the owner's Google account and create a standalone project at [Apps Script](https://script.google.com/home). Use a personal Google account if the organization's administrator prohibits anonymous web apps.
2. Replace `Code.gs` with this repository's `server/Code.gs`.
3. In **Project Settings**, enable **Show appsscript.json manifest file in editor**. Replace that file with `server/appsscript.json`.
4. In the editor's **Services**, add **Google Sheets API**, identifier **Sheets**, version **v4**. The manifest also declares this advanced service. If the script uses a standard Google Cloud project, enable the Google Sheets API in that Cloud project as well. [Advanced Sheets service](https://developers.google.com/apps-script/advanced/sheets), [enabling advanced services](https://developers.google.com/apps-script/guides/services/advanced#enable_advanced_services).
5. Select `initializeWorkbook` in the function picker and click **Run**. Authorize spreadsheet permissions as the owner. This creates a spreadsheet named **Workout**, records its ID in Script Properties, creates the managed tabs, freezes headers, protects them, and hides `_Sync`.
6. Open **Project Settings → Script Properties**. The `WORKOUT_SPREADSHEET_ID` property contains the spreadsheet ID. Open that spreadsheet from Google Drive and confirm **Share → General access → Restricted**. To use an existing private workbook that the deploying account owns, set this property to its ID before initialization. Existing managed tabs must have the exact expected headers; initialization preserves their data.

Managed tabs are **People**, **Exercises**, **Plans**, **Schedules**, **Workouts**, and **Sets**. `_Sync` is a permanent revision ledger, including deletion markers. Do not edit or delete its rows. Use the default blank tab or new tabs for charts, formulas, pivots, and manual analysis. Managed tabs are protected against other editors; the owner can still edit them, so treat them as server-owned data. Sorting data rows is supported because the server locates row keys afresh on every request. Keep the header row at the top.

Every managed data row starts with **Row key** and **Device ID**. **People** maps Device ID to the editable phone label and profile. Other tabs use Device ID, so renaming a phone does not rewrite history. Plans, Schedules, and Sets have a **Row type** for related child rows; null cells mark columns that do not apply to that row type. Workouts include finished and in-progress sessions with their status.

## 2. Deploy the web app

1. Choose **Deploy → New deployment → Web app**.
2. Set **Execute as** to **Me**, the owner. Set **Who has access** to **Anyone**, including people who are not signed in. The manifest uses `USER_DEPLOYING` and `ANYONE_ANONYMOUS`. If the account cannot offer anonymous access, this setup cannot provide access without Google sign-in; use an account whose policy allows it. [Web app manifest](https://developers.google.com/apps-script/manifest/web-app-api-executable).
3. Deploy and copy the URL ending in **/exec**. Do not use the editor-only **/dev** URL. The script runs under the owner's authorization and writes the private spreadsheet. [Web apps](https://developers.google.com/apps-script/guides/web).
4. Visiting `/exec` displays only a generic JSON health response. It does not show data or confirm a phone's token.

After server changes, use **Deploy → Manage deployments → Edit → New version → Deploy**. Editing code alone does not update the deployed version. Keep the same deployment when possible so phones retain their endpoint.

## 3. Generate the two private connection codes

In Windows PowerShell from the repository, run:

```powershell
npm run sheets:setup -- --endpoint "https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec" --output "$env:USERPROFILE\.workout-sync\devices.json"
```

The utility generates two UUIDs and separate 32-byte random tokens. It writes a private JSON file outside the repository and prints only its path. It refuses repository-contained output paths and existing files; use `--force` only to deliberately replace an existing private file. Without `--output`, it chooses a unique filename under `%USERPROFILE%\.workout-sync`. Use `--devices 1` for one phone.

The file contains:

- `scriptProperties.WORKOUT_DEVICES`: a JSON **string** containing device IDs and SHA-256 token hashes. Copy its decoded string value as the Script Property value. The private file escapes inner quotes for JSON; do not copy those backslashes or the enclosing quotes into Google.
- `devices`: matching device IDs and secret `WORKOUT1.` connection codes.

Open the file locally with a trusted text editor. In **Project Settings → Script Properties**, create **WORKOUT_DEVICES** and paste the array value. Its shape is:

```json
[{"deviceId":"PHONE_UUID_1","tokenHash":"64_LOWERCASE_HEX_CHARACTERS"},{"deviceId":"PHONE_UUID_2","tokenHash":"64_LOWERCASE_HEX_CHARACTERS"}]
```

Use the generated IDs and hashes. Store hashes only, never tokens, in Script Properties. At most two devices are accepted. Property changes take effect for subsequent requests without a new deployment. Keep the private setup file in a folder only your Windows account can access; Windows permissions depend on that folder's inherited ACL. Keep it out of shared folders, Git, issue trackers, and public links.

## 4. Connect and verify on native phones

1. Give each person their own `setupCode` privately. In the app's settings, paste that phone's code into the Google Sheets connection control and choose a recognizable phone label. This setting supplies the label even when iOS exposes only the generic name **iPhone**.
2. Connect online. A successful handshake validates the token and returns only that device's latest server revision. The app stores the connection in secure storage and uploads local data through its persistent upload queue.
3. Open the private spreadsheet as owner. Check People has the correct device ID and phone label, and other rows use that Device ID.
4. On a real native phone, create a workout, record a set, finish it, retry sync, and check there is one row per key. Edit a completed set and check its row updates. Rename an exercise and check an older session preserves its recorded exercise snapshot. Delete a local record and check its visible row clears while `_Sync` retains its latest revision and Deleted marker.
5. Repeat with the second phone's different code. Device ID keeps their rows separate even when source exercise or workout IDs happen to match.
6. Go offline, save a workout, close and reopen the app, reconnect, and retry. Pending uploads must survive restart. Uploads run while the app is active and may wait until its next opening.

Google's Content Service redirects replies to a temporary `script.googleusercontent.com` URL. Native uploads must follow that redirect and parse the final JSON acknowledgment. Browser health checks and mocked tests cannot establish that the deployed endpoint works from an iPhone. Complete the native checks before relying on sync. [Content Service redirects](https://developers.google.com/apps-script/guides/content#redirects).

## Revoke, rotate, or replace a phone

To revoke access, remove the device's entry from **WORKOUT_DEVICES**. Its existing rows remain. Disconnecting in the app stops that installation's uploads but does not revoke its server token or delete cloud data.

To rotate a token while keeping history, generate one code with the **same device ID**:

```powershell
npm run sheets:setup -- --endpoint "https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec" --device-id "EXISTING_PHONE_UUID" --output "$env:USERPROFILE\.workout-sync\phone-rotation.json"
```

Replace only that device's hash in **WORKOUT_DEVICES** and preserve the other phone's entry. The rotation file's array contains only the rotated device; replacing the whole property with it revokes the other phone. Give the new code privately to its user and reconnect. The old token stops working.

Before replacing a phone, export its local JSON backup. Restore the backup on the new phone **before** connecting to Sheets, then use a code with the same device ID to continue that history. A fresh installation has no remembered remote row keys, so it does not remove unknown spreadsheet rows. Connecting it under an existing device ID can still overwrite the profile or records with matching keys. This upload-only service cannot recover local history from Sheets. If a phone is lost, rotate its token. Keep old and new installations from uploading under the same device ID simultaneously.

## Reliability and troubleshooting

Requests accept at most 100 changes and 256 KiB of UTF-8 JSON, with each row below 16 KiB. Text is written as literal `stringValue` cells, so text starting with `=` does not become a formula. Credentials are validated before spreadsheet access. A script lock serializes uploads. Newer per-row revisions update data and `_Sync` together through one atomic Advanced Sheets `batchUpdate`; duplicate or older revisions are acknowledged without overwriting newer data. Failed batches acknowledge nothing. A lost response can be retried because the ledger preserves committed revisions. [Atomic batch updates](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/batchUpdate).

This is intended for two trusted phones. Invalid requests still consume anonymous Apps Script execution quota, although invalid credentials cannot access the spreadsheet. Google quotas and account policies apply. Errors expose only generic messages. Do not add request-body logging because those bodies contain tokens. [Apps Script quotas](https://developers.google.com/apps-script/guides/services/quotas).

For persistent pending uploads, check the `/exec` endpoint, deployment version, Advanced Sheets service, exact property names, matching device IDs and hashes, spreadsheet access, and managed headers. Unauthorized responses need a corrected or rotated code; busy or unavailable responses can be retried. A different deployment endpoint requires new connection codes while preserving both existing device IDs.
