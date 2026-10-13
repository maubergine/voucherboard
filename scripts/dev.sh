#!/usr/bin/env bash
# Builds Voucherboard's components on a Mac, and runs the phone apps in a simulator or emulator. See docs/DEVELOPING.md.
set -euo pipefail

VB="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD="$VB/build" # everything else: Xcode build data, staging, logs
XCODE_APP="${VB_XCODE:-/Applications/Xcode.app}"
IOS_DEVICE="${VB_IOS_DEVICE:-}"
AVD="${VB_AVD:-vb36}"
ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
VERBOSE=0
BUILD_ONLY=0
OPEN=0

usage() {
  cat <<EOF
Usage: scripts/dev.sh [options] <command>...

Commands:
  test       Run the tests (npm test).
  chrome     Package the Chrome zips into dist/. Load extension/ unpacked for development.
  firefox    Package the Firefox zip into dist/, and stage build/firefox (load its manifest.json in about:debugging).
  safari     Build the Safari app (ad hoc signed) into build/safari. --open launches it; without it, the build is
             unregistered so an installed copy keeps the extension.
  ios        Build the iOS app for the Simulator, then boot, install and launch it.
  android    Build the Android debug APK, then start the emulator, install and launch it.
  all        test, chrome, firefox, safari, and ios and android with --build-only.

Options:
  --build-only   ios, android: build without starting a simulator or emulator.
  --open         safari: open the built app afterwards.
  -v, --verbose  Show full xcodebuild and Gradle output.
  -h, --help     Show this help.

Environment:
  VB_XCODE       Xcode to use (default /Applications/Xcode.app). DEVELOPER_DIR is always set from it.
  VB_IOS_DEVICE  Simulator name or UDID (default: a booted iPhone, else the first available one).
  VB_AVD         Android emulator (default vb36).
  ANDROID_HOME   Android SDK (default ~/Library/Android/sdk).
EOF
}

say() { printf '\033[1m==> %s\033[0m\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 not found. $2"; }

# Every Xcode step uses this Xcode, whatever xcode-select points at (often the Command Line Tools).
xcode() {
  [[ -d "$XCODE_APP/Contents/Developer" ]] || die "Xcode not found at $XCODE_APP. Set VB_XCODE."
  export DEVELOPER_DIR="$XCODE_APP/Contents/Developer"
  need xcodegen "Install it with: brew install xcodegen"
}

# xcodebuild, quiet unless -v; the log is kept in build/ either way.
xcb() {
  local log="$1"; shift
  mkdir -p "$BUILD"
  if ((VERBOSE)); then xcodebuild "$@" | tee "$log"
  else xcodebuild -quiet "$@" >"$log" 2>&1 || { grep -E 'error:' "$log" >&2 || tail -30 "$log" >&2; die "Build failed. Log: $log"; }
  fi
}

cmd_test() { say "Tests"; (cd "$VB" && npm test); }

cmd_chrome() {
  say "Chrome"
  (cd "$VB" && node scripts/package.mjs)
  echo "For development, load $VB/extension unpacked in chrome://extensions."
}

cmd_firefox() {
  say "Firefox"
  (cd "$VB" && node scripts/package-firefox.mjs && node scripts/package-firefox.mjs --dir build/firefox)
  echo "Load $BUILD/firefox/manifest.json in about:debugging > This Firefox > Load Temporary Add-on."
}

cmd_safari() {
  say "Safari"
  xcode
  (cd "$VB/apps/safari" && xcodegen generate --quiet)
  xcb "$BUILD/safari-build.log" build -project "$VB/apps/safari/Voucherboard.xcodeproj" -scheme Voucherboard \
    -configuration Release -destination 'generic/platform=macOS' -derivedDataPath "$BUILD/safari"
  local app="$BUILD/safari/Build/Products/Release/Voucherboard for Safari.app"
  echo "Built $app"
  if ((OPEN)); then
    echo "Safari needs Settings > Developer > Allow unsigned extensions (see docs/DEVELOPING.md)."
    open "$app"
  else
    safari_unregister "$app"
  fi
}

# The build registers its extension under the same id as an installed copy, and Safari then can't find a signed one
# ("Safari's settings didn't open"). Unregister the build, and hand the id back to /Applications if it's there.
safari_unregister() {
  local lsr=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
  local installed="/Applications/Voucherboard for Safari.app" appex="Contents/PlugIns/Voucherboard Extension.appex"
  pluginkit -r "$1/$appex" 2>/dev/null || true
  "$lsr" -u "$1" 2>/dev/null || true
  if [[ -d "$installed" ]]; then
    "$lsr" -f "$installed"
    pluginkit -a "$installed/$appex"
    echo "Unregistered the build; Safari uses $installed. Use --open to try the build in Safari."
  else
    echo "Unregistered the build. Use --open to try it in Safari."
  fi
}

# A booted iPhone, else the first available one, unless VB_IOS_DEVICE names one.
ios_device() {
  local list; list="$(xcrun simctl list devices available)"
  if [[ -n "$IOS_DEVICE" ]]; then
    grep -F "$IOS_DEVICE" <<<"$list" | grep -oE '[0-9A-F-]{36}' | head -1
  else
    { grep -E 'iPhone.*\(Booted\)' <<<"$list" || grep -E 'iPhone' <<<"$list"; } | grep -oE '[0-9A-F-]{36}' | head -1
  fi
}

cmd_ios() {
  say "iOS"
  xcode
  (cd "$VB/apps/mobile/ios" && xcodegen generate --quiet)
  xcb "$BUILD/ios-build.log" build -project "$VB/apps/mobile/ios/Voucherboard.xcodeproj" -scheme Voucherboard \
    -configuration Debug -destination 'generic/platform=iOS Simulator' -derivedDataPath "$BUILD/ios" \
    CODE_SIGNING_ALLOWED=NO
  local app="$BUILD/ios/Build/Products/Debug-iphonesimulator/Voucherboard.app"
  echo "Built $app"
  ((BUILD_ONLY)) && return
  local udid; udid="$(ios_device)"
  [[ -n "$udid" ]] || die "No iPhone simulator found${IOS_DEVICE:+ matching $IOS_DEVICE}. Add one in Xcode."
  xcrun simctl bootstatus "$udid" -b >/dev/null
  xcrun simctl install "$udid" "$app"
  local id; id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app/Info.plist")"
  xcrun simctl launch "$udid" "$id" >/dev/null
  echo "Running $id on simulator $udid. View it in Xcode's Device Hub."
}

cmd_android() {
  say "Android"
  local dir="$VB/apps/mobile/android"
  [[ -d "$dir" ]] || die "No apps/mobile/android here. The Android app is on the feat/android-compose branch."
  [[ -d "$ANDROID_HOME" ]] || die "Android SDK not found at $ANDROID_HOME. Install Android Studio, or set ANDROID_HOME."
  local jh; jh="$(/usr/libexec/java_home -v 21 2>/dev/null)" || die "JDK 21 not found. Install one, e.g. brew install --cask corretto@21."
  export JAVA_HOME="$jh" ANDROID_HOME
  local adb="$ANDROID_HOME/platform-tools/adb" emu="$ANDROID_HOME/emulator/emulator"
  local q=(--quiet); ((VERBOSE)) && q=()
  (cd "$dir" && ./gradlew "${q[@]}" :app:assembleDebug)
  local apk="$dir/app/build/outputs/apk/debug/app-debug.apk"
  echo "Built $apk"
  ((BUILD_ONLY)) && return
  if ! "$adb" devices | grep -q 'emulator-.*device$'; then
    "$emu" -list-avds | grep -qx "$AVD" || die "No emulator named $AVD. Create one in Android Studio, or set VB_AVD."
    echo "Starting emulator $AVD"
    mkdir -p "$BUILD"
    nohup "$emu" -avd "$AVD" >"$BUILD/emulator.log" 2>&1 &
  fi
  "$adb" wait-for-device
  until [[ "$("$adb" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == 1 ]]; do sleep 2; done
  "$adb" install -r "$apk" >/dev/null
  "$adb" shell monkey -p com.mariusrubin.voucherboard -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
  echo "Running com.mariusrubin.voucherboard on the emulator."
}

cmd_all() {
  BUILD_ONLY=1
  cmd_test; cmd_chrome; cmd_firefox; cmd_safari; cmd_ios
  if [[ -d "$VB/apps/mobile/android" ]]; then cmd_android; else say "Android: skipped (on the feat/android-compose branch)"; fi
}

cmds=()
for a in "$@"; do
  case "$a" in
    -h|--help) usage; exit 0 ;;
    -v|--verbose) VERBOSE=1 ;;
    --build-only) BUILD_ONLY=1 ;;
    --open) OPEN=1 ;;
    test|chrome|firefox|safari|ios|android|all) cmds+=("$a") ;;
    *) usage >&2; die "Unknown argument: $a" ;;
  esac
done
((${#cmds[@]})) || { usage; exit 1; }
need node "Install Node.js 22 or later."
for c in "${cmds[@]}"; do "cmd_$c"; done
