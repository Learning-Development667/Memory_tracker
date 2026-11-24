# Daybook: the Capacitor, TestFlight and Google Play build steps

Notes from Daybook (v487, 24 November 2026) for reuse in another app. File names refer to the `Mark_Medical` repository. Every build runs in GitHub Actions: no Mac is needed day to day.

## How the app is wrapped

- The web app lives at the repository root and is served live by GitHub Pages. The iPhone and Android apps are a **Capacitor 8** shell in `native/` with **a copy of the web files inside them**. So the website updates on every push, but the phone apps only change when a new build is made.
- `native/capacitor.config.json`: `appId` `uk.co.mark1apps.daybook`, `appName` `Daybook`, `webDir` `www`. The iPhone build includes only the plugins it needs (`includePlugins`), so Android does not claim Health permissions it never uses.
- `native/scripts/copy-web.mjs` empties `native/www` and copies `index.html`, `scripts.js`, `styles.css`, `report.js`, `sw.js`, `manifest.json`, `config.js` and the folders `icons`, `guide`, `data`, `vendor`. `www` is not kept in git.
- `native/package.json` scripts: `copy-web`, and `sync` (copy then `npx cap sync`). Plugins pinned to exact versions: `@capacitor/core`, `ios` and `android` 8.6.0, `app`, `filesystem`, `share`, `@capacitor-firebase/messaging` (push), `@capgo/capacitor-health` (Apple Health).
- The bridge must allow the apps' origins: `capacitor://localhost` (iPhone) and `https://localhost` (Android).

### On a Mac, by hand (only for setting up or debugging)

1. `cd native && npm install`
2. `npm run sync` (copies the web files and updates the Xcode and Android projects)
3. `npx cap open ios`, choose the company team under Signing, and run it on an iPhone.

## iPhone: build and send to TestFlight

Workflow: `.github/workflows/ios-testflight.yml`, "iPhone app to TestFlight". Started by hand (Actions tab, Run workflow), never on push.

### Secrets it needs (GitHub repository secrets)

| Secret | What |
| --- | --- |
| `APP_STORE_CONNECT_API_KEY` | The text of the App Store Connect API key (`.p8` file) |
| `APP_STORE_CONNECT_KEY_ID` | That key's id |
| `APP_STORE_CONNECT_ISSUER_ID` | The issuer id from App Store Connect, Users and Access, Integrations |
| `APPLE_TEAM_ID` | The Apple Developer team id |

### Job 1: build (Mac runner)

1. Runner `xcode-27`, 45-minute limit. Picks the released Xcode 27.1 with `xcode-select` (never a release candidate: App Store Connect refuses those; the newest SDK is needed or new iPhones letterbox the app).
2. Node 22; in `native/`: `npm ci && node scripts/copy-web.mjs && npx cap sync ios`.
3. Writes the `.p8` key to a temporary folder.
4. Archives **unsigned**, letting Xcode manage signing through the API key:

   ```
   xcodebuild -project App.xcodeproj -scheme App -configuration Release \
     -destination 'generic/platform=iOS' -archivePath "$RUNNER_TEMP/Daybook.xcarchive" \
     -allowProvisioningUpdates \
     -authenticationKeyPath "$RUNNER_TEMP/keys/AuthKey.p8" -authenticationKeyID "$KEY_ID" -authenticationKeyIssuerID "$ISSUER" \
     DEVELOPMENT_TEAM="$TEAM" CODE_SIGN_STYLE=Automatic CODE_SIGNING_ALLOWED=NO \
     CURRENT_PROJECT_VERSION="${{ github.run_number }}" archive
   ```

   The build number is the workflow's run number, so it always goes up.
5. Because the archive is unsigned it carries no entitlements, so an ad-hoc signature adds them (`codesign --force --sign - --entitlements native/ios/App/App/App.entitlements`). Without this, push notifications (`aps-environment`) and HealthKit are lost.
6. Exports and uploads in one go: `xcodebuild -exportArchive ... -exportOptionsPlist ExportOptions.plist -allowProvisioningUpdates` with the same key flags. `ExportOptions.plist` has `method` `app-store-connect`, `destination` `upload`, `signingStyle` `automatic`, `manageAppVersionAndBuildNumber` false. The workflow adds the `teamID` at run time.
7. Deletes the key, even if a step failed.

### Job 2: give it to the testers (Linux runner, so the wait costs no Mac minutes)

1. `node tools/release_notes.mjs` writes the notes from the newest What's new batch in `scripts.js` (if it is from the last three days, else `native/ios/what-to-test.txt`).
2. `node tools/testflight_group.mjs` uses the App Store Connect API to wait for Apple's processing, set What to Test, add the build to the external group "Circle Testers" and ask for beta review. It prints ids and states only.

### Settings in the iPhone project worth copying

- `ITSAppUsesNonExemptEncryption` false (HTTPS only), so there is no export-compliance question on each build.
- iPhone only (`TARGETED_DEVICE_FAMILY = 1`), so there are no iPad screenshots or iPad review.
- Info.plist strings saying why it asks for the camera, microphone, Photos, speech and Health (`NSHealthShareUsageDescription`, and the update one saying it never writes).
- `GoogleService-Info.plist` for push through Firebase Messaging, with auto-initialisation and Analytics off.

## Android: build and send to Google Play

Workflow: `.github/workflows/android-play.yml`, "Android app for Google Play". Started by hand. One option, `hold_for_review` (upload but do not send for review).

### Secrets

| Secret | What |
| --- | --- |
| `ANDROID_KEYSTORE_PASSWORD` | A long password (20 characters or more) kept in the password manager |
| `PLAY_SERVICE_ACCOUNT_JSON` | A Google Cloud service account's JSON key, invited to Play Console with release rights on this app |

### Steps (Linux runner)

1. Node 22 and Java 21 (Temurin).
2. **Upload key, first run only:** makes a 4096-bit key with `keytool`, encrypts it with the password (`openssl enc -aes-256-cbc -pbkdf2 -iter 600000`) and commits only the encrypted file, `native/android/upload-key.p12.enc`. Every later run decrypts it, so the key never changes. **Never delete that file or change the password**, or Google Play refuses the next upload until the key is reset with Play support.
3. `npm ci && node scripts/copy-web.mjs && npx cap sync android`.
4. Decrypts the key, then `./gradlew --no-daemon bundleRelease` with `ANDROID_VERSION_CODE` set to the run number. Deletes the key afterwards.
5. Keeps the `.aab` on the run for 7 days (for a manual upload if needed).
6. Writes the Play notes (`tools/release_notes.mjs`, 500 characters, whole items only).
7. Uploads to the **internal** track with `r0adkll/upload-google-play` (pinned to a commit), `status: completed`.
8. Puts the same build on **open testing** too (`tools/play_promote.mjs`).

### After every Android upload

- Run the Google Play status workflow (`tools/play_status.mjs`) and confirm each release says `completed`, not `draft`.
- Google Play does not email when a review is approved: check Play Console, the app, Publishing overview.

## The bridge deploy (for completeness)

`.github/workflows/deploy-worker.yml` runs on any push to `main` that touches `worker/`, deploys with `cloudflare/wrangler-action` (Wrangler pinned), and sets each secret from the GitHub secret of the same name.

## After a build

1. Set that phone's number in `latest.json` to the build's app version. The app reads it to show an "update available" banner. For iPhone, wait until TestFlight has processed the build.
2. Testers get a notification for every build, so Daybook builds at most once a day, with everything that landed that day.

## To set this up for a new app

1. `npm init` in `native/`, add Capacitor (`@capacitor/core`, `cli`, `ios`, `android`), `npx cap init`, set `webDir`, `npx cap add ios`, `npx cap add android`, and a copy script for your web files.
2. Apple: an App Store Connect app record with the bundle id, an API key (App Manager role), and the four secrets above. Create the TestFlight group and add testers.
3. Google Play: the app in Play Console, the first `.aab` uploaded by hand, then a service account with release rights and the two secrets above.
4. Copy the two workflows, change the bundle id, app name and group name, and run each once by hand.
