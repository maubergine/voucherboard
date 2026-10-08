# Voucherboard for iOS

The iOS app. SwiftUI draws the screens (`Voucherboard/App`) over the shared engine, which runs in an invisible web view
(`mobile/www/engine.html`). UIKit hosts both, plus the council view, and implements the native side of the bridge in
`mobile/BRIDGE.md`. iOS 17+, Swift 5.9, no packages. On iOS 26 and later, buttons, the toast and the plan tray use
Liquid Glass; earlier versions get filled buttons and materials.

**Built and run in the Simulator only** (Xcode 27, iOS 27), against the test fixtures. Not yet tried on a phone or
against the live council site. See "Unsure" below for what to check first.

## Files

| File | Role |
| --- | --- |
| `project.yml` | XcodeGen spec. Bundle id, version and team live here. |
| `Voucherboard/AppDelegate.swift` | Sets the notification delegate at launch, orientation mask, small helpers. |
| `Voucherboard/SceneDelegate.swift` | Window, `app.state` events, `voucherboard://scan`, and `plate.shared` on becoming active. |
| `Voucherboard/MainViewController.swift` | Hosts the SwiftUI screens, the engine view and the council view; events to the engine, orientation, run, share, haptics. |
| `Voucherboard/App/AppModel.swift` | `EngineClient` (`VBEngine.call` through `callAsyncJavaScript`), and the screen state: tab, sheet, toast. Engine events bump `version`, and each screen fetches its view again. |
| `Voucherboard/App/Models.swift` | The engine's view models (`views.js`) as `Decodable` types. |
| `Voucherboard/App/RootView.swift` | Terms and sign-in gates, tabs, plan tray, sheets, toast. A phone turned sideways shows the board. |
| `Voucherboard/App/*Screen.swift`, `*Sheet.swift`, `Sheets.swift` | Today, Calendar and day view, board, Vehicles, More and terms; quick-book, plan, entry, booking, bulk, new favourite, review and run. |
| `Voucherboard/App/LiveVisits.swift` | Starts, updates and ends a Live Activity for each visitor parked now (up to 3), on every refresh. Off with More > Live Activity. |
| `Shared/VisitActivity.swift` | The Live Activity's attributes and state, shared by the app and `VoucherboardLive`. |
| `VoucherboardLive/VisitLiveActivity.swift` | Widget extension: the Live Activity on the Lock Screen and in the Dynamic Island. Countdown, progress and Extend (`voucherboard://extend`); a tap opens the booking (`voucherboard://visit`). |
| `Voucherboard/App/Components.swift` | Colours, plate badge, pills, rows, time menu, toast, and the Liquid Glass helpers with fallbacks. |
| `Voucherboard/Bridge.swift` | The `vb` message handler: checks arguments and runs every command. |
| `Voucherboard/CouncilController.swift` | Council view: header, navigation rules, `council.fetch` queue, sign-in, buy, sign-out. |
| `Voucherboard/Store.swift` | `store.*`: one JSON file in Application Support, excluded from backup. |
| `Voucherboard/Notifications.swift` | `notify.*`, and taps queued until the UI sends `hello`. |
| `Voucherboard/PlateScanner.swift` | `plate.scan`: photo picker, live camera scanner (VisionKit), still-photo fallback. |
| `Shared/PlateText.swift` | Text recognition with Vision, in memory. Used by the app and the share extension. |
| `Shared/SharedScan.swift` | `shared-scan.json` in the App Group: written by the extension, taken once by the app. |
| `VoucherboardShare/ShareViewController.swift` | Share extension: reads one shared picture's text and tries to open `voucherboard://scan`. |

The `www` and `council` folders aren't in this folder. A build phase copies them into the app bundle on every build:

- `mobile/www/*` to `www/`
- `src/{zones,planner,portal,terms,model,reminders,plates}.js` to `www/core/`
- `mobile/council/council.js` and `src/buyfill.js` to `council/`

The build fails if any of these is missing, or if `mobile/www/engine.html` is missing.

## Generate the project

On a Mac with Xcode 26 or later (for the iOS 26 SDK and Liquid Glass):

```sh
brew install xcodegen
cd voucherboard/mobile/ios
xcodegen
open Voucherboard.xcodeproj
```

Run `xcodegen` again after adding or removing Swift files, or after editing `project.yml`. The `.xcodeproj`, both
`Info.plist` files and both `.entitlements` files are generated, so they're git-ignored.

## Signing

There are three targets: the app (**Voucherboard**), its share extension (**VoucherboardShare**) and its Live
Activity widget (**VoucherboardLive**); both extensions are embedded in the app. Either set `DEVELOPMENT_TEAM` in
`project.yml` to your team id and regenerate, or pick the team in Xcode under **Signing & Capabilities** > **Team**
for every target. Signing is automatic.

The ids are set once, in `project.yml`:

| Setting | Value | Used for |
| --- | --- | --- |
| `APP_BUNDLE_ID` | `com.mariusrubin.voucherboard` | The app, in reverse DNS of mariusrubin.com. The extensions are `com.mariusrubin.voucherboard.share` and `com.mariusrubin.voucherboard.live`. |
| `APP_GROUP_ID` | `group.com.mariusrubin.voucherboard` | The App Group the app and the share extension share, for `shared-scan.json`. |

A bundle id can't be changed once the app is on the App Store, so register these in the Apple Developer account
before the first upload.

A team can't use an id that another team has registered; if Xcode says so, change it there and regenerate. The Swift
code reads the group from Info.plist (`VBAppGroup`), so nothing else needs editing.

**App Group.** Both bundle ids must have the App Groups capability with the same group:

- With automatic signing and a paid team, Xcode registers the group and adds it to both App IDs when it first signs.
  Check under Signing & Capabilities that **App Groups** shows the group ticked, without a red warning, on both
  targets. If it doesn't, add the group in the developer portal (Identifiers > App Groups), then enable it for both
  App IDs (Identifiers > the id > App Groups > Configure).
- A free Personal Team may not be allowed App Groups. If signing fails on that, delete the `entitlements` blocks and the
  `VoucherboardShare` dependency from `project.yml` and regenerate: everything except sharing a picture in still works.

## Run on a device (free Apple ID)

1. Xcode > Settings > Accounts: add your Apple ID. It gets a "Personal Team".
2. Choose that team under Signing & Capabilities.
3. Connect the iPhone, unlock it, and trust the Mac. On iOS 16+, turn on Settings > Privacy & Security >
   **Developer Mode** and restart when asked.
4. Choose the phone as the run destination and press Run.
5. The first time, trust the developer on the phone: Settings > General > VPN & Device Management.

Free provisioning profiles last **7 days**. After that the app won't open until you run it from Xcode again. Your
saved plans survive a re-install over the top, but not deleting the app.

Debug builds make both web views inspectable in Safari (Develop menu > your device), on iOS 16.4 and later.

## First build: what to check

Besides the "Unsure" list below:

1. Both targets build, and `Voucherboard.app/PlugIns/VoucherboardShare.appex` is in the built app.
2. `www/core/plates.js` is in the built app.
3. **Scan from photos** (Vehicles or a booking's plate field): the photo picker opens without asking for photo
   access, and a picture of a plate fills in the plate.
4. **Scan with the camera:** iOS asks for camera access the first time, with the usage text. The live scanner
   highlights text; tapping the plate returns it, **Use these** returns everything on screen, **Cancel** returns
   nothing. Deny camera access in Settings and try again: the UI should say camera access is off.
5. **Share a picture in:** in Photos, share a picture of a plate and choose Voucherboard. The extension says "Plate
   text read. Opening Voucherboard…" and the app opens with the plate. If it says "Open Voucherboard to choose the
   plate", open the app within 10 minutes: the plate should arrive then.
6. No image files: after a few scans, the app container (Xcode > Devices > Download Container) and the App Group hold no
   pictures, and `shared-scan.json` is gone once the app has read it.

## TestFlight and the App Store

Builds for TestFlight and the App Store are signed and uploaded by CI (`.github/workflows/ios.yml`), after the owner
approves the `app-store` environment. The steps, from enrolling to release, are in
[`docs/APP_STORE.md`](../../../docs/APP_STORE.md), and the listing is in [`AppStore/`](AppStore/README.md).

- Version and build number come from CI: `package.json`'s version and the workflow's run number. `MARKETING_VERSION`
  and `CURRENT_PROJECT_VERSION` in `project.yml` are only for local builds.
- CI signs manually, passing each target's App Store profile through `VB_PROFILE_APP`, `VB_PROFILE_SHARE` and
  `VB_PROFILE_LIVE`. Locally they're empty, and signing stays automatic.
- The app icon is `Voucherboard/Assets.xcassets/AppIcon.appiconset/AppIcon.png`: the extension icon redrawn at 1024 px,
  RGB with no alpha, as the App Store requires.
- The encryption question is answered in Info.plist (`ITSAppUsesNonExemptEncryption = NO`): the app only uses HTTPS
  through WebKit.

## How it works

- **Engine view.** Loads `www/engine.html` with read access to `www/` only. Any navigation to anything other than a
  file in the bundle's `www` folder is cancelled. It's 1 × 1 point, transparent and in the window (so its timers keep
  running), with touches and VoiceOver off. The SwiftUI screens sit on top and call it with `callAsyncJavaScript`.
- **Council view.** Uses `WKWebsiteDataStore.default()`, so the council's cookies persist. When "hidden" it sits
  *behind* the UI view rather than being `isHidden`, so WebKit doesn't treat the page as invisible and throttle it.
  VoiceOver and touches are turned off for it while it's behind.
- **council.fetch.** Requests run one at a time. Before each, the view must have finished loading a council page that
  isn't blocked (native path check, then `__vbCouncil.ready()` for card and password fields). If it hasn't, and the
  view is hidden, it loads `/Home/ApplicantPermits` once. If that lands on `/Account/Login`, the request resolves as
  `{ status: 200, url: <login url>, body: "" }`, which is what the fetch itself would have seen, and `portal.js` then
  reports the user as logged out. Anything else that doesn't work rejects with `"network"`. While the view is shown,
  it never navigates away from what the user is looking at. Each request times out after 90 seconds.
- **Scripts.** `buyfill.js` then `council.js` are injected at document end, main frame only, in the `voucherboard`
  content world. `WKUserScript` can't filter by URL, so each is wrapped in a check for the council host over https.
- **Plate scanning.** Vision reads the text in memory; only `{ text, confidence }` lines reach the UI, which finds
  the plate with `plates.js`. The share extension leaves `{ lines, at }` in the App Group as `shared-scan.json`; the
  app reads and deletes it when it opens `voucherboard://scan` or becomes active, and emits `plate.shared` (queued
  until `hello`) if it's under 10 minutes old.
- **Sign out** removes the website data records named `lewisham.gov.uk` or the council host (WebKit groups records by
  registrable domain), then loads a blank page.

## Unsure

Nothing here has been compiled. These are the points most likely to need a fix or a look:

1. **Concurrency annotations.** `Bridge`, `CouncilController` and `Notifications` are `@MainActor` NSObject classes
   conforming to WebKit and UserNotifications delegate protocols, with delegate methods written in the classic
   completion-handler form. This is the usual pattern and should build in Swift 5 mode with minimal checking, but newer
   SDKs annotate some of these closures `@MainActor @Sendable`. If Xcode reports a "nearly matches" or isolation error,
   match the signature it suggests.
2. **`after(_:_:)`** uses `Task.sleep` on the main actor for timeouts, and passes non-Sendable closures into `Task`.
   Fine in Swift 5 mode; warnings only under strict checking.
3. **`callAsyncJavaScript(_:arguments:in:in:completionHandler:)`** with a `[String: Any]` argument containing `NSNull`
   for a null body. It's documented to accept NSNull, but check a POST with no body and a GET.
4. **Rejection messages.** `replyHandler(nil, "network")` should reject the JS Promise with an Error whose message is
   `"network"`.
5. **Hidden council view.** Whether WebKit still runs a WKWebView covered by another view at full speed. If fetches stall
   while the app is in front, try keeping the council view at alpha 0.01 instead.
6. **Background runs.** `beginBackgroundTask` keeps the app process alive for about 30 seconds, but WebKit runs pages in
   a separate process and may suspend it sooner. A run that goes to the background may stall until the app returns.
7. **Orientation lock on iPad.** `requestGeometryUpdate` is ignored on iPad when the app is in Split View or Slide Over,
   since the app doesn't set `UIRequiresFullScreen` (which would turn multitasking off).
8. **Sign-out records.** Assumes WebKit's `displayName` for the council's records is `lewisham.gov.uk`. If cookies
   survive a sign-out, log the record names.
9. **Launch from a notification.** The delegate is set in `didFinishLaunching`, so iOS should call `didReceive` for the
   launching tap. If not, read `connectionOptions.notificationResponse` in `SceneDelegate`.
10. **Copy phase.** Uses `$TARGET_BUILD_DIR/$UNLOCALIZED_RESOURCES_FOLDER_PATH` with user script sandboxing off. Check
    that `www/` and `council/` appear in the built `.app` and survive an Archive.
11. **Status bar.** Light text over the council header, default elsewhere. Not checked in dark mode.
12. **Dynamic Type.** The council header wraps at large text sizes and takes more room; not checked visually.
13. **Picker delegates.** `PHPickerViewControllerDelegate` and `UIImagePickerControllerDelegate` methods are
    `nonisolated` and hop to the main actor; `DataScannerViewControllerDelegate` methods are main-actor. If Xcode
    disagrees about isolation, match its suggestion.
14. **Live scanner API.** The `DataScannerViewController` initialiser labels, the delegate signatures
    (`didAdd`/`didUpdate`/`didRemove … allItems:`, `didTapOn`, `becameUnavailableWithError`), `RecognizedItem.bounds`
    and `overlayContainerView`. Live items carry no confidence, so their lines go over with `confidence: null`.
15. **en-GB.** Vision may not list `en-GB` for accurate recognition; then the request uses its default (English).
16. **Opening the app from the extension.** Extensions can't use `UIApplication.shared`. The extension walks the
    responder chain to the `UIApplication` and calls `openURL:options:completionHandler:` through the Objective-C
    runtime. This is a known workaround, not a public API for share extensions: it may stop working, and App Review may
    question it. The fallback is the "Open Voucherboard" message and the check when the app becomes active.
17. **Build settings in entitlements.** The entitlements list `$(APP_GROUP_ID)`; Xcode should expand it. If the signed
    app lacks the group, write the literal id in `project.yml`.
18. **Share extension memory.** Extensions are limited to about 120 MB. Pictures are decoded as ≤2000 px thumbnails
    with ImageIO, but a `UIImage` handed over by another app is already decoded at full size.
