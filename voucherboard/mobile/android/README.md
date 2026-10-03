# Voucherboard for Android

The Android shell for the mobile app. It hosts two WebViews, as `mobile/BRIDGE.md` describes: the planner UI from the app's assets, and a council view on `parkingpermits.lewisham.gov.uk`. The web code isn't copied into this folder. The `assembleWebAssets` task builds it into `app/build/generated/vbAssets` on every build:

| From | To (assets) |
| --- | --- |
| `mobile/www/**` | `www/` |
| `src/{zones,planner,portal,terms,model,reminders}.js` | `www/core/` |
| `mobile/council/council.js`, `src/buyfill.js` | `council/` |

The build fails with "Web assets missing" if any of these files doesn't exist yet (for example `www/index.html`, `src/model.js` or `src/reminders.js`).

The app id is `uk.co.voucherboard.app`, set by `appId` in `app/build.gradle.kts`. `namespace` is only the Kotlin package and can stay as it is if the id changes. `versionName` is read from the extension's `manifest.json`; bump `versionCode` by hand for each Play upload.

## Files

| File | Role |
| --- | --- |
| `MainActivity.kt` | Edge-to-edge layout, insets as CSS variables, back button, lifecycle and orientation events, notification taps, the notification permission. |
| `UiBridge.kt` | The UI view: assets at `https://appassets.androidplatform.net/www/`, the `vbNative` listener and every bridge command, with argument checks. |
| `CouncilView.kt` | The council view: injected scripts, the `vbCouncil` listener, the one-at-a-time request queue, the header bar, sign-in, buy and sign-out. |
| `Store.kt` | `store.*` in `SharedPreferences` (MODE_PRIVATE), one JSON text per key. |
| `Reminders.kt` | `notify.schedule`: alarms, the notification, and the boot/update receiver that reschedules. |

## Open and build

1. Install Android Studio (Narwhal or later) with the Android 15 (API 35) SDK.
2. **File → Open** and choose `voucherboard/mobile/android`. Android Studio writes `local.properties` with the SDK path; it's ignored by git.
3. Let Gradle sync. The wrapper downloads Gradle 8.14.3 the first time.
4. Run the `app` configuration on a device or emulator, or build from a terminal:

   ```sh
   cd voucherboard/mobile/android
   ./gradlew :app:assembleDebug
   # app/build/outputs/apk/debug/app-debug.apk
   ```

Debug builds allow Chrome DevTools on both WebViews: open `chrome://inspect` on a computer with the phone attached.

## Sideload with adb

1. On the phone: **Settings → About phone**, tap **Build number** seven times, then turn on **Developer options → USB debugging**.
2. Connect it and accept the prompt.
3. Install or update:

   ```sh
   adb devices
   adb install -r app/build/outputs/apk/debug/app-debug.apk
   ```

To try exact reminders on Android 14 or later, turn on **Settings → Apps → Voucherboard → Alarms & reminders**. Without it, reminders can arrive a few minutes late.

## Play internal testing

1. In Play Console, create the app with the package name `uk.co.voucherboard.app` and turn on Play App Signing.
2. Make an upload key in Android Studio (**Build → Generate Signed App Bundle**). Keep the keystore in the owner's password manager: `*.jks` and `*.keystore` are ignored here, and there's no signing config in the build on purpose.
3. Bump `versionCode`, then build a signed release bundle (`app-release.aab`) the same way.
4. **Testing → Internal testing → Create new release**, upload the bundle, add testers by email list, and share the opt-in link.
5. Before any wider track, fill in the Data safety form (no data collected or shared; nothing leaves the device except requests to the council site) and the app content declarations. Never publish or send for review automatically; the owner does that in the console.

## Not checked by a build

This project was written on a machine without the Android SDK or access to Google's Maven repository, so it has never been compiled or run. The Gradle wrapper was generated offline with the local Gradle 8.14.3. Check these first in Android Studio:

- **Versions:** AGP 8.11.1, Kotlin 2.1.21, `core-ktx` 1.16.0, `activity-ktx` 1.10.1, `webkit` 1.14.0. Any recent stable set that works with compileSdk 35 is fine.
- **Asset task:** `variant.sources.assets?.addGeneratedSourceDirectory(...)` and the `@Inject FileSystemOperations` task class declared in the build script.
- **Kotlin overrides** of `WebViewClient` and `WebChromeClient` use nullable parameters; that should compile against either nullability annotation.
- **Hidden council view:** it's `INVISIBLE`, not `GONE`, so it keeps a size. Chromium may still treat the page as hidden and slow its timers; requests use `fetch`, which isn't throttled, but this needs a check on a device.
- **Document-start script:** `addDocumentStartJavaScript` also runs in council-origin iframes. `council.js` returns early outside the top frame; `buyfill.js` only defines a function.
- **Signed-out fetches:** if loading `/Home/ApplicantPermits` ends on `/Account/Login`, `council.fetch` resolves with `{ status: 200, url: <login URL>, body: "" }`, so `portal.js` shows its usual "logged out" message. Other blocked pages reject with `"blocked"`.
- **Fetch while the council view is shown:** it waits for a usable council page (up to the 60-second timeout) rather than navigating away from what the user is doing.
- **Sign-out** calls `WebStorage.deleteAllData()`, which also clears the UI view's web storage. The UI keeps its state in `store.*`, so nothing is lost.
- **Notification taps** carry a per-install token, because `MainActivity` is exported. The `extend` action opens the app; it doesn't book anything by itself.
- **Boot receiver** is exported so system broadcasts reach it; it only reschedules saved reminders.
- **Theme** is light only, with dark status bar icons over the UI and light ones over the navy council header.
