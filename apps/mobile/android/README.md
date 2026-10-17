# Voucherboard for Android

The Android app. Jetpack Compose draws the screens (`app/src/main/java/com/mariusrubin/voucherboard/app`) over the
shared engine, which runs in an invisible WebView (`apps/mobile/www/engine.html`). An activity hosts both, plus the council
view, and implements the native side of the bridge in `apps/mobile/BRIDGE.md`. Android 8.0 (API 26) and later, targeting
API 36, Material 3.

It's the same app as iOS, file for file: each SwiftUI file in `apps/mobile/ios/Voucherboard/App` has a Compose file of the
same name here, with the same engine calls, wording and behaviour. Change both together (CLAUDE.md, "No drift between
iOS and Android"); `test/shells.test.js` checks what it can.

**Built and run in the emulator only** (Android 16, Pixel 8), in demo mode. Not yet tried on a phone or against the
live council site. See "Check on a phone" below.

The app id is `com.mariusrubin.voucherboard` (reverse DNS of mariusrubin.com, the same as the iOS bundle id), set by
`appId` in `app/build.gradle.kts`. It can't change once the app is on Google Play. `versionName` is read from the
extension's `manifest.json`; `versionCode` comes from CI's run number (`-PvbVersionCode=`), and is 1 locally.

## Files

| File | Role | iOS counterpart |
| --- | --- | --- |
| `MainActivity.kt` | Hosts the Compose screens, the engine view and the council view; edge to edge, back button, lifecycle and orientation events, notification and live-notification taps, permissions, the photo picker, camera and shared images. Appearance (More > Appearance, kept in `Store`). | `MainViewController.swift`, `AppDelegate.swift`, `SceneDelegate.swift` |
| `Bridge.kt` | The engine view: assets at `https://appassets.androidplatform.net/www/engine.html`, the `vbNative` listener and every bridge command, with argument checks; the `vbEngine` listener for engine answers. | `Bridge.swift` |
| `CouncilView.kt` | Council view: header, navigation rules (off-site links and registration open in the browser), `council.fetch` queue, sign-in, buy, sign-out. | `CouncilController.swift` |
| `Store.kt` | `store.*` in `SharedPreferences` (MODE_PRIVATE), one JSON text per key. Excluded from backup and device transfer. | `Store.swift` |
| `Reminders.kt` | `notify.schedule`: alarms, the notification, and the boot/update receiver that reschedules. | `Notifications.swift` |
| `LiveVisits.kt` | Live Updates: one per visitor parked now (up to 3), with a countdown chip in the status bar, a progress bar with a segment per voucher, and Extend. Off with More > Live Updates. | `LiveVisits.swift`, `VoucherboardLive/` |
| `Plates.kt` | `plate.scan`: `PlateText` reads text with ML Kit (downscaled, in memory only), and `PlateScanner` is the live camera scanner. Sharing an image in is an intent filter on the activity. | `PlateScanner.swift`, `Shared/PlateText.swift`, `VoucherboardShare/` |
| `PlateHighlights.kt` | The live scanner's highlights: a blue ring, dimmed surround and "Tap to use" chip on plate-like text, a dashed outline on other text. | `PlateHighlights.swift` |
| `app/AppModel.kt` | `EngineClient` (`VBEngine.call` through `evaluateJavascript` and the `vbEngine` listener), and the screen state: tab, sheet, toast. Engine events bump `version`, and each screen fetches its view again. | `App/AppModel.swift` |
| `app/Models.kt` | The engine's view models (`views.js`) as `@Serializable` classes. | `App/Models.swift` |
| `app/RootView.kt` | Terms and sign-in gates, tabs, plan tray, sheets, toast. A phone turned sideways shows the board. | `App/RootView.swift` |
| `app/*Screen.kt`, `*Sheet.kt`, `Sheets.kt` | Today, Calendar and day view, board, Bookings, Vehicles, More and terms; quick-book, plan, entry, booking, bulk, new favourite, review and run. | The same names |
| `app/Components.kt` | Colours (light and dark), plate badge, pills, rows, grouped lists, sheets, time menu, toast, swipe, marquee. | `App/Components.swift` |

Sheets are drawn inside the activity's window, not as dialogs, so the council view and the camera scanner (Android
views added above the Compose view) can cover them, as on iOS.

The web code isn't copied into this folder. The `assembleWebAssets` task builds it into `app/build/generated/vbAssets`
on every build, with the same file list as the iOS copy script:

| From | To (assets) |
| --- | --- |
| `apps/mobile/www/**` | `www/` |
| `extension/src/{zones,planner,portal,terms,model,reminders,plates}.js` | `www/core/` |
| `apps/mobile/council/council.js`, `extension/src/buyfill.js` | `council/` |

## Open and build

1. Android Studio (installed with Homebrew: `brew install --cask android-studio`). The SDK is in
   `~/Library/Android/sdk`, with Android 16 and 17 platforms, and a `vb36` emulator (Pixel 8, Android 16, Google Play).
2. **File > Open** and choose `apps/mobile/android`. `local.properties` points at the SDK; it's ignored by git.
3. Let Gradle sync (the wrapper uses Gradle 9.8.1; AGP 9.4, Kotlin 2.4, Compose BOM 2026.09). Use JDK 21: **Settings >
   Build, Execution, Deployment > Build Tools > Gradle > Gradle JDK**.
4. Run the `app` configuration on the `vb36` emulator or a phone. From a terminal, `scripts/dev.sh android` (from the
   repository root) builds, starts the emulator, installs and launches (see
   [docs/DEVELOPING.md](../../../docs/DEVELOPING.md)). By hand:

   ```sh
   cd apps/mobile/android
   export JAVA_HOME=$(/usr/libexec/java_home -v 21) ANDROID_HOME=~/Library/Android/sdk
   ./gradlew :app:assembleDebug :app:lintDebug
   $ANDROID_HOME/emulator/emulator -avd vb36 &
   $ANDROID_HOME/platform-tools/adb install -r app/build/outputs/apk/debug/app-debug.apk
   ```

5. Accept the terms, then **Try the demo** to see every screen without the council site.

Debug builds allow Chrome DevTools on both WebViews: open `chrome://inspect` on the computer with the emulator or phone
attached. The engine page is `engine.html`; `VBEngine.call("home")` in its console shows what the screens get.

## Sideload onto a phone

1. On the phone: **Settings > About phone**, tap **Build number** seven times, then turn on **Developer options > USB
   debugging**.
2. Connect it, accept the prompt, then `adb install -r app/build/outputs/apk/debug/app-debug.apk`.

To try exact reminders on Android 14 or later, turn on **Settings > Apps > Voucherboard > Alarms & reminders**. Without
it, reminders can arrive a few minutes late.

## Google Play

Release builds are signed and uploaded by CI (`.github/workflows/android-play.yml`, called by `release.yml` when the
app's files change), after the owner approves the `google-play` environment, and only as a draft on the internal
testing track. The steps, from the developer account to
release, are in [`docs/GOOGLE_PLAY.md`](../../../docs/GOOGLE_PLAY.md), and the listing is in
[`PlayStore/`](PlayStore/README.md). There's no signing key in the repo: `*.jks` and `*.keystore` are ignored, and the
release build signs only when CI passes the upload key through `VB_UPLOAD_*` environment variables.

## Check on a phone

Besides `docs/GOOGLE_PLAY.md`'s testing step:

- **No telemetry.** The manifest removes ML Kit's `datatransport` services and receiver with `tools:node="remove"`. CI
  checks they're gone from the merged manifest. Then watch the app's traffic while scanning from photos, the camera and
  a shared image, with a proxy such as mitmproxy or HTTP Toolkit, or `adb shell dumpsys netstats`, and Play's
  pre-launch report. The only host contacted should be `parkingpermits.lewisham.gov.uk`. Nothing should go to
  `firebaselogging*.googleapis.com`, `play.googleapis.com` or any other Google host. Terms section 12 depends on this;
  if anything leaks, stop and fix it before any release.
- **Bundled model.** The APK contains the Latin model, and scanning works in flight mode on first use.
- **Hidden council view.** It sits behind the Compose view, visible, so Chromium shouldn't throttle it. Check a plan
  run with the screen on, and that `council.fetch` still works after the app has been in the background.
- **Signed-out fetches:** if loading `/Home/ApplicantPermits` ends on `/Account/Login`, `council.fetch` resolves with
  `{ status: 200, url: <login URL>, body: "" }`, so `portal.js` shows its usual "logged out" message.
- **Sign-out** calls `WebStorage.deleteAllData()`, which also clears the engine view's web storage. The engine keeps its
  state in `store.*`, so nothing is lost.
- **Notification taps** carry a per-install token, because `MainActivity` is exported. Extend opens Book a visitor; it
  doesn't book anything by itself.
- **Live Updates:** checked in the `vb361` emulator (Android 16 QPR1): Android marks it `PROMOTED_ONGOING`, the status
  bar chip counts down, and the shade shows the segmented progress bar with Extend. On a phone, check it appears after
  Book now, Extend opens Book a visitor filled in, a tap opens the booking, swiping it away keeps it away, it goes at the
  end time even with the app closed, and turning Live Updates off in Settings makes More say so. The `vb36` emulator
  (Android 16, API 36.0) predates Live Updates and shows an ordinary ongoing notification.
- **Camera scanner:** the first use asks for the camera; refusing rejects with `"camera-denied"`. Rings line up with the
  text in the preview, in portrait and landscape. Tapping a ring or chip, **Use these**, **Cancel** and Back all close
  it and release the camera (the camera indicator goes off).
- **Sharing in:** share a photo from Google Photos and from Files, with the app closed and open. Book a visitor opens
  once with the plate. With `singleTop`, a share may start a second Voucherboard in the sharing app's task; check that
  this behaves, or move sharing to its own activity.
- **Renderer killed:** `adb shell am kill` doesn't do it; use **Developer options > Don't keep activities** and the
  `chrome://inspect` "crash" to check the activity recreates and the plan is still there.
