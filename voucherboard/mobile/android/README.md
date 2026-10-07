# Voucherboard for Android

The Android shell for the mobile app. It hosts two WebViews, as `mobile/BRIDGE.md` describes: the planner UI from the app's assets, and a council view on `parkingpermits.lewisham.gov.uk`. The web code isn't copied into this folder. The `assembleWebAssets` task builds it into `app/build/generated/vbAssets` on every build:

| From | To (assets) |
| --- | --- |
| `mobile/www/**` | `www/` |
| `src/{zones,planner,portal,terms,model,reminders,plates}.js` | `www/core/` |
| `mobile/council/council.js`, `src/buyfill.js` | `council/` |

The build fails with "Web assets missing" if any of these files doesn't exist yet (for example `www/index.html`, `src/model.js` or `src/reminders.js`).

The app id is `com.mariusrubin.voucherboard` (reverse DNS of mariusrubin.com, the same as the iOS bundle id), set by `appId` in `app/build.gradle.kts`. The Kotlin package and `namespace` match it. The id can't change once the app is on Google Play. `versionName` is read from the extension's `manifest.json`; bump `versionCode` by hand for each Play upload.

## Files

| File | Role |
| --- | --- |
| `MainActivity.kt` | Edge-to-edge layout, insets as CSS variables, back button, lifecycle and orientation events, notification taps, the notification permission, the photo picker, camera permission and shared images. |
| `UiBridge.kt` | The UI view: assets at `https://appassets.androidplatform.net/www/`, the `vbNative` listener and every bridge command, with argument checks. |
| `CouncilView.kt` | The council view: injected scripts, the `vbCouncil` listener, the one-at-a-time request queue, the header bar, sign-in, buy and sign-out. |
| `Store.kt` | `store.*` in `SharedPreferences` (MODE_PRIVATE), one JSON text per key. |
| `Reminders.kt` | `notify.schedule`: alarms, the notification, and the boot/update receiver that reschedules. |
| `Plates.kt` | Number plate scanning: `PlateText` reads text from a photo with ML Kit (downscaled, in memory only), and `PlateScanner` is the live camera overlay for `plate.scan` with `source: "camera"`. |

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

1. In Play Console, create the app with the package name `com.mariusrubin.voucherboard` and turn on Play App Signing.
2. Make an upload key in Android Studio (**Build → Generate Signed App Bundle**). Keep the keystore in the owner's password manager: `*.jks` and `*.keystore` are ignored here, and there's no signing config in the build on purpose.
3. Bump `versionCode`, then build a signed release bundle (`app-release.aab`) the same way.
4. **Testing → Internal testing → Create new release**, upload the bundle, add testers by email list, and share the opt-in link.
5. Before any wider track, fill in the Data safety form (no data collected or shared; nothing leaves the device except requests to the council site) and the app content declarations. Never publish or send for review automatically; the owner does that in the console.

## Not checked by a build

This project was written on a machine without the Android SDK or access to Google's Maven repository, so it has never been compiled or run. The Gradle wrapper was generated offline with the local Gradle 8.14.3. Check these first in Android Studio:

- **Versions:** AGP 8.11.1, Kotlin 2.1.21, `core-ktx` 1.16.0, `activity-ktx` 1.10.1, `webkit` 1.14.0, ML Kit `text-recognition` 16.0.1, CameraX 1.4.2 (all five artifacts, including `camera-mlkit-vision`). Any recent stable set that works with compileSdk 35 is fine. If `camera-mlkit-vision` has no stable release at the CameraX version, use its newest release at the same version line.
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

## Number plate scanning: check on first build

`plate.scan` and `plate.shared` (BRIDGE.md, "Number plate scanning") have never run. Check:

- **No telemetry.** The manifest removes ML Kit's `datatransport` services and receiver with `tools:node="remove"`. Confirm they're gone from the merged manifest (Android Studio, `AndroidManifest.xml` → **Merged Manifest**, or `app/build/intermediates/merged_manifests/`). Then watch the app's traffic while scanning from photos, the camera and a shared image, with a proxy such as mitmproxy or HTTP Toolkit, or `adb shell dumpsys netstats`, and Play's pre-launch report. The only host contacted should be `parkingpermits.lewisham.gov.uk`. Nothing should go to `firebaselogging*.googleapis.com`, `play.googleapis.com` or any other Google host. Terms section 12 depends on this; if anything leaks, stop and fix it before any release.
- **Bundled model.** The APK should contain the Latin model, and scanning should work in flight mode on first use.
- **Photos:** the picker opens with no permission prompt, cancelling returns `{ cancelled: true }`, and a large or rotated photo (portrait JPEG, HEIC) reads correctly. On Android 8.1 and below, rotation comes from EXIF and decoding uses `inSampleSize`.
- **Camera:** the first use asks for the camera permission; refusing rejects with `"camera-denied"`, and later uses reject at once. Boxes should line up with the text in the preview, in portrait and landscape (the activity isn't recreated on rotation). Tapping a box, **Use these**, **Cancel** and the back button all close the scanner and release the camera (the camera indicator goes off).
- **Analysis size:** 1280×720 is asked for, so plates a few metres away can be read. Check speed on an older phone.
- **Sharing in:** share a photo from Google Photos and from Files, with the app closed and open. The UI should get `plate.shared` once. With `singleTop`, a share may start a second Voucherboard in the sharing app's task; check that this behaves, or move sharing to its own launch mode.
- **Errors:** a second `plate.scan` while one is open rejects with `"busy"`. A photo that can't be decoded or read rejects with `"unavailable"`; a shared one that can't be read sends `plate.shared` with no lines.
- **Data safety:** the camera and photos are used on the device only and nothing is collected. Declare that in Play Console.
