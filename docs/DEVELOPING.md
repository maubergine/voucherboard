# Building Voucherboard on a Mac

`voucherboard/scripts/dev.sh` builds every component, and runs the phone apps in a simulator or emulator. Run it from
`voucherboard/` (or anywhere, by its path). Builds go to `voucherboard/dist/`, which git ignores.

```sh
cd voucherboard
npm install                    # once; also turns on the commit-msg hook (commitlint)
scripts/dev.sh test            # npm test
scripts/dev.sh chrome          # dist/voucherboard-<version>.zip
scripts/dev.sh firefox         # dist/voucherboard-firefox-<version>.zip, and dist/firefox to load
scripts/dev.sh safari --open   # dist/safari/.../Voucherboard for Safari.app, then opens it
scripts/dev.sh ios             # builds, boots a Simulator, installs and launches
scripts/dev.sh android         # builds, starts the emulator, installs and launches
scripts/dev.sh all             # all of the above, with --build-only for ios and android
```

Commands can be combined (`scripts/dev.sh test safari`). `-v` shows the full Xcode and Gradle output; otherwise it
goes to `dist/*-build.log`, and only errors are shown. `scripts/dev.sh --help` lists every option.

To run CI before pushing, use `ci/local.sh` from the repository root: it runs the workflows with act, the Ubuntu
jobs in Docker and the unsigned Xcode builds on this Mac. See [ci/README.md](../ci/README.md).

## What you need

| For | Needs |
| --- | --- |
| Everything | Node.js, current LTS |
| `safari`, `ios` | Xcode 27 at `/Applications/Xcode.app`, and XcodeGen (`brew install xcodegen`) |
| `android` | Android Studio (`brew install --cask android-studio`), its SDK in `~/Library/Android/sdk`, an emulator named `vb36`, and JDK 21 |

The script always sets `DEVELOPER_DIR` to that Xcode, so it works when `xcode-select` points at the Command Line
Tools. To use another Xcode, set `VB_XCODE=/Applications/Xcode-beta.app`.

Other settings: `VB_IOS_DEVICE` (Simulator name or UDID; by default a booted iPhone, or else the first one),
`VB_AVD` (emulator name) and `ANDROID_HOME`.

## Loading each build

- **Chrome, Edge, Brave:** for development, load `voucherboard/` itself unpacked: `chrome://extensions` > turn on
  **Developer mode** > **Load unpacked**. Changes to `src` need only **Reload** on that page. The zip is what the store
  gets.
- **Firefox:** `about:debugging` > **This Firefox** > **Load Temporary Add-on** > `voucherboard/dist/firefox/manifest.json`.
  Firefox removes it when it quits. See [FIREFOX.md](FIREFOX.md).
- **Safari:** the build is ad hoc signed, so Safari only loads it with unsigned extensions allowed: **Settings >
  Advanced** > tick **Show features for web developers**, then **Settings > Developer** > tick **Allow unsigned
  extensions**. Safari turns this off each time it quits. Then open the app, choose **Open Safari extension
  settings**, tick **Voucherboard**, and under **Edit Websites** allow `parkingpermits.lewisham.gov.uk`. See
  [SAFARI.md](SAFARI.md). The build shares its extension id with an installed copy, so without `--open`, `dev.sh`
  unregisters it afterwards; otherwise the installed app's settings button fails. Reopen the installed app once after
  trying a build with `--open`.
- **iOS:** runs in the Simulator, built unsigned. Xcode 27 shows simulators in **Device Hub** (there's no Simulator
  app). Choose **Try the demo** to see every screen without the council site. See `voucherboard/mobile/ios/README.md`.
- **Android:** the app is on the `feat/android-compose` branch until it's merged; on other branches `android` says so
  and stops. Choose **Try the demo** as on iOS. See `voucherboard/mobile/android/README.md` on that branch.

Signing, notarising and store uploads aren't done here: CI does them after the owner's approval (see
[RELEASING.md](RELEASING.md)).
