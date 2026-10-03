# Voucherboard for iOS

The iOS shell for the mobile app. It hosts the planner UI (`mobile/www`) and the council view, and implements the
native side of the bridge in `mobile/BRIDGE.md`. UIKit, iOS 16+, Swift 5.9, no packages.

**Not yet built.** This was written on Linux without Xcode, so it has never been compiled or run. Expect a round of
small compile fixes on the first build. See "Unsure" below for what to check first.

## Files

| File | Role |
| --- | --- |
| `project.yml` | XcodeGen spec. Bundle id, version and team live here. |
| `Voucherboard/AppDelegate.swift` | Sets the notification delegate at launch, orientation mask, small helpers. |
| `Voucherboard/SceneDelegate.swift` | Window, and `app.state` events. |
| `Voucherboard/MainViewController.swift` | UI view, events to the UI, orientation, run, share, haptics. |
| `Voucherboard/Bridge.swift` | The `vb` message handler: checks arguments and runs every command. |
| `Voucherboard/CouncilController.swift` | Council view: header, navigation rules, `council.fetch` queue, sign-in, buy, sign-out. |
| `Voucherboard/Store.swift` | `store.*`: one JSON file in Application Support, excluded from backup. |
| `Voucherboard/Notifications.swift` | `notify.*`, and taps queued until the UI sends `hello`. |

The `www` and `council` folders aren't in this folder. A build phase copies them into the app bundle on every build:

- `mobile/www/*` to `www/`
- `src/{zones,planner,portal,terms,model,reminders}.js` to `www/core/`
- `mobile/council/council.js` and `src/buyfill.js` to `council/`

The build fails if any of these is missing, or if `mobile/www/index.html` is missing.

## Generate the project

On a Mac with Xcode 15 or later:

```sh
brew install xcodegen
cd voucherboard/mobile/ios
xcodegen
open Voucherboard.xcodeproj
```

Run `xcodegen` again after adding or removing Swift files, or after editing `project.yml`. The `.xcodeproj` and
`Voucherboard/Info.plist` are generated, so they're git-ignored.

## Signing

Either set `DEVELOPMENT_TEAM` in `project.yml` to your team id and regenerate, or pick the team in Xcode:
target **Voucherboard** > **Signing & Capabilities** > **Team**. Signing is automatic.

The bundle id is `uk.co.voucherboard.app` (`PRODUCT_BUNDLE_IDENTIFIER` in `project.yml`). A free Apple ID can't use an
id that another team has registered; if Xcode says so, change it there.

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

## TestFlight

Needs a paid Apple Developer Program membership.

1. Register the bundle id and create the app in App Store Connect.
2. Add an app icon first: an `AppIcon` set in `Voucherboard/Assets.xcassets` with a 1024×1024 PNG, and set
   `ASSETCATALOG_COMPILER_APPICON_NAME: AppIcon` in `project.yml`. Uploads without an icon are rejected. The repo
   only has 128 px icons.
3. Bump `CURRENT_PROJECT_VERSION` (and `MARKETING_VERSION` to match `package.json`) in `project.yml`, then regenerate.
4. Destination **Any iOS Device (arm64)**, then Product > Archive, then Distribute App > App Store Connect > Upload.
5. In App Store Connect, add testers under TestFlight. Internal testers get it straight away. External testers need
   Beta App Review first.

The encryption question is answered in Info.plist (`ITSAppUsesNonExemptEncryption = NO`): the app only uses HTTPS
through WebKit.

## How it works

- **UI view.** Loads `www/index.html` with read access to `www/` only. Any navigation to anything other than a file in
  the bundle's `www` folder is cancelled. It ignores safe areas (`contentInsetAdjustmentBehavior = .never`); the page
  pads itself.
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
